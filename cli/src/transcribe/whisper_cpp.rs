use std::env;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use thiserror::Error;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::audio::segmenter::AudioSegment;
use crate::util::paths::default_models_dir;
use crate::util::shutdown::ShutdownController;

pub const DEFAULT_MODEL_NAME: &str = "large";
pub const DEFAULT_MODEL_DIR_ENV: &str = "TRANSCRIVO_WHISPER_MODEL_DIR";
pub const DEFAULT_MODEL_PATH_ENV: &str = "TRANSCRIVO_WHISPER_MODEL_PATH";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WhisperCppConfig {
    pub model_name: String,
    pub language: Option<String>,
    pub translate: bool,
    pub use_context: bool,
    pub use_gpu: bool,
    pub flash_attn: bool,
    pub gpu_device: i32,
}

impl Default for WhisperCppConfig {
    fn default() -> Self {
        Self {
            model_name: DEFAULT_MODEL_NAME.to_string(),
            language: None,
            translate: false,
            use_context: true,
            use_gpu: cfg!(feature = "whisper-gpu"),
            flash_attn: false,
            gpu_device: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TranscriptSegment {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub is_partial: bool,
}

impl TranscriptSegment {
    pub fn validate(&self) -> Result<(), TranscriptionError> {
        if self.text.trim().is_empty() {
            return Err(TranscriptionError::InvalidSegment(
                "Transcript segment text must be non-empty".to_string(),
            ));
        }
        if self.end_ms < self.start_ms {
            return Err(TranscriptionError::InvalidSegment(
                "Transcript segment end_ms must be greater than or equal to start_ms".to_string(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum TranscriptionError {
    #[error("whisper.cpp adapter is not configured")]
    NotConfigured,
    #[error("whisper.cpp model file does not exist: {0}")]
    ModelNotFound(String),
    #[error("failed to load whisper.cpp model: {0}")]
    ModelLoad(String),
    #[error("failed to create whisper.cpp state: {0}")]
    StateCreation(String),
    #[error("failed to run whisper.cpp inference: {0}")]
    Inference(String),
    #[error("transcription aborted")]
    Aborted,
    #[error("{0}")]
    Backend(String),
    #[error("{0}")]
    InvalidSegment(String),
    #[error("{0}")]
    InvalidChunk(String),
    #[error(transparent)]
    Protocol(#[from] crate::transport::protocol::ProtocolError),
}

pub trait WhisperBackend: Send + Sync {
    fn transcribe(
        &self,
        segment: &AudioSegment,
        config: &WhisperCppConfig,
    ) -> Result<Vec<TranscriptSegment>, TranscriptionError>;
}

pub const TRANSCRIPTION_BACKEND_WHISPER_RS: &str = "whisper-rs";

#[derive(Debug)]
pub struct RealWhisperBackend {
    state: Mutex<RealWhisperState>,
    shutdown: Option<ShutdownController>,
}

#[derive(Debug)]
struct RealWhisperState {
    context: WhisperContext,
    state: whisper_rs::WhisperState,
}

impl RealWhisperBackend {
    pub fn new<P: AsRef<Path>>(
        model_path: P,
        config: &WhisperCppConfig,
    ) -> Result<Self, TranscriptionError> {
        let model_path = model_path.as_ref().to_path_buf();
        if !model_path.is_file() {
            return Err(TranscriptionError::ModelNotFound(
                model_path.display().to_string(),
            ));
        }

        let mut context_params = WhisperContextParameters::default();
        context_params
            .use_gpu(config.use_gpu)
            .flash_attn(config.flash_attn)
            .gpu_device(config.gpu_device);

        let context = WhisperContext::new_with_params(&model_path, context_params)
            .map_err(|error| TranscriptionError::ModelLoad(error.to_string()))?;
        let state = context
            .create_state()
            .map_err(|error| TranscriptionError::StateCreation(error.to_string()))?;

        Ok(Self {
            state: Mutex::new(RealWhisperState { context, state }),
            shutdown: None,
        })
    }

    pub fn from_config(config: &WhisperCppConfig) -> Result<Self, TranscriptionError> {
        let path = resolve_model_path(config)?;
        Self::new(path, config)
    }

    pub fn with_shutdown_controller(mut self, shutdown: ShutdownController) -> Self {
        self.shutdown = Some(shutdown);
        self
    }
}

impl WhisperBackend for RealWhisperBackend {
    fn transcribe(
        &self,
        segment: &AudioSegment,
        config: &WhisperCppConfig,
    ) -> Result<Vec<TranscriptSegment>, TranscriptionError> {
        if segment.samples.is_empty() {
            return Ok(Vec::new());
        }

        let mut guard = self.state.lock().map_err(|_| {
            TranscriptionError::Backend("whisper.cpp backend lock poisoned".to_string())
        })?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        let language = normalized_language(config, &guard.context);
        params.set_n_threads(default_thread_count());
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_special(false);
        params.set_print_timestamps(false);
        params.set_no_context(!config.use_context);
        params.set_translate(config.translate);
        params.set_single_segment(false);
        params.set_language(language.as_deref());
        if let Some(shutdown) = self.shutdown.clone() {
            params.set_abort_callback_safe::<_, Box<dyn FnMut() -> bool>>(Some(Box::new(move || {
                shutdown.is_requested()
            })
                as Box<dyn FnMut() -> bool>));
        }

        guard
            .state
            .full(params, &segment.samples)
            .map_err(|error| match error {
                whisper_rs::WhisperError::GenericError(-2)
                | whisper_rs::WhisperError::GenericError(-6)
                | whisper_rs::WhisperError::GenericError(-8)
                | whisper_rs::WhisperError::GenericError(-9)
                    if self
                        .shutdown
                        .as_ref()
                        .is_some_and(ShutdownController::is_requested) =>
                {
                    TranscriptionError::Aborted
                }
                _ => TranscriptionError::Inference(error.to_string()),
            })?;

        let mut results = Vec::new();
        for whisper_segment in guard.state.as_iter() {
            let text = whisper_segment
                .to_str_lossy()
                .map_err(|error| TranscriptionError::Inference(error.to_string()))?
                .trim()
                .to_string();
            if text.is_empty() {
                continue;
            }

            let start_ms = segment
                .start_ms
                .saturating_add(timestamp_to_ms(whisper_segment.start_timestamp()));
            let end_ms = segment.end_ms.min(
                segment
                    .start_ms
                    .saturating_add(timestamp_to_ms(whisper_segment.end_timestamp())),
            );

            results.push(TranscriptSegment {
                text,
                start_ms,
                end_ms: end_ms.max(start_ms),
                is_partial: false,
            });
        }

        Ok(results)
    }
}

pub struct WhisperCppAdapter {
    pub config: WhisperCppConfig,
    backend: Arc<dyn WhisperBackend>,
}

impl std::fmt::Debug for WhisperCppAdapter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WhisperCppAdapter")
            .field("config", &self.config)
            .finish()
    }
}

impl Clone for WhisperCppAdapter {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            backend: Arc::clone(&self.backend),
        }
    }
}

impl WhisperCppAdapter {
    pub fn new(config: WhisperCppConfig, backend: Box<dyn WhisperBackend>) -> Self {
        Self {
            config,
            backend: Arc::from(backend),
        }
    }

    pub fn from_shared_backend(config: WhisperCppConfig, backend: Arc<dyn WhisperBackend>) -> Self {
        Self { config, backend }
    }

    pub fn real_at_path<P: AsRef<Path>>(
        config: WhisperCppConfig,
        model_path: P,
    ) -> Result<Self, TranscriptionError> {
        let backend = Arc::new(RealWhisperBackend::new(model_path, &config)?);
        Ok(Self { config, backend })
    }

    /// Async variant that runs the blocking whisper inference on a dedicated
    /// thread via `tokio::task::spawn_blocking`, keeping the async event loop
    /// responsive.
    pub async fn transcribe_chunk_async(
        &self,
        segment: &AudioSegment,
    ) -> Result<Vec<TranscriptSegment>, TranscriptionError> {
        Self::validate_chunk(segment)?;

        let backend = Arc::clone(&self.backend);
        let config = self.config.clone();
        let segment = segment.clone();

        let segments = tokio::task::spawn_blocking(move || backend.transcribe(&segment, &config))
            .await
            .map_err(|join_error| {
                TranscriptionError::Backend(format!(
                    "whisper inference task panicked: {join_error}"
                ))
            })??;

        let mut output = Vec::new();
        for segment in segments {
            segment.validate()?;
            output.push(segment);
        }
        Ok(output)
    }

    fn validate_chunk(segment: &AudioSegment) -> Result<(), TranscriptionError> {
        if segment.channels != 1 {
            return Err(TranscriptionError::InvalidChunk(
                "Transcription input must be mono audio".to_string(),
            ));
        }
        if segment.sample_rate == 0 {
            return Err(TranscriptionError::InvalidChunk(
                "Transcription input sample rate must be greater than zero".to_string(),
            ));
        }
        if segment.sample_rate != 16_000 {
            return Err(TranscriptionError::InvalidChunk(
                "Transcription input sample rate must be 16 kHz".to_string(),
            ));
        }
        Ok(())
    }
}

pub fn resolve_model_path(config: &WhisperCppConfig) -> Result<PathBuf, TranscriptionError> {
    if let Some(explicit) = env::var_os(DEFAULT_MODEL_PATH_ENV) {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Ok(path);
        }
        return Err(TranscriptionError::ModelNotFound(
            path.display().to_string(),
        ));
    }

    let mut candidates = Vec::new();
    if let Some(dir) = env::var_os(DEFAULT_MODEL_DIR_ENV) {
        candidates.push(PathBuf::from(dir).join(model_file_name(&config.model_name)));
    }

    if let Some(dir) = default_models_dir() {
        candidates.push(dir.join(model_file_name(&config.model_name)));
    }

    candidates.push(PathBuf::from(model_file_name(&config.model_name)));

    for candidate in candidates {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(TranscriptionError::ModelNotFound(model_file_name(
        &config.model_name,
    )))
}

fn model_file_name(model_name: &str) -> String {
    if model_name.ends_with(".bin") {
        model_name.to_string()
    } else {
        let resolved = match model_name {
            "large" => "large-v3",
            other => other,
        };
        format!("ggml-{resolved}.bin")
    }
}

fn normalized_language(config: &WhisperCppConfig, context: &WhisperContext) -> Option<String> {
    match config.language.as_deref().map(str::trim) {
        None | Some("") | Some("auto") => None,
        Some(_language) if !context.is_multilingual() => Some("en".to_string()),
        Some(language) => Some(language.to_string()),
    }
}

pub fn transcription_backend_name() -> &'static str {
    TRANSCRIPTION_BACKEND_WHISPER_RS
}

fn default_thread_count() -> i32 {
    let available = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(1);
    available.min(4) as i32
}

fn timestamp_to_ms(timestamp_cs: i64) -> u64 {
    if timestamp_cs <= 0 {
        0
    } else {
        (timestamp_cs as u64).saturating_mul(10)
    }
}

#[cfg(test)]
mod tests {
    use super::{model_file_name, timestamp_to_ms};

    #[test]
    fn model_file_name_adds_ggml_prefix() {
        assert_eq!(model_file_name("small"), "ggml-small.bin");
        assert_eq!(model_file_name("large"), "ggml-large-v3.bin");
        assert_eq!(model_file_name("custom.bin"), "custom.bin");
    }

    #[test]
    fn whisper_timestamp_converts_centiseconds_to_ms() {
        assert_eq!(timestamp_to_ms(-1), 0);
        assert_eq!(timestamp_to_ms(0), 0);
        assert_eq!(timestamp_to_ms(42), 420);
    }
}
