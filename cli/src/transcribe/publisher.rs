use std::sync::Arc;

use crate::session::manager::SessionManager;
use crate::session::models::Source;
use crate::transcribe::pipeline::TranscriptPipeline;
use crate::transcribe::stage::TranscriptBatch;
use crate::transcribe::whisper_cpp::{TranscriptSegment, TranscriptionError};
use crate::transport::protocol::MessageEnvelope;

#[derive(Debug)]
pub struct TranscriptPublisherStage {
    pipeline: TranscriptPipeline,
}

impl TranscriptPublisherStage {
    pub fn new(source: Source, session: Arc<SessionManager>) -> Self {
        Self {
            pipeline: TranscriptPipeline::new_without_adapter(source, session, true),
        }
    }

    pub fn publish_batch(
        &mut self,
        batch: &TranscriptBatch,
    ) -> Result<Vec<MessageEnvelope>, TranscriptionError> {
        let mut messages = Vec::new();
        let segments = batch
            .chunks
            .iter()
            .map(|chunk| TranscriptSegment {
                text: chunk.text.clone(),
                start_ms: chunk.start_ms,
                end_ms: chunk.end_ms,
                is_partial: false,
            })
            .collect::<Vec<_>>();

        if !segments.is_empty() {
            messages.extend(self.pipeline.process_transcript_segments(&segments)?);
        }

        if matches!(
            batch.audio_boundary,
            crate::audio::segmenter::SegmentBoundary::Silence
                | crate::audio::segmenter::SegmentBoundary::Flush
        ) {
            messages.extend(self.pipeline.flush_pending()?);
        }

        Ok(messages)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::TranscriptPublisherStage;
    use crate::audio::segmenter::SegmentBoundary;
    use crate::session::manager::SessionManager;
    use crate::session::models::Source;
    use crate::transcribe::stage::{TranscriptBatch, TranscriptChunk};
    use crate::transport::protocol::MessageType;

    fn chunk(text: &str, start_ms: u64, end_ms: u64, boundary: SegmentBoundary) -> TranscriptChunk {
        TranscriptChunk {
            source: Source::Mic,
            start_ms,
            end_ms,
            text: text.to_string(),
            audio_boundary: boundary,
        }
    }

    fn batch(boundary: SegmentBoundary, chunks: Vec<TranscriptChunk>) -> TranscriptBatch {
        TranscriptBatch {
            source: Source::Mic,
            audio_boundary: boundary,
            chunks,
        }
    }

    #[test]
    fn silence_boundary_finalizes_pending_utterance() {
        let session = Arc::new(SessionManager::new(Some("linux".to_string())));
        let mut publisher = TranscriptPublisherStage::new(Source::Mic, session);
        let messages = publisher
            .publish_batch(&batch(
                SegmentBoundary::Silence,
                vec![chunk("hello world", 0, 500, SegmentBoundary::Silence)],
            ))
            .expect("publish should work");

        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].message_type, MessageType::TranscriptPartial);
        assert_eq!(messages[1].message_type, MessageType::TranscriptFinal);
    }

    #[test]
    fn max_duration_boundary_keeps_utterance_open() {
        let session = Arc::new(SessionManager::new(Some("linux".to_string())));
        let mut publisher = TranscriptPublisherStage::new(Source::Mic, session);
        let messages = publisher
            .publish_batch(&batch(
                SegmentBoundary::MaxDuration,
                vec![chunk("hello world", 0, 500, SegmentBoundary::MaxDuration)],
            ))
            .expect("publish should work");

        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].message_type, MessageType::TranscriptPartial);
    }

    #[test]
    fn flush_boundary_finalizes_even_with_no_text() {
        let session = Arc::new(SessionManager::new(Some("linux".to_string())));
        let mut publisher = TranscriptPublisherStage::new(Source::Mic, session);

        let first = publisher
            .publish_batch(&batch(
                SegmentBoundary::MaxDuration,
                vec![chunk("hello world", 0, 500, SegmentBoundary::MaxDuration)],
            ))
            .expect("first publish should work");
        let second = publisher
            .publish_batch(&batch(SegmentBoundary::Flush, Vec::new()))
            .expect("flush publish should work");

        assert_eq!(first.len(), 1);
        assert_eq!(first[0].message_type, MessageType::TranscriptPartial);
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].message_type, MessageType::TranscriptFinal);
        assert_eq!(second[0].payload["text"], "hello world");
    }
}
