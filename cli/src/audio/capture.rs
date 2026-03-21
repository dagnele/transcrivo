use std::collections::HashMap;

use tokio::io::AsyncReadExt;
use tokio::process::{Child, ChildStdout, Command};

use thiserror::Error;

use crate::audio::devices::PipeWireTarget;
use crate::audio::linux_native::NativeLinuxPipeWireRuntime;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CaptureSource {
    Mic,
    System,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureConfig {
    pub source: CaptureSource,
    pub device_id: String,
    pub device_name: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub frames_per_chunk: u32,
}

impl CaptureConfig {
    pub fn new(
        source: CaptureSource,
        device_id: impl Into<String>,
        device_name: impl Into<String>,
    ) -> Self {
        Self {
            source,
            device_id: device_id.into(),
            device_name: device_name.into(),
            sample_rate: 48_000,
            channels: 2,
            frames_per_chunk: 2_048,
        }
    }

    pub fn bytes_per_chunk(&self) -> usize {
        self.frames_per_chunk as usize * usize::from(self.channels) * 2
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PcmChunk {
    pub source: CaptureSource,
    pub device_id: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub frame_count: u32,
    pub pcm: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct PcmFrame {
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub samples: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessCaptureSpec {
    pub program: String,
    pub args: Vec<String>,
}

impl ProcessCaptureSpec {
    pub fn new(program: impl Into<String>, args: Vec<String>) -> Self {
        Self {
            program: program.into(),
            args,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeLinuxCaptureSpec {
    pub target: PipeWireTarget,
}

impl NativeLinuxCaptureSpec {
    pub fn pipewire(target: PipeWireTarget) -> Self {
        Self { target }
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CaptureError {
    #[error("capture backend is not implemented yet")]
    NotImplemented,
    #[error("capture worker is already running")]
    AlreadyRunning,
    #[error("capture worker is not running")]
    NotRunning,
    #[error("captured audio must contain at least one channel")]
    NoChannels,
    #[error("captured audio reported {actual} channels, expected {expected}")]
    ChannelMismatch { expected: u16, actual: usize },
    #[error("failed to spawn capture process: {0}")]
    SpawnFailed(String),
    #[error("capture process did not expose stdout")]
    MissingStdout,
    #[error("failed to read capture chunk: {0}")]
    ReadFailed(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum CaptureBackendSpec {
    Placeholder,
    Process(ProcessCaptureSpec),
    NativeLinuxPipeWire(NativeLinuxCaptureSpec),
}

#[derive(Debug)]
struct ProcessCaptureRuntime {
    child: Child,
    stdout: ChildStdout,
}

impl ProcessCaptureRuntime {
    async fn read_chunk(&mut self, config: &CaptureConfig) -> Result<PcmChunk, CaptureError> {
        let mut pcm = vec![0_u8; config.bytes_per_chunk()];
        self.stdout
            .read_exact(&mut pcm)
            .await
            .map_err(|error| CaptureError::ReadFailed(error.to_string()))?;

        Ok(PcmChunk {
            source: config.source,
            device_id: config.device_id.clone(),
            sample_rate: config.sample_rate,
            channels: config.channels,
            frame_count: config.frames_per_chunk,
            pcm,
        })
    }

    async fn stop(&mut self) {
        let _ = self.child.start_kill();
        let _ = self.child.wait().await;
    }
}

#[derive(Debug)]
enum CaptureRuntime {
    Process(ProcessCaptureRuntime),
    NativeLinuxPipeWire(NativeLinuxPipeWireRuntime),
}

#[derive(Debug)]
pub struct AudioCaptureWorker {
    pub config: CaptureConfig,
    backend: CaptureBackendSpec,
    running: Option<CaptureRuntime>,
}

impl AudioCaptureWorker {
    pub fn placeholder(config: CaptureConfig) -> Self {
        Self {
            config,
            backend: CaptureBackendSpec::Placeholder,
            running: None,
        }
    }

    pub fn process(config: CaptureConfig, spec: ProcessCaptureSpec) -> Self {
        Self {
            config,
            backend: CaptureBackendSpec::Process(spec),
            running: None,
        }
    }

    pub fn native_linux_pipewire(config: CaptureConfig, spec: NativeLinuxCaptureSpec) -> Self {
        Self {
            config,
            backend: CaptureBackendSpec::NativeLinuxPipeWire(spec),
            running: None,
        }
    }

    pub fn process_spec(&self) -> Option<&ProcessCaptureSpec> {
        match &self.backend {
            CaptureBackendSpec::Process(spec) => Some(spec),
            CaptureBackendSpec::Placeholder | CaptureBackendSpec::NativeLinuxPipeWire(_) => None,
        }
    }

    pub async fn start(&mut self) -> Result<(), CaptureError> {
        if self.running.is_some() {
            return Err(CaptureError::AlreadyRunning);
        }

        match &self.backend {
            CaptureBackendSpec::Placeholder => Err(CaptureError::NotImplemented),
            CaptureBackendSpec::Process(spec) => {
                let mut command = Command::new(&spec.program);
                command.args(&spec.args);
                command.stdout(std::process::Stdio::piped());
                command.stderr(std::process::Stdio::null());

                let mut child = command
                    .spawn()
                    .map_err(|error| CaptureError::SpawnFailed(error.to_string()))?;
                let stdout = child.stdout.take().ok_or(CaptureError::MissingStdout)?;
                self.running = Some(CaptureRuntime::Process(ProcessCaptureRuntime {
                    child,
                    stdout,
                }));
                Ok(())
            }
            CaptureBackendSpec::NativeLinuxPipeWire(spec) => {
                let runtime = NativeLinuxPipeWireRuntime::start(spec, &self.config)?;
                self.running = Some(CaptureRuntime::NativeLinuxPipeWire(runtime));
                Ok(())
            }
        }
    }

    pub async fn read_chunk(&mut self) -> Result<PcmChunk, CaptureError> {
        match self.running.as_mut() {
            Some(CaptureRuntime::Process(runtime)) => runtime.read_chunk(&self.config).await,
            Some(CaptureRuntime::NativeLinuxPipeWire(runtime)) => {
                runtime.read_chunk(&self.config).await
            }
            None => Err(CaptureError::NotRunning),
        }
    }

    pub async fn stop(&mut self) -> Result<(), CaptureError> {
        let Some(mut running) = self.running.take() else {
            return Ok(());
        };

        match &mut running {
            CaptureRuntime::Process(runtime) => runtime.stop().await,
            CaptureRuntime::NativeLinuxPipeWire(runtime) => runtime.stop().await,
        }

        Ok(())
    }
}

#[derive(Debug)]
pub struct SourceCaptures {
    workers: HashMap<CaptureSource, AudioCaptureWorker>,
}

impl SourceCaptures {
    pub fn new(mic: AudioCaptureWorker, system: AudioCaptureWorker) -> Self {
        let mut workers = HashMap::with_capacity(2);
        workers.insert(CaptureSource::Mic, mic);
        workers.insert(CaptureSource::System, system);
        Self { workers }
    }

    pub fn get(&self, source: CaptureSource) -> Option<&AudioCaptureWorker> {
        self.workers.get(&source)
    }

    pub fn into_workers(self) -> HashMap<CaptureSource, AudioCaptureWorker> {
        self.workers
    }
}

pub fn pcm16le_from_f32_frames(
    frames: &[Vec<f32>],
    channels: u16,
) -> Result<Vec<u8>, CaptureError> {
    if channels == 0 {
        return Err(CaptureError::NoChannels);
    }

    let mut pcm = Vec::with_capacity(frames.len() * usize::from(channels) * 2);
    for frame in frames {
        if frame.is_empty() {
            return Err(CaptureError::NoChannels);
        }

        if frame.len() == 1 && channels > 1 {
            let sample = scale_sample(frame[0]);
            for _ in 0..channels {
                pcm.extend_from_slice(&sample.to_le_bytes());
            }
            continue;
        }

        if frame.len() != usize::from(channels) {
            return Err(CaptureError::ChannelMismatch {
                expected: channels,
                actual: frame.len(),
            });
        }

        for sample in frame {
            pcm.extend_from_slice(&scale_sample(*sample).to_le_bytes());
        }
    }

    Ok(pcm)
}

fn scale_sample(sample: f32) -> i16 {
    let clipped = sample.clamp(-1.0, 1.0);
    (clipped * 32767.0).round() as i16
}
