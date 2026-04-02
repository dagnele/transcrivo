use tracing::{debug, error};

use crate::audio::segmenter::{AudioSegment, SegmentBoundary};
use crate::session::models::Source;
use crate::transcribe::whisper_cpp::{TranscriptionError, TranscriptSegment, WhisperCppAdapter};

#[derive(Debug, Clone, PartialEq)]
pub struct TranscriptChunk {
    pub source: Source,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub audio_boundary: SegmentBoundary,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TranscriptBatch {
    pub source: Source,
    pub audio_boundary: SegmentBoundary,
    pub chunks: Vec<TranscriptChunk>,
}

#[derive(Debug)]
pub struct TranscriberStage {
    source: Source,
    adapter: WhisperCppAdapter,
}

impl TranscriberStage {
    pub fn new(source: Source, adapter: WhisperCppAdapter) -> Self {
        Self { source, adapter }
    }

    pub async fn transcribe_batch(
        &self,
        segment: &AudioSegment,
    ) -> Result<TranscriptBatch, TranscriptionError> {
        if segment.source != self.source {
            return Err(TranscriptionError::InvalidChunk(format!(
                "Transcriber stage for {:?} cannot process segment from {:?}",
                self.source, segment.source
            )));
        }

        debug!(
            source = ?segment.source,
            boundary = ?segment.boundary,
            start_ms = segment.start_ms,
            end_ms = segment.end_ms,
            sample_count = segment.samples.len(),
            "starting segment transcription"
        );

        let segments = self.adapter.transcribe_chunk_async(segment).await;
        match &segments {
            Ok(output) => {
                debug!(
                    source = ?segment.source,
                    boundary = ?segment.boundary,
                    transcript_segments = output.len(),
                    "finished segment transcription"
                );
            }
            Err(error) => {
                error!(
                    source = ?segment.source,
                    boundary = ?segment.boundary,
                    start_ms = segment.start_ms,
                    end_ms = segment.end_ms,
                    error = %error,
                    "segment transcription failed"
                );
            }
        }

        segments.map(|items| TranscriptBatch {
            source: self.source,
            audio_boundary: segment.boundary,
            chunks: items
                .into_iter()
                .map(|item| transcript_chunk_from_segment(self.source, segment.boundary, item))
                .collect(),
        })
    }
}

fn transcript_chunk_from_segment(
    source: Source,
    audio_boundary: SegmentBoundary,
    segment: TranscriptSegment,
) -> TranscriptChunk {
    TranscriptChunk {
        source,
        start_ms: segment.start_ms,
        end_ms: segment.end_ms,
        text: segment.text,
        audio_boundary,
    }
}

#[cfg(test)]
mod tests {
    use super::{TranscriptBatch, TranscriptChunk, TranscriberStage};
    use crate::audio::segmenter::{AudioSegment, SegmentBoundary};
    use crate::session::models::Source;
    use crate::transcribe::whisper_cpp::{
        TranscriptSegment, TranscriptionError, WhisperBackend, WhisperCppAdapter, WhisperCppConfig,
    };

    #[derive(Debug)]
    struct FakeBackend {
        responses: std::sync::Mutex<Vec<Vec<TranscriptSegment>>>,
    }

    impl FakeBackend {
        fn new(responses: Vec<Vec<TranscriptSegment>>) -> Self {
            Self {
                responses: std::sync::Mutex::new(responses),
            }
        }
    }

    impl WhisperBackend for FakeBackend {
        fn transcribe(
            &self,
            _chunk: &AudioSegment,
            _config: &WhisperCppConfig,
        ) -> Result<Vec<TranscriptSegment>, TranscriptionError> {
            let mut responses = self.responses.lock().expect("backend lock");
            Ok(if responses.is_empty() {
                Vec::new()
            } else {
                responses.remove(0)
            })
        }
    }

    fn build_adapter(responses: Vec<Vec<TranscriptSegment>>) -> WhisperCppAdapter {
        WhisperCppAdapter::new(
            WhisperCppConfig {
                language: Some("en".to_string()),
                ..WhisperCppConfig::default()
            },
            Box::new(FakeBackend::new(responses)),
        )
    }

    fn segment(source: Source, boundary: SegmentBoundary) -> AudioSegment {
        AudioSegment {
            source,
            device_id: format!("{:?}-device", source).to_lowercase(),
            sample_rate: 16_000,
            channels: 1,
            start_ms: 100,
            end_ms: 700,
            samples: vec![0.1; 9_600],
            boundary,
        }
    }

    #[tokio::test]
    async fn transcriber_stage_rejects_source_mismatch() {
        let stage = TranscriberStage::new(Source::Mic, build_adapter(vec![Vec::new()]));
        let error = stage
            .transcribe_batch(&segment(Source::System, SegmentBoundary::Silence))
            .await
            .expect_err("source mismatch should fail");

        assert!(error.to_string().contains("cannot process segment"));
    }

    #[tokio::test]
    async fn transcriber_stage_propagates_audio_boundary() {
        let stage = TranscriberStage::new(
            Source::Mic,
            build_adapter(vec![vec![TranscriptSegment {
                text: "hello world".to_string(),
                start_ms: 100,
                end_ms: 700,
                is_partial: false,
            }]]),
        );
        let transcript = stage
            .transcribe_batch(&segment(Source::Mic, SegmentBoundary::MaxDuration))
            .await
            .expect("transcription should work");

        assert_eq!(transcript.chunks.len(), 1);
        assert_eq!(transcript.source, Source::Mic);
        assert_eq!(transcript.audio_boundary, SegmentBoundary::MaxDuration);
        assert_eq!(transcript.chunks[0].source, Source::Mic);
        assert_eq!(transcript.chunks[0].audio_boundary, SegmentBoundary::MaxDuration);
        assert_eq!(transcript.chunks[0].text, "hello world");
    }

    #[tokio::test]
    async fn transcriber_stage_emits_empty_batch_with_boundary_metadata() {
        let stage = TranscriberStage::new(Source::Mic, build_adapter(vec![Vec::new()]));
        let batch = stage
            .transcribe_batch(&segment(Source::Mic, SegmentBoundary::Flush))
            .await
            .expect("transcription should work");

        assert_eq!(
            batch,
            TranscriptBatch {
                source: Source::Mic,
                audio_boundary: SegmentBoundary::Flush,
                chunks: Vec::new(),
            }
        );
    }

    #[tokio::test]
    async fn transcriber_stage_maps_multiple_whisper_segments() {
        let stage = TranscriberStage::new(
            Source::Mic,
            build_adapter(vec![vec![
                TranscriptSegment {
                    text: "hello".to_string(),
                    start_ms: 100,
                    end_ms: 300,
                    is_partial: false,
                },
                TranscriptSegment {
                    text: "world".to_string(),
                    start_ms: 300,
                    end_ms: 700,
                    is_partial: false,
                },
            ]]),
        );
        let transcript = stage
            .transcribe_batch(&segment(Source::Mic, SegmentBoundary::Silence))
            .await
            .expect("transcription should work");

        assert_eq!(transcript.chunks.len(), 2);
        assert_eq!(transcript.audio_boundary, SegmentBoundary::Silence);
        assert_eq!(transcript.chunks[0].audio_boundary, SegmentBoundary::Silence);
        assert_eq!(transcript.chunks[1].audio_boundary, SegmentBoundary::Silence);
        assert_eq!(transcript.chunks[0].start_ms, 100);
        assert_eq!(transcript.chunks[1].end_ms, 700);
    }

    #[test]
    fn transcript_chunk_is_plain_boundary_metadata() {
        let chunk = TranscriptChunk {
            source: Source::Mic,
            start_ms: 100,
            end_ms: 200,
            text: "hi".to_string(),
            audio_boundary: SegmentBoundary::Flush,
        };

        assert_eq!(chunk.audio_boundary, SegmentBoundary::Flush);
        assert_eq!(chunk.text, "hi");
    }
}
