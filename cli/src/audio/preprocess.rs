use std::collections::VecDeque;

use thiserror::Error;

use crate::audio::capture::{CaptureSource, PcmChunk};
use crate::audio::vad::{is_speech_chunk, VadConfig};

pub const TARGET_SAMPLE_RATE: u32 = 16_000;
pub const TARGET_CHANNELS: u16 = 1;
pub const DEFAULT_CHUNK_MS: u32 = 1_000;

#[derive(Debug, Clone, PartialEq)]
pub struct PreprocessConfig {
    pub target_sample_rate: u32,
    pub target_channels: u16,
    pub chunk_duration_ms: u32,
    pub normalize: bool,
}

impl Default for PreprocessConfig {
    fn default() -> Self {
        Self {
            target_sample_rate: TARGET_SAMPLE_RATE,
            target_channels: TARGET_CHANNELS,
            chunk_duration_ms: DEFAULT_CHUNK_MS,
            normalize: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AudioChunk {
    pub source: CaptureSource,
    pub device_id: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub start_ms: u64,
    pub end_ms: u64,
    pub frame_count: usize,
    pub samples: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PreprocessState {
    pub config: PreprocessConfig,
    pub source: CaptureSource,
    pub device_id: String,
    buffer: VecDeque<f32>,
    processed_frames: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PreprocessResult {
    pub is_speech: bool,
    pub chunk_duration_ms: u64,
    pub emitted_chunks: Vec<AudioChunk>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PreprocessError {
    #[error("channels must be greater than zero")]
    InvalidChannels,
    #[error("PCM buffer size is not divisible by channel count")]
    InvalidPcmShape,
    #[error("sample rates must be greater than zero")]
    InvalidSampleRate,
    #[error("duration_ms must be greater than zero")]
    InvalidDuration,
    #[error("frame_count must be zero or greater")]
    InvalidFrameCount,
}

impl PreprocessState {
    pub fn new(
        source: CaptureSource,
        device_id: impl Into<String>,
        config: PreprocessConfig,
    ) -> Self {
        Self {
            config,
            source,
            device_id: device_id.into(),
            buffer: VecDeque::new(),
            processed_frames: 0,
        }
    }

    pub fn process(&mut self, chunk: &PcmChunk) -> Result<Vec<AudioChunk>, PreprocessError> {
        let prepared = self.prepare_chunk(chunk)?;
        self.append_and_emit(prepared.samples)
    }

    pub fn process_with_vad(
        &mut self,
        chunk: &PcmChunk,
        vad_config: &VadConfig,
    ) -> Result<PreprocessResult, PreprocessError> {
        let prepared = self.prepare_chunk(chunk)?;
        let is_speech = is_speech_chunk(&prepared.samples, vad_config);
        let emitted_chunks = self.append_and_emit(prepared.samples)?;

        Ok(PreprocessResult {
            is_speech,
            chunk_duration_ms: prepared.duration_ms,
            emitted_chunks,
        })
    }

    pub fn flush(&mut self) -> Result<Option<AudioChunk>, PreprocessError> {
        if self.buffer.is_empty() {
            return Ok(None);
        }

        let chunk = self.take_buffered_chunk(self.buffer.len())?;

        Ok(Some(chunk))
    }

    fn take_buffered_chunk(&mut self, frame_count: usize) -> Result<AudioChunk, PreprocessError> {
        let samples: Vec<f32> = self.buffer.drain(..frame_count).collect();
        let start_ms = frames_to_ms(self.processed_frames, self.config.target_sample_rate)?;
        self.processed_frames += samples.len();
        let end_ms = frames_to_ms(self.processed_frames, self.config.target_sample_rate)?;

        Ok(AudioChunk {
            source: self.source,
            device_id: self.device_id.clone(),
            sample_rate: self.config.target_sample_rate,
            channels: self.config.target_channels,
            start_ms,
            end_ms,
            frame_count: samples.len(),
            samples,
        })
    }

    fn prepare_chunk(&self, chunk: &PcmChunk) -> Result<PreparedChunk, PreprocessError> {
        let mut samples = if chunk.channels == self.config.target_channels
            && chunk.sample_rate == self.config.target_sample_rate
        {
            decode_pcm16le_mono(&chunk.pcm)?
        } else {
            let frames = pcm16le_to_f32(&chunk.pcm, chunk.channels)?;
            let mono = if chunk.channels == 1 {
                frames
                    .into_iter()
                    .map(|frame| frame.first().copied().unwrap_or(0.0))
                    .collect()
            } else {
                downmix_to_mono(&frames)
            };

            if chunk.sample_rate == self.config.target_sample_rate {
                mono
            } else {
                resample_audio(&mono, chunk.sample_rate, self.config.target_sample_rate)?
            }
        };

        if self.config.normalize {
            samples = normalize_audio(&samples, 0.95);
        }

        Ok(PreparedChunk {
            duration_ms: frames_to_ms(samples.len(), self.config.target_sample_rate)?,
            samples,
        })
    }

    fn append_and_emit(&mut self, samples: Vec<f32>) -> Result<Vec<AudioChunk>, PreprocessError> {
        self.buffer.extend(samples);

        let chunk_frames = ms_to_frames(
            self.config.chunk_duration_ms,
            self.config.target_sample_rate,
        )?;
        let mut output = Vec::new();

        while self.buffer.len() >= chunk_frames {
            output.push(self.take_buffered_chunk(chunk_frames)?);
        }

        Ok(output)
    }
}

#[derive(Debug, Clone, PartialEq)]
struct PreparedChunk {
    duration_ms: u64,
    samples: Vec<f32>,
}

fn decode_pcm16le_mono(pcm: &[u8]) -> Result<Vec<f32>, PreprocessError> {
    if !pcm.len().is_multiple_of(2) {
        return Err(PreprocessError::InvalidPcmShape);
    }

    Ok(pcm
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / 32767.0)
        .collect())
}

pub fn pcm16le_to_f32(pcm: &[u8], channels: u16) -> Result<Vec<Vec<f32>>, PreprocessError> {
    if channels == 0 {
        return Err(PreprocessError::InvalidChannels);
    }
    if !pcm.len().is_multiple_of(2) {
        return Err(PreprocessError::InvalidPcmShape);
    }

    let samples: Vec<i16> = pcm
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    let channels_usize = usize::from(channels);
    if !samples.len().is_multiple_of(channels_usize) {
        return Err(PreprocessError::InvalidPcmShape);
    }

    Ok(samples
        .chunks_exact(channels_usize)
        .map(|frame| {
            frame
                .iter()
                .map(|sample| *sample as f32 / 32767.0)
                .collect::<Vec<_>>()
        })
        .collect())
}

pub fn downmix_to_mono(frames: &[Vec<f32>]) -> Vec<f32> {
    frames
        .iter()
        .map(|frame| {
            if frame.is_empty() {
                0.0
            } else {
                frame.iter().sum::<f32>() / frame.len() as f32
            }
        })
        .collect()
}

pub fn normalize_audio(frames: &[f32], peak: f32) -> Vec<f32> {
    let max_value = frames
        .iter()
        .fold(0.0_f32, |current, sample| current.max(sample.abs()));
    if max_value <= 0.0 {
        return frames.to_vec();
    }

    let scale = peak / max_value;
    frames
        .iter()
        .map(|sample| (sample * scale).clamp(-1.0, 1.0))
        .collect()
}

pub fn resample_audio(
    frames: &[f32],
    source_sample_rate: u32,
    target_sample_rate: u32,
) -> Result<Vec<f32>, PreprocessError> {
    if source_sample_rate == 0 || target_sample_rate == 0 {
        return Err(PreprocessError::InvalidSampleRate);
    }
    if source_sample_rate == target_sample_rate || frames.is_empty() {
        return Ok(frames.to_vec());
    }

    let source_length = frames.len();
    let target_length = ((source_length as f64 * target_sample_rate as f64
        / source_sample_rate as f64)
        .round() as usize)
        .max(1);
    let max_source_index = (source_length - 1) as f64;

    let mut resampled = Vec::with_capacity(target_length);
    for index in 0..target_length {
        let position = if target_length == 1 {
            0.0
        } else {
            index as f64 * max_source_index / (target_length - 1) as f64
        };
        let left = position.floor() as usize;
        let right = position.ceil() as usize;
        if left == right {
            resampled.push(frames[left]);
        } else {
            let weight = (position - left as f64) as f32;
            let value = frames[left] * (1.0 - weight) + frames[right] * weight;
            resampled.push(value);
        }
    }

    Ok(resampled)
}

pub fn ms_to_frames(duration_ms: u32, sample_rate: u32) -> Result<usize, PreprocessError> {
    if duration_ms == 0 {
        return Err(PreprocessError::InvalidDuration);
    }
    if sample_rate == 0 {
        return Err(PreprocessError::InvalidSampleRate);
    }

    Ok(((duration_ms as f64 * sample_rate as f64) / 1000.0).round() as usize)
}

pub fn frames_to_ms(frame_count: usize, sample_rate: u32) -> Result<u64, PreprocessError> {
    if sample_rate == 0 {
        return Err(PreprocessError::InvalidSampleRate);
    }

    Ok(((frame_count as f64 * 1000.0) / sample_rate as f64).round() as u64)
}
