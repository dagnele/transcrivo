use anyhow::{bail, Result};
use clap::Args;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::time::{sleep, timeout, Duration, Instant};
use tracing::{debug, error, info, warn};

use crate::audio::capture::{AudioCaptureWorker, CaptureSource, PcmChunk, SourceCaptures};
use crate::audio::open_default_source_captures;
use crate::audio::preprocess::{AudioChunk, PreprocessConfig, PreprocessState};
use crate::audio::vad::VadConfig;
use crate::commands::models::{ensure_model_downloaded, validate_model_name};
use crate::session::manager::SessionManager;
use crate::session::models::Source;
use crate::transcribe::pipeline::TranscriptPipeline;
use crate::transcribe::whisper_cpp::{
    transcription_backend_name, RealWhisperBackend, TranscriptionError, WhisperCppAdapter,
    WhisperCppConfig,
};
use crate::transport::protocol::{MessageEnvelope, ProtocolError};
use crate::transport::{
    BackendWebSocketClient, WebSocketClientError, DEFAULT_READY_TIMEOUT_SECONDS,
};
use crate::util::shutdown::ShutdownController;
use crate::util::whisper_log;

const SESSION_EXPIRED_ERROR_CODE: &str = "session_expired";
const SESSION_CLOSED_ERROR_CODE: &str = "session_closed";

const LIVE_SILENCE_HOLD_MS: u64 = 1_000;
const LIVE_MIC_MIN_RMS: f32 = 0.0025;
const LIVE_SYSTEM_MIN_RMS: f32 = 0.01;
const TRANSCRIPTION_CHUNK_MS: u32 = 5_000;
const BACKEND_POLL_INTERVAL: Duration = Duration::from_millis(100);
const BACKEND_MESSAGE_POLL_TIMEOUT: Duration = Duration::from_millis(10);
const CAPTURE_CHANNEL_CAPACITY: usize = 256;
const INFERENCE_REQUEST_CHANNEL_CAPACITY: usize = 8;
const INFERENCE_RESULT_CHANNEL_CAPACITY: usize = 32;
const WS_CLOSE_TIMEOUT: Duration = Duration::from_secs(3);
const RECONNECT_WINDOW: Duration = Duration::from_secs(60);
const RECONNECT_INITIAL_BACKOFF: Duration = Duration::from_millis(250);
const RECONNECT_MAX_BACKOFF: Duration = Duration::from_secs(5);

#[derive(Debug)]
enum CaptureEvent {
    Chunk { source: Source, chunk: PcmChunk },
    Ended { source: Source },
}

#[derive(Debug)]
enum InferenceRequest {
    Audio(AudioChunk),
    Finalize,
}

#[derive(Debug)]
struct InferenceResult {
    source: Source,
    messages: Vec<MessageEnvelope>,
}

#[derive(Debug)]
struct SourceRuntime {
    source: Source,
    preprocess: PreprocessState,
    inference_tx: mpsc::Sender<InferenceRequest>,
    silence_tracker: SilenceTracker,
}

#[derive(Debug, Default)]
struct SilenceTracker {
    hold_ms: u64,
    silence_ms: u64,
}

impl SilenceTracker {
    fn new(hold_ms: u64) -> Self {
        Self {
            hold_ms,
            silence_ms: 0,
        }
    }

    fn observe(&mut self, is_speech: bool, chunk_duration_ms: u64) -> bool {
        if is_speech {
            self.silence_ms = 0;
            return false;
        }

        self.silence_ms = self.silence_ms.saturating_add(chunk_duration_ms);
        self.silence_ms >= self.hold_ms
    }

    fn reset(&mut self) {
        self.silence_ms = 0;
    }
}

#[derive(Debug, Args)]
pub struct RunArgs {
    #[arg(
        long,
        default_value = "wss://transcrivo.live/ws",
        help = "Backend WebSocket URL"
    )]
    pub backend_url: String,

    #[arg(long, help = "Bearer token for backend authentication")]
    pub token: Option<String>,

    #[arg(
        long,
        help = "Explicit microphone device id. Use `transcrivo devices` to inspect ids."
    )]
    pub mic_device: Option<String>,

    #[arg(
        long,
        help = "Explicit system audio device id. Use `transcrivo devices` to inspect ids."
    )]
    pub system_device: Option<String>,

    #[arg(
        long,
        help = "Override whisper.cpp model name. Defaults to `large` when not set."
    )]
    pub whisper_model_name: Option<String>,

    #[arg(
        long,
        default_value_t = cfg!(feature = "whisper-gpu"),
        help = "Use whisper.cpp GPU acceleration when the binary is built with a supported GPU backend."
    )]
    pub whisper_use_gpu: bool,

    #[arg(
        long,
        default_value_t = false,
        help = "Enable whisper.cpp flash attention when GPU acceleration is enabled."
    )]
    pub whisper_flash_attn: bool,

    #[arg(
        long,
        default_value_t = 0,
        help = "GPU device index for whisper.cpp when GPU acceleration is enabled."
    )]
    pub whisper_gpu_device: i32,
}

pub async fn execute(args: &RunArgs) -> Result<()> {
    if let Some(model_name) = args.whisper_model_name.as_deref() {
        validate_model_name(model_name)?;
    }
    let requested_model = args.whisper_model_name.as_deref().unwrap_or("large");
    let _ = ensure_model_downloaded(requested_model).await?;
    let backend_url = validate_backend_url(&args.backend_url)?;
    let token = validate_required_text(
        "token",
        args.token
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("token is required"))?,
    )?;

    info!(
        command = "run",
        backend_url = %backend_url,
        transcription_backend = transcription_backend_name(),
        model = requested_model,
        "starting run command"
    );

    let transcription_config = build_transcription_config(args);
    let mut session = SessionManager::new(None);
    let mut client = BackendWebSocketClient::new(backend_url, token);
    let source_captures =
        open_default_source_captures(args.mic_device.as_deref(), args.system_device.as_deref())?;
    let selected_devices = SelectedDevices::from_source_captures(&source_captures)?;
    println!("{}", describe_selected_devices(&selected_devices));

    client.connect().await?;

    let start_message =
        build_session_start_message(&mut session, &selected_devices, &transcription_config)?;

    info!(
        mic_device_id = %selected_devices.mic_device_id,
        system_device_id = %selected_devices.system_device_id,
        "run session start"
    );

    let shutdown = ShutdownController::new();
    whisper_log::set_suppress_abort_errors(false);
    let signal_shutdown = shutdown.clone();
    let signal_task = tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        whisper_log::set_suppress_abort_errors(true);
        signal_shutdown.request();
    });

    let mut shutdown_reason = None;
    let result = async {
        client.send_message(&start_message).await?;
        let ready = client
            .wait_for_session_ready(DEFAULT_READY_TIMEOUT_SECONDS)
            .await?;
        session
            .handle_inbound_message(&ready)
            .map_err(anyhow::Error::msg)?;

        info!("run session ready");

        run_live_session(
            &mut session,
            &mut client,
            source_captures,
            &selected_devices,
            &shutdown,
            transcription_config,
        )
        .await?;

        Ok::<(), anyhow::Error>(())
    }
    .await;

    signal_task.abort();
    let reset_abort_log_suppression = AbortLogSuppressionReset;

    if let Err(error) = &result {
        shutdown_reason = Some(shutdown_reason_for_error(error));
    } else if shutdown.is_requested() {
        shutdown_reason = Some("user_interrupt".to_string());
    }

    if should_send_session_stop(shutdown_reason.as_deref()) {
        let stop_message = session.create_session_stop(shutdown_reason)?;
        if let Err(error) = client.send_message(&stop_message).await {
            warn!(error = %error, "failed to send session.stop during cleanup");
        }
    } else {
        info!(reason = ?shutdown_reason, "skipping session.stop because backend already closed the session");
    }
    match timeout(WS_CLOSE_TIMEOUT, client.close()).await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            warn!(error = %error, "failed to close backend websocket cleanly");
        }
        Err(_) => {
            warn!(
                timeout_ms = WS_CLOSE_TIMEOUT.as_millis(),
                "timed out closing backend websocket"
            );
        }
    }

    result?;
    drop(reset_abort_log_suppression);
    println!(
        "Session lifecycle completed successfully. Live transcription streaming stopped cleanly."
    );
    Ok(())
}

pub fn build_session_start_message(
    session: &mut SessionManager,
    selected_devices: &SelectedDevices,
    transcription_config: &TranscriptionConfig,
) -> Result<MessageEnvelope, ProtocolError> {
    let start_message = session.create_session_start(
        Some(selected_devices.mic_device_id.clone()),
        Some(selected_devices.system_device_id.clone()),
        transcription_backend_name().to_string(),
        transcription_config.model_name().to_string(),
    )?;
    Ok(start_message)
}

pub fn describe_selected_devices(selected_devices: &SelectedDevices) -> String {
    format!(
        "Using devices:\n  Mic: {} ({})\n  System: {} ({})",
        selected_devices.mic_device_name,
        selected_devices.mic_device_id,
        selected_devices.system_device_name,
        selected_devices.system_device_id,
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectedDevices {
    pub mic_device_id: String,
    pub mic_device_name: String,
    pub system_device_id: String,
    pub system_device_name: String,
}

impl SelectedDevices {
    pub fn from_source_captures(source_captures: &SourceCaptures) -> Result<Self> {
        let mic = source_captures
            .get(CaptureSource::Mic)
            .ok_or_else(|| anyhow::anyhow!("missing microphone capture"))?;
        let system = source_captures
            .get(CaptureSource::System)
            .ok_or_else(|| anyhow::anyhow!("missing system capture"))?;

        Ok(Self {
            mic_device_id: mic.config.device_id.clone(),
            mic_device_name: mic.config.device_name.clone(),
            system_device_id: system.config.device_id.clone(),
            system_device_name: system.config.device_name.clone(),
        })
    }
}

pub fn validate_backend_url(value: &str) -> Result<&str> {
    let parsed = http::Uri::try_from(value)?;
    match parsed.scheme_str() {
        Some("ws") | Some("wss") => {}
        _ => bail!("backend URL must use ws:// or wss://"),
    }
    if parsed.authority().is_none() {
        bail!("backend URL must include a host");
    }
    Ok(value)
}

pub fn validate_required_text<'a>(name: &str, value: &'a str) -> Result<&'a str> {
    if value.trim().is_empty() {
        bail!("{name} must be non-empty");
    }
    Ok(value)
}

pub async fn run_live_session(
    session: &mut SessionManager,
    client: &mut BackendWebSocketClient,
    source_captures: SourceCaptures,
    selected_devices: &SelectedDevices,
    shutdown: &ShutdownController,
    transcription_config: TranscriptionConfig,
) -> Result<()> {
    run_live_session_with_adapter_factory(
        session,
        client,
        source_captures,
        selected_devices,
        shutdown,
        transcription_config,
        build_interruptible_transcription_adapter,
    )
    .await
}

pub async fn run_live_session_with_adapter_factory<F>(
    session: &mut SessionManager,
    client: &mut BackendWebSocketClient,
    source_captures: SourceCaptures,
    selected_devices: &SelectedDevices,
    shutdown: &ShutdownController,
    transcription_config: TranscriptionConfig,
    adapter_factory: F,
) -> Result<()>
where
    F: Fn(
            Source,
            &TranscriptionConfig,
            &ShutdownController,
        ) -> Result<WhisperCppAdapter, TranscriptionError>
        + Copy,
{
    let shared_session = Arc::new(session.clone());

    info!("live stream start");
    let mut workers = source_captures.into_workers();
    let mut mic = workers
        .remove(&CaptureSource::Mic)
        .ok_or_else(|| anyhow::anyhow!("missing microphone capture worker"))?;
    let mut system = workers
        .remove(&CaptureSource::System)
        .ok_or_else(|| anyhow::anyhow!("missing system capture worker"))?;
    mic.start().await?;
    if let Err(error) = system.start().await {
        let _ = mic.stop().await;
        return Err(error.into());
    }

    let mic_worker = Arc::new(tokio::sync::Mutex::new(mic));
    let system_worker = Arc::new(tokio::sync::Mutex::new(system));

    let (capture_tx, mut capture_rx) = mpsc::channel(CAPTURE_CHANNEL_CAPACITY);
    let (result_tx, mut result_rx) = mpsc::channel(INFERENCE_RESULT_CHANNEL_CAPACITY);

    let mut source_runtimes = HashMap::new();
    let mut inference_tasks = Vec::new();
    for (source, capture, session) in [
        (
            Source::Mic,
            Arc::clone(&mic_worker),
            Arc::clone(&shared_session),
        ),
        (Source::System, Arc::clone(&system_worker), shared_session),
    ] {
        let (source_runtime, inference_rx) = build_source_runtime(source, &capture).await?;
        source_runtimes.insert(source, source_runtime);
        inference_tasks.push(tokio::spawn(inference_worker(
            source,
            TranscriptPipeline::new(
                source,
                session,
                adapter_factory(source, &transcription_config, shutdown)?,
                true,
            ),
            inference_rx,
            result_tx.clone(),
        )));
    }

    let drain_tasks = vec![
        tokio::spawn(drain_capture(
            Source::Mic,
            Arc::clone(&mic_worker),
            capture_tx.clone(),
            shutdown.clone(),
        )),
        tokio::spawn(drain_capture(
            Source::System,
            Arc::clone(&system_worker),
            capture_tx,
            shutdown.clone(),
        )),
    ];

    let run_result = async {
        let backend_tick = sleep(BACKEND_POLL_INTERVAL);
        tokio::pin!(backend_tick);

        loop {
            tokio::select! {
                _ = shutdown.wait_for_request() => {
                    break;
                }
                _ = &mut backend_tick => {
                    poll_backend_messages(
                        session,
                        client,
                        selected_devices,
                        shutdown,
                        &transcription_config,
                    )
                    .await?;
                    backend_tick.as_mut().reset(Instant::now() + BACKEND_POLL_INTERVAL);
                }
                capture_event = capture_rx.recv() => {
                    let Some(capture_event) = capture_event else {
                        if shutdown.is_requested() {
                            break;
                        }
                        bail!("capture stream ended unexpectedly");
                    };

                    match capture_event {
                        CaptureEvent::Chunk { source, chunk } => {
                            let source_runtime = source_runtimes
                                .get_mut(&source)
                                .ok_or_else(|| anyhow::anyhow!("missing source runtime for {source:?}"))?;
                            process_capture_chunk(source_runtime, chunk)?;
                        }
                        CaptureEvent::Ended { source } => {
                            if shutdown.is_requested() {
                                break;
                            }
                            poll_backend_messages(
                                session,
                                client,
                                selected_devices,
                                shutdown,
                                &transcription_config,
                            )
                            .await?;
                            if shutdown.is_requested() {
                                break;
                            }
                            bail!("{:?} capture stream ended unexpectedly", source);
                        }
                    }
                }
                result = result_rx.recv() => {
                    let Some(result) = result else {
                        if shutdown.is_requested() {
                            break;
                        }
                        bail!("live inference worker exited unexpectedly");
                    };
                    send_inference_result(
                        session,
                        client,
                        selected_devices,
                        shutdown,
                        &transcription_config,
                        result,
                    )
                    .await?;
                }
            }
        }

        Ok::<(), anyhow::Error>(())
    }
    .await;

    shutdown.request();

    if run_result.is_ok() {
        for source_runtime in source_runtimes.values_mut() {
            flush_source_runtime(source_runtime)?;
        }
    }

    drop(capture_rx);
    for source_runtime in source_runtimes.into_values() {
        drop(source_runtime.inference_tx);
    }
    drop(result_tx);

    while let Some(result) = result_rx.recv().await {
        send_inference_result(
            session,
            client,
            selected_devices,
            shutdown,
            &transcription_config,
            result,
        )
        .await?;
    }

    let stop_result = stop_workers(&mic_worker, &system_worker).await;

    for drain_task in drain_tasks {
        drain_task
            .await
            .map_err(|error| anyhow::anyhow!("capture drain task failed: {error}"))?;
    }
    for inference_task in inference_tasks {
        inference_task
            .await
            .map_err(|error| anyhow::anyhow!("inference task failed: {error}"))?;
    }

    run_result?;
    stop_result?;
    Ok(())
}

struct AbortLogSuppressionReset;

impl Drop for AbortLogSuppressionReset {
    fn drop(&mut self) {
        whisper_log::set_suppress_abort_errors(false);
    }
}

fn process_capture_chunk(source_runtime: &mut SourceRuntime, chunk: PcmChunk) -> Result<()> {
    let vad_config = live_vad_config(source_runtime.source);
    let processed = source_runtime.preprocess.process_with_vad(&chunk, &vad_config)?;

    for output in processed.emitted_chunks {
        let start_ms = output.start_ms;
        let end_ms = output.end_ms;
        enqueue_inference_request(
            &source_runtime.inference_tx,
            InferenceRequest::Audio(output),
            source_runtime.source,
            start_ms,
            end_ms,
        )?;
    }

    if source_runtime
        .silence_tracker
        .observe(processed.is_speech, processed.chunk_duration_ms)
    {
        enqueue_inference_request(
            &source_runtime.inference_tx,
            InferenceRequest::Finalize,
            source_runtime.source,
            0,
            processed.chunk_duration_ms,
        )?;
        source_runtime.silence_tracker.reset();
    } else if processed.is_speech {
        source_runtime.silence_tracker.reset();
    }

    Ok(())
}

fn flush_source_runtime(source_runtime: &mut SourceRuntime) -> Result<()> {
    if let Some(flushed) = source_runtime.preprocess.flush()? {
        let start_ms = flushed.start_ms;
        let end_ms = flushed.end_ms;
        enqueue_inference_request(
            &source_runtime.inference_tx,
            InferenceRequest::Audio(flushed),
            source_runtime.source,
            start_ms,
            end_ms,
        )?;
    }

    enqueue_inference_request(
        &source_runtime.inference_tx,
        InferenceRequest::Finalize,
        source_runtime.source,
        0,
        0,
    )?;

    Ok(())
}

fn live_vad_config(source: Source) -> VadConfig {
    VadConfig {
        enabled: true,
        min_rms: match source {
            Source::Mic => LIVE_MIC_MIN_RMS,
            Source::System => LIVE_SYSTEM_MIN_RMS,
        },
    }
}

async fn stop_workers(
    mic_worker: &Arc<tokio::sync::Mutex<AudioCaptureWorker>>,
    system_worker: &Arc<tokio::sync::Mutex<AudioCaptureWorker>>,
) -> Result<()> {
    let mic_result = {
        let mut mic_worker = mic_worker.lock().await;
        mic_worker.stop().await
    };
    let system_result = {
        let mut system_worker = system_worker.lock().await;
        system_worker.stop().await
    };

    mic_result?;
    system_result?;
    Ok(())
}

async fn drain_capture(
    source: Source,
    worker: Arc<tokio::sync::Mutex<AudioCaptureWorker>>,
    tx: mpsc::Sender<CaptureEvent>,
    shutdown: ShutdownController,
) {
    loop {
        let chunk = tokio::select! {
            _ = shutdown.wait_for_request() => {
                break;
            }
            chunk = async {
                let mut worker = worker.lock().await;
                worker.read_chunk().await
            } => chunk,
        };

        match chunk {
            Ok(chunk) => {
                let send_result = tokio::select! {
                    _ = shutdown.wait_for_request() => {
                        break;
                    }
                    send_result = tx.send(CaptureEvent::Chunk { source, chunk }) => send_result,
                };
                if send_result.is_err() {
                    break;
                }
            }
            Err(error) if shutdown.is_requested() => {
                let worker = worker.lock().await;
                debug!(source = ?worker.config.source, error = %error, "capture drain interrupted");
                break;
            }
            Err(error) => {
                let worker = worker.lock().await;
                error!(source = ?worker.config.source, error = %error, "capture drain failed");
                break;
            }
        }
    }

    let _ = tx.send(CaptureEvent::Ended { source }).await;
}

async fn inference_worker(
    source: Source,
    mut pipeline: TranscriptPipeline,
    mut request_rx: mpsc::Receiver<InferenceRequest>,
    result_tx: mpsc::Sender<InferenceResult>,
) {
    while let Some(request) = request_rx.recv().await {
        let mut messages = Vec::new();

        match request {
            InferenceRequest::Audio(chunk) => match pipeline.transcribe_chunk_async(&chunk).await {
                Ok(chunk_messages) => messages.extend(chunk_messages),
                Err(TranscriptionError::Aborted) => break,
                Err(error) => {
                    error!(
                        source = ?source,
                        start_ms = chunk.start_ms,
                        end_ms = chunk.end_ms,
                        error = %error,
                        "live inference failed"
                    );
                }
            },
            InferenceRequest::Finalize => {
                if pipeline.has_pending() {
                    debug!(source = ?source, "finalizing pending transcript utterance");
                    match pipeline.flush_pending() {
                        Ok(flushed) => messages.extend(flushed),
                        Err(error) => {
                            error!(source = ?source, error = %error, "live pipeline flush failed");
                        }
                    }
                }
            }
        }

        if result_tx
            .send(InferenceResult { source, messages })
            .await
            .is_err()
        {
            break;
        }
    }

    match pipeline.flush_pending() {
        Ok(messages) if !messages.is_empty() => {
            let _ = result_tx.send(InferenceResult { source, messages }).await;
        }
        Ok(_) => {}
        Err(error) => {
            error!(source = ?source, error = %error, "final live pipeline flush failed");
        }
    }
}

async fn send_inference_result(
    session: &mut SessionManager,
    client: &mut BackendWebSocketClient,
    selected_devices: &SelectedDevices,
    shutdown: &ShutdownController,
    transcription_config: &TranscriptionConfig,
    result: InferenceResult,
) -> Result<()> {
    for message in result.messages {
        send_message_with_reconnect(
            session,
            client,
            selected_devices,
            shutdown,
            &transcription_config,
            &message,
        )
        .await?;
        debug!(
            message_type = ?message.message_type,
            source = ?result.source,
            "sent live transcript event"
        );
    }

    Ok(())
}

fn enqueue_inference_request(
    inference_tx: &mpsc::Sender<InferenceRequest>,
    request: InferenceRequest,
    source: Source,
    start_ms: u64,
    end_ms: u64,
) -> Result<()> {
    match inference_tx.try_send(request) {
        Ok(()) => Ok(()),
        Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
            warn!(source = ?source, start_ms, end_ms, "dropping live transcription chunk because inference queue is full");
            Ok(())
        }
        Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => Err(anyhow::anyhow!(
            "live inference worker stopped before processing queued audio"
        )),
    }
}

async fn poll_backend_messages(
    session: &mut SessionManager,
    client: &mut BackendWebSocketClient,
    selected_devices: &SelectedDevices,
    shutdown: &ShutdownController,
    transcription_config: &TranscriptionConfig,
) -> Result<()> {
    loop {
        let message = match timeout(BACKEND_MESSAGE_POLL_TIMEOUT, client.receive_message()).await {
            Ok(Ok(message)) => message,
            Ok(Err(WebSocketClientError::ConnectionClosed)) => {
                info!("backend connection closed; attempting reconnect");
                reconnect_backend_session(
                    session,
                    client,
                    selected_devices,
                    shutdown,
                    transcription_config,
                )
                .await?;
                return Ok(());
            }
            Ok(Err(error)) if shutdown.is_requested() => {
                debug!(error = %error, "ignoring receive error during shutdown");
                return Ok(());
            }
            Ok(Err(error)) if is_reconnectable_websocket_error(&error) => {
                warn!(error = %error, "backend receive failed; attempting reconnect");
                reconnect_backend_session(
                    session,
                    client,
                    selected_devices,
                    shutdown,
                    transcription_config,
                )
                .await?;
                return Ok(());
            }
            Ok(Err(error)) => return Err(error.into()),
            Err(_) => return Ok(()),
        };

        let inbound = session
            .handle_inbound_message(&message)
            .map_err(anyhow::Error::msg)?;
        if matches!(inbound.state, crate::session::models::SessionState::Error) {
            shutdown.request();
            if let crate::session::manager::InboundPayload::Error(payload) = inbound.payload {
                if is_terminal_session_error_code(payload.code.as_deref()) {
                    info!(code = ?payload.code, message = %payload.message, "backend closed session; shutting down cli");
                } else {
                    error!(code = ?payload.code, message = %payload.message, "backend session error");
                }
                bail!(payload.message);
            }
            bail!("backend returned invalid session.error payload");
        }

        debug!(
            message_type = ?message.message_type,
            state = ?inbound.state,
            "received backend message"
        );
    }
}

async fn send_message_with_reconnect(
    session: &mut SessionManager,
    client: &mut BackendWebSocketClient,
    selected_devices: &SelectedDevices,
    shutdown: &ShutdownController,
    transcription_config: &TranscriptionConfig,
    message: &MessageEnvelope,
) -> Result<()> {
    match client.send_message(message).await {
        Ok(()) => Ok(()),
        Err(error) if is_reconnectable_websocket_error(&error) && !shutdown.is_requested() => {
            warn!(error = %error, "backend send failed; attempting reconnect");
            reconnect_backend_session(
                session,
                client,
                selected_devices,
                shutdown,
                transcription_config,
            )
            .await
        }
        Err(error) => Err(error.into()),
    }
}

async fn reconnect_backend_session(
    session: &mut SessionManager,
    client: &mut BackendWebSocketClient,
    selected_devices: &SelectedDevices,
    shutdown: &ShutdownController,
    transcription_config: &TranscriptionConfig,
) -> Result<()> {
    let reconnect_deadline = Instant::now() + RECONNECT_WINDOW;
    let mut backoff = RECONNECT_INITIAL_BACKOFF;

    loop {
        if shutdown.is_requested() {
            bail!("shutdown requested")
        }

        let _ = client.close().await;

        match reconnect_backend_session_once(
            session,
            client,
            selected_devices,
            transcription_config,
        )
        .await
        {
            Ok(()) => {
                info!("backend session ready after reconnect");
                return Ok(());
            }
            Err(error) if is_reconnectable_reconnect_error(&error) && Instant::now() < reconnect_deadline =>
            {
                warn!(
                    error = %error,
                    backoff_ms = backoff.as_millis(),
                    remaining_ms = reconnect_deadline.saturating_duration_since(Instant::now()).as_millis(),
                    "backend reconnect attempt failed"
                );

                tokio::select! {
                    _ = shutdown.wait_for_request() => bail!("shutdown requested"),
                    _ = sleep(backoff) => {}
                }

                backoff = (backoff * 2).min(RECONNECT_MAX_BACKOFF);
            }
            Err(error) => return Err(error.into()),
        }
    }
}

async fn reconnect_backend_session_once(
    session: &mut SessionManager,
    client: &mut BackendWebSocketClient,
    selected_devices: &SelectedDevices,
    transcription_config: &TranscriptionConfig,
) -> Result<()> {
    client.connect().await?;
    info!("backend reconnect succeeded; starting fresh session");

    let start_message =
        build_session_start_message(session, selected_devices, transcription_config)?;
    client.send_message(&start_message).await?;
    let ready = client
        .wait_for_session_ready(DEFAULT_READY_TIMEOUT_SECONDS)
        .await?;
    session
        .handle_inbound_message(&ready)
        .map_err(anyhow::Error::msg)?;

    Ok(())
}

fn is_reconnectable_websocket_error(error: &WebSocketClientError) -> bool {
    matches!(
        error,
        WebSocketClientError::ConnectFailed(_)
            | WebSocketClientError::NotConnected
            | WebSocketClientError::SendFailed
            | WebSocketClientError::ReceiveFailed
            | WebSocketClientError::ConnectionClosed
            | WebSocketClientError::ServerUnavailable(_)
    )
}

fn is_reconnectable_reconnect_error(error: &anyhow::Error) -> bool {
    error
        .downcast_ref::<WebSocketClientError>()
        .is_some_and(is_reconnectable_websocket_error)
}

#[derive(Debug, Clone, Default)]
pub struct TranscriptionConfig {
    pub whisper_model_name: Option<String>,
    pub whisper_use_gpu: bool,
    pub whisper_flash_attn: bool,
    pub whisper_gpu_device: i32,
}

impl TranscriptionConfig {
    pub fn model_name(&self) -> &str {
        self.whisper_model_name.as_deref().unwrap_or("large")
    }
}

pub fn build_transcription_config(args: &RunArgs) -> TranscriptionConfig {
    TranscriptionConfig {
        whisper_model_name: args.whisper_model_name.clone(),
        whisper_use_gpu: args.whisper_use_gpu,
        whisper_flash_attn: args.whisper_flash_attn,
        whisper_gpu_device: args.whisper_gpu_device,
    }
}

fn build_interruptible_transcription_adapter(
    source: Source,
    config_args: &TranscriptionConfig,
    shutdown: &ShutdownController,
) -> Result<WhisperCppAdapter, TranscriptionError> {
    let mut config = WhisperCppConfig {
        language: None,
        ..WhisperCppConfig::default()
    };
    if let Some(model_name) = &config_args.whisper_model_name {
        config.model_name = model_name.clone();
    }
    config.use_gpu = config_args.whisper_use_gpu;
    config.flash_attn = config_args.whisper_flash_attn;
    config.gpu_device = config_args.whisper_gpu_device;

    info!(
        source = ?source,
        model_name = %config.model_name,
        language = ?config.language,
        use_gpu = config.use_gpu,
        flash_attn = config.flash_attn,
        gpu_device = config.gpu_device,
        interruptible = true,
        "initializing whisper transcription adapter"
    );

    match RealWhisperBackend::from_config(&config) {
        Ok(backend) => Ok(WhisperCppAdapter::from_shared_backend(
            config,
            Arc::new(backend.with_shutdown_controller(shutdown.clone())),
        )),
        Err(error) => Err(error),
    }
}

fn transcription_preprocess_config(_source: Source) -> PreprocessConfig {
    PreprocessConfig {
        chunk_duration_ms: TRANSCRIPTION_CHUNK_MS,
        ..PreprocessConfig::default()
    }
}

async fn build_source_runtime(
    source: Source,
    capture: &Arc<tokio::sync::Mutex<AudioCaptureWorker>>,
) -> Result<(SourceRuntime, mpsc::Receiver<InferenceRequest>)> {
    let (inference_tx, inference_rx) = mpsc::channel(INFERENCE_REQUEST_CHANNEL_CAPACITY);
    let (capture_source, device_id) = {
        let capture = capture.lock().await;
        (capture.config.source, capture.config.device_id.clone())
    };

    Ok((
        SourceRuntime {
            source,
            preprocess: PreprocessState::new(
                capture_source,
                device_id,
                transcription_preprocess_config(source),
            ),
            inference_tx,
            silence_tracker: SilenceTracker::new(LIVE_SILENCE_HOLD_MS),
        },
        inference_rx,
    ))
}

#[cfg(test)]
fn samples_to_pcm_chunk(chunk: &AudioChunk) -> Result<PcmChunk> {
    let pcm = chunk
        .samples
        .iter()
        .map(|sample| (sample.clamp(-1.0, 1.0) * 32767.0) as i16)
        .flat_map(i16::to_le_bytes)
        .collect::<Vec<_>>();

    Ok(PcmChunk {
        source: chunk.source,
        device_id: chunk.device_id.clone(),
        sample_rate: chunk.sample_rate,
        channels: chunk.channels,
        frame_count: u32::try_from(chunk.frame_count)
            .map_err(|_| anyhow::anyhow!("audio chunk frame count exceeds u32"))?,
        pcm,
    })
}

fn shutdown_reason_for_error(error: &anyhow::Error) -> String {
    if let Some(session_error) = error.downcast_ref::<crate::transport::BackendSessionError>() {
        if is_terminal_session_error_code(session_error.code.as_deref()) {
            return "session_closed".to_string();
        }

        return "backend_error".to_string();
    }
    if error
        .downcast_ref::<crate::audio::devices::DeviceDiscoveryError>()
        .is_some()
    {
        return "device_error".to_string();
    }
    if error
        .downcast_ref::<crate::audio::capture::CaptureError>()
        .is_some()
    {
        return "capture_error".to_string();
    }
    if error.downcast_ref::<TranscriptionError>().is_some() {
        return "transcription_error".to_string();
    }
    if error
        .downcast_ref::<crate::transport::WebSocketClientError>()
        .is_some()
    {
        return "transport_error".to_string();
    }
    if error.downcast_ref::<ProtocolError>().is_some() {
        return "protocol_error".to_string();
    }

    "runtime_error".to_string()
}

fn should_send_session_stop(reason: Option<&str>) -> bool {
    reason.is_none()
}

fn is_terminal_session_error_code(code: Option<&str>) -> bool {
    matches!(
        code,
        Some(SESSION_EXPIRED_ERROR_CODE | SESSION_CLOSED_ERROR_CODE)
    )
}

#[cfg(test)]
mod tests {
    use super::{samples_to_pcm_chunk, should_send_session_stop, shutdown_reason_for_error};
    use crate::audio::capture::CaptureSource;
    use crate::audio::preprocess::AudioChunk;
    use crate::transport::BackendSessionError;

    #[test]
    fn expired_backend_session_maps_to_session_closed_reason() {
        let error = anyhow::Error::new(BackendSessionError::new(
            "Session has expired.",
            Some("session_expired".to_string()),
        ));

        assert_eq!(shutdown_reason_for_error(&error), "session_closed");
        assert!(!should_send_session_stop(Some("session_closed")));
    }

    #[test]
    fn interrupted_session_does_not_send_session_stop() {
        assert!(!should_send_session_stop(Some("user_interrupt")));
    }

    #[test]
    fn graceful_completion_sends_session_stop() {
        assert!(should_send_session_stop(None));
    }

    #[test]
    fn generic_backend_session_error_remains_backend_error_reason() {
        let error = anyhow::Error::new(BackendSessionError::new(
            "invalid token",
            Some("auth_failed".to_string()),
        ));

        assert_eq!(shutdown_reason_for_error(&error), "backend_error");
        assert!(!should_send_session_stop(Some("backend_error")));
    }

    #[test]
    fn samples_to_pcm_chunk_preserves_basic_shape() {
        let chunk = AudioChunk {
            source: CaptureSource::Mic,
            device_id: "mic-1".to_string(),
            sample_rate: 16_000,
            channels: 1,
            start_ms: 0,
            end_ms: 500,
            frame_count: 3,
            samples: vec![0.0, 0.5, -0.5],
        };

        let pcm = samples_to_pcm_chunk(&chunk).expect("pcm conversion should work");

        assert_eq!(pcm.source, CaptureSource::Mic);
        assert_eq!(pcm.device_id, "mic-1");
        assert_eq!(pcm.sample_rate, 16_000);
        assert_eq!(pcm.channels, 1);
        assert_eq!(pcm.frame_count, 3);
        assert_eq!(pcm.pcm.len(), 6);
    }
}
