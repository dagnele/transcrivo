use std::collections::HashMap;

use thiserror::Error;

#[cfg(target_os = "linux")]
use crate::audio::linux_native::{NativeLinuxCaptureSpec, NativeLinuxPipeWireRuntime};
#[cfg(target_os = "windows")]
use crate::audio::windows_native::{NativeWindowsCaptureSpec, NativeWindowsWasapiRuntime};

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
            sample_rate: 16_000,
            channels: 1,
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

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CaptureError {
    #[error("capture worker is already running")]
    AlreadyRunning,
    #[error("capture worker is not running")]
    NotRunning,
    #[error("captured audio must contain at least one channel")]
    NoChannels,
    #[error("captured audio reported {actual} channels, expected {expected}")]
    ChannelMismatch { expected: u16, actual: usize },
    #[error("failed to initialize capture backend: {0}")]
    SpawnFailed(String),
    #[error("failed to read capture chunk: {0}")]
    ReadFailed(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum CaptureBackendSpec {
    #[cfg(target_os = "linux")]
    NativeLinuxPipeWire(NativeLinuxCaptureSpec),
    #[cfg(target_os = "windows")]
    NativeWindowsWasapi(NativeWindowsCaptureSpec),
}

#[derive(Debug)]
enum CaptureRuntime {
    #[cfg(target_os = "linux")]
    NativeLinuxPipeWire(NativeLinuxPipeWireRuntime),
    #[cfg(target_os = "windows")]
    NativeWindowsWasapi(NativeWindowsWasapiRuntime),
}

#[derive(Debug)]
pub struct AudioCaptureWorker {
    pub config: CaptureConfig,
    backend: CaptureBackendSpec,
    running: Option<CaptureRuntime>,
}

impl AudioCaptureWorker {
    #[cfg(target_os = "linux")]
    pub fn native_linux_pipewire(config: CaptureConfig, spec: NativeLinuxCaptureSpec) -> Self {
        Self {
            config,
            backend: CaptureBackendSpec::NativeLinuxPipeWire(spec),
            running: None,
        }
    }

    #[cfg(target_os = "windows")]
    pub fn native_windows_wasapi(config: CaptureConfig, spec: NativeWindowsCaptureSpec) -> Self {
        Self {
            config,
            backend: CaptureBackendSpec::NativeWindowsWasapi(spec),
            running: None,
        }
    }

    pub async fn start(&mut self) -> Result<(), CaptureError> {
        if self.running.is_some() {
            return Err(CaptureError::AlreadyRunning);
        }

        match &self.backend {
            #[cfg(target_os = "linux")]
            CaptureBackendSpec::NativeLinuxPipeWire(spec) => {
                let runtime = NativeLinuxPipeWireRuntime::start(spec, &self.config)?;
                self.running = Some(CaptureRuntime::NativeLinuxPipeWire(runtime));
                Ok(())
            }
            #[cfg(target_os = "windows")]
            CaptureBackendSpec::NativeWindowsWasapi(spec) => {
                let runtime = NativeWindowsWasapiRuntime::start(spec, &self.config)?;
                self.running = Some(CaptureRuntime::NativeWindowsWasapi(runtime));
                Ok(())
            }
        }
    }

    pub async fn read_chunk(&mut self) -> Result<PcmChunk, CaptureError> {
        match self.running.as_mut() {
            #[cfg(target_os = "linux")]
            Some(CaptureRuntime::NativeLinuxPipeWire(runtime)) => {
                runtime.read_chunk(&self.config).await
            }
            #[cfg(target_os = "windows")]
            Some(CaptureRuntime::NativeWindowsWasapi(runtime)) => {
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
            #[cfg(target_os = "linux")]
            CaptureRuntime::NativeLinuxPipeWire(runtime) => runtime.stop().await,
            #[cfg(target_os = "windows")]
            CaptureRuntime::NativeWindowsWasapi(runtime) => runtime.stop().await,
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
