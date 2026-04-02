use thiserror::Error;

use crate::audio::capture::PcmChunk;

pub const TARGET_SAMPLE_RATE: u32 = 16_000;
pub const TARGET_CHANNELS: u16 = 1;

#[derive(Debug, Clone, PartialEq)]
pub struct PreprocessConfig {
    pub target_sample_rate: u32,
    pub target_channels: u16,
    pub normalize: bool,
}

impl Default for PreprocessConfig {
    fn default() -> Self {
        Self {
            target_sample_rate: TARGET_SAMPLE_RATE,
            target_channels: TARGET_CHANNELS,
            normalize: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PreparedAudio {
    pub duration_ms: u64,
    pub samples: Vec<f32>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PreprocessError {
    #[error("channels must be greater than zero")]
    InvalidChannels,
    #[error("PCM buffer size is not divisible by channel count")]
    InvalidPcmShape,
    #[error("sample rates must be greater than zero")]
    InvalidSampleRate,
    #[error("frame_count must be zero or greater")]
    InvalidFrameCount,
}

pub fn prepare_pcm_chunk(
    chunk: &PcmChunk,
    config: &PreprocessConfig,
) -> Result<PreparedAudio, PreprocessError> {
    let mut samples = if chunk.channels == config.target_channels
        && chunk.sample_rate == config.target_sample_rate
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

        if chunk.sample_rate == config.target_sample_rate {
            mono
        } else {
            resample_audio(&mono, chunk.sample_rate, config.target_sample_rate)?
        }
    };

    if config.normalize {
        samples = normalize_audio(&samples, 0.95);
    }

    Ok(PreparedAudio {
        duration_ms: frames_to_ms(samples.len(), config.target_sample_rate)?,
        samples,
    })
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
        return Err(PreprocessError::InvalidFrameCount);
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
