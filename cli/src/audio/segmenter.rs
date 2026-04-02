use thiserror::Error;
use tracing::debug;

use crate::audio::capture::PcmChunk;
use crate::audio::preprocess::{
    frames_to_ms, prepare_pcm_chunk, PreprocessConfig, PreprocessError,
};
use crate::audio::vad::{chunk_rms, is_speech_chunk, VadConfig};
use crate::session::models::Source;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SegmentBoundary {
    Silence,
    MaxDuration,
    Flush,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AudioSegment {
    pub source: Source,
    pub device_id: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub start_ms: u64,
    pub end_ms: u64,
    pub samples: Vec<f32>,
    pub boundary: SegmentBoundary,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SegmenterConfig {
    pub preprocess: PreprocessConfig,
    pub vad: VadConfig,
    pub silence_hold_ms: u64,
    pub max_segment_ms: u64,
}

#[derive(Debug)]
pub struct Segmenter {
    source: Source,
    device_id: String,
    config: SegmenterConfig,
    processed_frames: usize,
    active_start_frame: Option<usize>,
    active_samples: Vec<f32>,
    trailing_silence_samples: Vec<f32>,
    silence_frames: usize,
}

#[derive(Debug, Error)]
pub enum SegmenterError {
    #[error(transparent)]
    Preprocess(#[from] PreprocessError),
    #[error("missing active segment start frame")]
    MissingActiveStartFrame,
}

impl Segmenter {
    pub fn new(source: Source, device_id: impl Into<String>, config: SegmenterConfig) -> Self {
        Self {
            source,
            device_id: device_id.into(),
            config,
            processed_frames: 0,
            active_start_frame: None,
            active_samples: Vec::new(),
            trailing_silence_samples: Vec::new(),
            silence_frames: 0,
        }
    }

    pub fn push_chunk(&mut self, chunk: &PcmChunk) -> Result<Vec<AudioSegment>, SegmenterError> {
        let prepared = prepare_pcm_chunk(chunk, &self.config.preprocess)?;
        let frame_len = prepared.samples.len();
        let rms = chunk_rms(&prepared.samples).unwrap_or(0.0);
        let peak = prepared
            .samples
            .iter()
            .fold(0.0_f32, |current, sample| current.max(sample.abs()));
        let is_speech = is_speech_chunk(&prepared.samples, &self.config.vad);
        let mut emitted = Vec::new();

        debug!(
            source = ?self.source,
            device_id = %self.device_id,
            is_speech,
            rms,
            peak,
            min_rms = self.config.vad.min_rms,
            input_duration_ms = prepared.duration_ms,
            active_samples = self.active_samples.len(),
            trailing_silence_samples = self.trailing_silence_samples.len(),
            "segmenter processed capture chunk"
        );

        match self.active_start_frame {
            None => {
                if is_speech {
                    self.active_start_frame = Some(self.processed_frames);
                    self.active_samples = prepared.samples;
                    self.trailing_silence_samples.clear();
                    self.silence_frames = 0;
                }
            }
            Some(_) => {
                if is_speech {
                    if !self.trailing_silence_samples.is_empty() {
                        self.active_samples
                            .append(&mut self.trailing_silence_samples);
                    }
                    self.active_samples.extend(prepared.samples);
                    self.silence_frames = 0;

                    if self.active_duration_ms()? >= self.config.max_segment_ms {
                        emitted.push(self.take_segment(SegmentBoundary::MaxDuration)?);
                    }
                } else {
                    self.trailing_silence_samples.extend(prepared.samples);
                    self.silence_frames = self.silence_frames.saturating_add(frame_len);

                    if self.silence_duration_ms()? >= self.config.silence_hold_ms {
                        emitted.push(self.take_segment(SegmentBoundary::Silence)?);
                    }
                }
            }
        }

        self.processed_frames = self.processed_frames.saturating_add(frame_len);
        Ok(emitted)
    }

    pub fn flush(&mut self) -> Result<Option<AudioSegment>, SegmenterError> {
        if self.active_start_frame.is_none() || self.active_samples.is_empty() {
            self.clear_active();
            return Ok(None);
        }

        Ok(Some(self.take_segment(SegmentBoundary::Flush)?))
    }

    fn active_duration_ms(&self) -> Result<u64, SegmenterError> {
        Ok(frames_to_ms(
            self.active_samples.len(),
            self.config.preprocess.target_sample_rate,
        )?)
    }

    fn silence_duration_ms(&self) -> Result<u64, SegmenterError> {
        Ok(frames_to_ms(
            self.silence_frames,
            self.config.preprocess.target_sample_rate,
        )?)
    }

    fn take_segment(&mut self, boundary: SegmentBoundary) -> Result<AudioSegment, SegmenterError> {
        let start_frame = self
            .active_start_frame
            .ok_or(SegmenterError::MissingActiveStartFrame)?;
        let samples = std::mem::take(&mut self.active_samples);
        let start_ms = frames_to_ms(start_frame, self.config.preprocess.target_sample_rate)?;
        let end_ms = frames_to_ms(
            start_frame.saturating_add(samples.len()),
            self.config.preprocess.target_sample_rate,
        )?;

        let segment = AudioSegment {
            source: self.source,
            device_id: self.device_id.clone(),
            sample_rate: self.config.preprocess.target_sample_rate,
            channels: self.config.preprocess.target_channels,
            start_ms,
            end_ms,
            samples,
            boundary,
        };

        debug!(
            source = ?segment.source,
            boundary = ?segment.boundary,
            start_ms = segment.start_ms,
            end_ms = segment.end_ms,
            sample_count = segment.samples.len(),
            "segmenter emitted audio segment"
        );

        self.clear_active();
        Ok(segment)
    }

    fn clear_active(&mut self) {
        self.active_start_frame = None;
        self.active_samples.clear();
        self.trailing_silence_samples.clear();
        self.silence_frames = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::{AudioSegment, SegmentBoundary, Segmenter, SegmenterConfig};
    use crate::audio::capture::{CaptureSource, PcmChunk};
    use crate::audio::preprocess::PreprocessConfig;
    use crate::audio::vad::VadConfig;
    use crate::session::models::Source;

    fn mono_pcm(samples: &[f32]) -> Vec<u8> {
        samples
            .iter()
            .map(|sample| ((*sample).clamp(-1.0, 1.0) * 32767.0) as i16)
            .flat_map(i16::to_le_bytes)
            .collect()
    }

    fn chunk(start_ms: u64, samples: &[f32]) -> PcmChunk {
        let frame_count = u32::try_from(samples.len()).expect("sample count fits u32");
        let _ = start_ms;
        PcmChunk {
            source: CaptureSource::Mic,
            device_id: "mic-1".to_string(),
            sample_rate: 16_000,
            channels: 1,
            frame_count,
            pcm: mono_pcm(samples),
        }
    }

    fn config() -> SegmenterConfig {
        SegmenterConfig {
            preprocess: PreprocessConfig::default(),
            vad: VadConfig {
                enabled: true,
                min_rms: 0.01,
            },
            silence_hold_ms: 250,
            max_segment_ms: 500,
        }
    }

    fn assert_segment(
        segment: &AudioSegment,
        boundary: SegmentBoundary,
        start_ms: u64,
        end_ms: u64,
    ) {
        assert_eq!(segment.boundary, boundary);
        assert_eq!(segment.start_ms, start_ms);
        assert_eq!(segment.end_ms, end_ms);
        assert_eq!(segment.source, Source::Mic);
    }

    #[test]
    fn silence_only_input_emits_nothing() {
        let mut segmenter = Segmenter::new(Source::Mic, "mic-1", config());

        let first = segmenter
            .push_chunk(&chunk(0, &vec![0.0; 2048]))
            .expect("first silence should work");
        let second = segmenter
            .push_chunk(&chunk(128, &vec![0.0; 2048]))
            .expect("second silence should work");

        assert!(first.is_empty());
        assert!(second.is_empty());
        assert!(segmenter.flush().expect("flush should work").is_none());
    }

    #[test]
    fn speech_followed_by_long_silence_emits_silence_bounded_segment() {
        let mut segmenter = Segmenter::new(Source::Mic, "mic-1", config());

        assert!(segmenter
            .push_chunk(&chunk(0, &vec![0.2; 2048]))
            .expect("speech should work")
            .is_empty());
        assert!(segmenter
            .push_chunk(&chunk(128, &vec![0.0; 2048]))
            .expect("first silence should work")
            .is_empty());
        let emitted = segmenter
            .push_chunk(&chunk(256, &vec![0.0; 2048]))
            .expect("second silence should emit");

        assert_eq!(emitted.len(), 1);
        assert_segment(&emitted[0], SegmentBoundary::Silence, 0, 128);
    }

    #[test]
    fn short_pause_is_kept_in_order_when_speech_resumes() {
        let mut segmenter = Segmenter::new(Source::Mic, "mic-1", config());

        assert!(segmenter
            .push_chunk(&chunk(0, &vec![0.2; 2048]))
            .expect("opening speech should work")
            .is_empty());
        assert!(segmenter
            .push_chunk(&chunk(128, &vec![0.0; 2048]))
            .expect("short silence should work")
            .is_empty());
        let emitted = segmenter
            .push_chunk(&chunk(256, &vec![0.2; 2048]))
            .expect("resumed speech should work");
        let flushed = segmenter
            .flush()
            .expect("flush should work")
            .expect("flush output");

        assert!(emitted.is_empty());
        assert_segment(&flushed, SegmentBoundary::Flush, 0, 384);
        assert_eq!(flushed.samples.len(), 2048 * 3);
    }

    #[test]
    fn long_monologue_emits_max_duration_segment() {
        let mut segmenter = Segmenter::new(Source::Mic, "mic-1", config());

        assert!(segmenter
            .push_chunk(&chunk(0, &vec![0.2; 2048]))
            .expect("chunk 1 should work")
            .is_empty());
        assert!(segmenter
            .push_chunk(&chunk(128, &vec![0.2; 2048]))
            .expect("chunk 2 should work")
            .is_empty());
        assert!(segmenter
            .push_chunk(&chunk(256, &vec![0.2; 2048]))
            .expect("chunk 3 should work")
            .is_empty());
        let emitted = segmenter
            .push_chunk(&chunk(384, &vec![0.2; 2048]))
            .expect("chunk 4 should emit");

        assert_eq!(emitted.len(), 1);
        assert_segment(&emitted[0], SegmentBoundary::MaxDuration, 0, 512);
    }

    #[test]
    fn flush_emits_active_speech_without_trailing_silence() {
        let mut segmenter = Segmenter::new(Source::Mic, "mic-1", config());

        assert!(segmenter
            .push_chunk(&chunk(0, &vec![0.2; 2048]))
            .expect("speech should work")
            .is_empty());
        assert!(segmenter
            .push_chunk(&chunk(128, &vec![0.0; 2048]))
            .expect("silence should work")
            .is_empty());
        let flushed = segmenter
            .flush()
            .expect("flush should work")
            .expect("flush output");

        assert_segment(&flushed, SegmentBoundary::Flush, 0, 128);
        assert_eq!(flushed.samples.len(), 2048);
    }
}
