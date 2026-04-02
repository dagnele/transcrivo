use std::sync::Arc;

use tracing::{debug, error};

use crate::audio::segmenter::AudioSegment;
use crate::session::manager::SessionManager;
use crate::session::models::{Source, TranscriptMessageType};
use crate::transcribe::whisper_cpp::{TranscriptSegment, TranscriptionError, WhisperCppAdapter};
use crate::transport::protocol::MessageEnvelope;
use crate::util::ids::new_utterance_id;

#[derive(Debug, Clone, PartialEq)]
struct PendingUtterance {
    utterance_id: String,
    text: String,
    start_ms: u64,
    end_ms: u64,
    last_emitted_end_ms: Option<u64>,
}

const MAX_PENDING_UTTERANCE_CHARS: usize = 300;

#[derive(Debug, Clone, PartialEq, Eq)]
struct ForcedCut {
    finalized_text: String,
    remainder_text: Option<String>,
    consumed_chars: usize,
}

#[derive(Debug)]
pub struct TranscriptPipeline {
    source: Source,
    session: Arc<SessionManager>,
    adapter: Option<WhisperCppAdapter>,
    emit_partial_events: bool,
    pending_utterance: Option<PendingUtterance>,
    last_partial_text: Option<String>,
}

impl TranscriptPipeline {
    pub fn new(
        source: Source,
        session: Arc<SessionManager>,
        adapter: WhisperCppAdapter,
        emit_partial_events: bool,
    ) -> Self {
        Self::new_with_optional_adapter(source, session, Some(adapter), emit_partial_events)
    }

    pub fn new_without_adapter(
        source: Source,
        session: Arc<SessionManager>,
        emit_partial_events: bool,
    ) -> Self {
        Self::new_with_optional_adapter(source, session, None, emit_partial_events)
    }

    fn new_with_optional_adapter(
        source: Source,
        session: Arc<SessionManager>,
        adapter: Option<WhisperCppAdapter>,
        emit_partial_events: bool,
    ) -> Self {
        Self {
            source,
            session,
            adapter,
            emit_partial_events,
            pending_utterance: None,
            last_partial_text: None,
        }
    }

    /// Async variant that runs the blocking whisper inference off the tokio
    /// runtime via `spawn_blocking`, preventing the event loop from stalling.
    pub async fn transcribe_chunk_async(
        &mut self,
        segment: &AudioSegment,
    ) -> Result<Vec<MessageEnvelope>, TranscriptionError> {
        let segments = self.run_adapter_async(segment).await?;
        self.process_segments(&segments)
    }

    pub fn process_transcript_segments(
        &mut self,
        segments: &[TranscriptSegment],
    ) -> Result<Vec<MessageEnvelope>, TranscriptionError> {
        self.process_segments(segments)
    }

    async fn run_adapter_async(
        &self,
        segment: &AudioSegment,
    ) -> Result<Vec<crate::transcribe::whisper_cpp::TranscriptSegment>, TranscriptionError> {
        let adapter = self
            .adapter
            .as_ref()
            .ok_or(TranscriptionError::NotConfigured)?;

        if segment.source != self.source {
            return Err(TranscriptionError::InvalidChunk(format!(
                "Transcription pipeline for {:?} cannot process segment from {:?}",
                self.source, segment.source
            )));
        }

        adapter
            .transcribe_chunk_async(segment)
            .await
            .map_err(|error| {
                if matches!(error, TranscriptionError::Aborted) {
                    return error;
                }
                error!(
                    source = ?segment.source,
                    device_id = %segment.device_id,
                    start_ms = segment.start_ms,
                    end_ms = segment.end_ms,
                    error = %error,
                    "transcription failed"
                );
                error
            })
    }

    fn process_segments(&mut self, segments: &[TranscriptSegment]) -> Result<Vec<MessageEnvelope>, TranscriptionError> {
        if !self.emit_partial_events {
            return self.segments_to_messages(segments);
        }

        self.segments_to_utterance_messages(segments)
    }

    pub fn flush_pending(&mut self) -> Result<Vec<MessageEnvelope>, TranscriptionError> {
        if self.pending_utterance.is_none() {
            return Ok(Vec::new());
        }
        Ok(vec![self.finalize_pending()?])
    }

    pub fn has_pending(&self) -> bool {
        self.pending_utterance.is_some()
    }

    fn segments_to_messages(&self, segments: &[TranscriptSegment]) -> Result<Vec<MessageEnvelope>, TranscriptionError> {
        let mut messages = Vec::new();
        for segment in segments {
            if segment.is_partial && !self.emit_partial_events {
                continue;
            }
            if !is_meaningful_transcript_text(&segment.text) {
                continue;
            }

            let event_type = if segment.is_partial {
                TranscriptMessageType::Partial
            } else {
                TranscriptMessageType::Final
            };
            let message = self.session.create_transcript_message(
                event_type,
                new_utterance_id(),
                self.source,
                segment.text.clone(),
                segment.start_ms,
                segment.end_ms,
            )?;
            debug!(
                message_type = ?message.message_type,
                source = ?self.source,
                start_ms = segment.start_ms,
                end_ms = segment.end_ms,
                text = %segment.text,
                "emitted transcript message"
            );
            messages.push(message);
        }

        Ok(messages)
    }

    fn segments_to_utterance_messages(&mut self, segments: &[TranscriptSegment]) -> Result<Vec<MessageEnvelope>, TranscriptionError> {
        let meaningful_segments = segments
            .iter()
            .filter(|segment| is_meaningful_transcript_text(&segment.text))
            .cloned()
            .collect::<Vec<_>>();
        if meaningful_segments.is_empty() {
            return Ok(Vec::new());
        }

        let combined = combine_segments(&meaningful_segments);
        if let Some(pending) = &self.pending_utterance {
            self.pending_utterance = Some(PendingUtterance {
                utterance_id: pending.utterance_id.clone(),
                text: merge_text(&pending.text, &combined.text),
                start_ms: pending.start_ms.min(combined.start_ms),
                end_ms: pending.end_ms.max(combined.end_ms),
                last_emitted_end_ms: pending.last_emitted_end_ms,
            });
        } else {
            self.pending_utterance = Some(combined);
        }

        let mut messages = self.force_finalize_overlong_pending()?;
        if self.pending_utterance.is_none() {
            return Ok(messages);
        }

        let current = match self.pending_utterance.clone() {
            Some(current) => current,
            None => return Ok(Vec::new()),
        };
        if self.last_partial_text.as_deref() == Some(current.text.as_str()) {
            return Ok(messages);
        }

        self.last_partial_text = Some(current.text.clone());
        let message = self.session.create_transcript_message(
            TranscriptMessageType::Partial,
            current.utterance_id.clone(),
            self.source,
            current.text.clone(),
            current.start_ms,
            current.end_ms,
        )?;
        debug!(
            source = ?self.source,
            start_ms = current.start_ms,
            end_ms = current.end_ms,
            text = %current.text,
            "emitted transcript.partial"
        );
        if let Some(pending) = &mut self.pending_utterance {
            pending.last_emitted_end_ms = Some(current.end_ms);
        }
        messages.push(message);
        Ok(messages)
    }

    fn finalize_pending(&mut self) -> Result<MessageEnvelope, TranscriptionError> {
        let pending = self.pending_utterance.take().ok_or_else(|| {
            TranscriptionError::Backend("No pending utterance is available to finalize".to_string())
        })?;
        self.last_partial_text = None;

        let message = self.create_message_from_pending(TranscriptMessageType::Final, &pending)?;
        debug!(
            source = ?self.source,
            start_ms = pending.start_ms,
            end_ms = pending.end_ms,
            text = %pending.text,
            "emitted transcript.final"
        );
        Ok(message)
    }

    fn create_message_from_pending(
        &self,
        event_type: TranscriptMessageType,
        pending: &PendingUtterance,
    ) -> Result<MessageEnvelope, TranscriptionError> {
        Ok(self.session.create_transcript_message(
            event_type,
            pending.utterance_id.clone(),
            self.source,
            pending.text.clone(),
            pending.start_ms,
            pending.end_ms,
        )?)
    }

    fn force_finalize_overlong_pending(
        &mut self,
    ) -> Result<Vec<MessageEnvelope>, TranscriptionError> {
        let mut messages = Vec::new();

        loop {
            let Some(pending) = self.pending_utterance.clone() else {
                break;
            };
            let Some(cut) = split_text_for_cutoff(&pending.text, MAX_PENDING_UTTERANCE_CHARS)
            else {
                break;
            };

            let (finalized, remainder) = split_pending_utterance(pending, cut);
            let message =
                self.create_message_from_pending(TranscriptMessageType::Final, &finalized)?;
            debug!(
                source = ?self.source,
                start_ms = finalized.start_ms,
                end_ms = finalized.end_ms,
                text = %finalized.text,
                "emitted transcript.final via cutoff"
            );
            messages.push(message);

            self.pending_utterance = remainder;
            self.last_partial_text = None;
        }

        Ok(messages)
    }
}

fn split_pending_utterance(
    pending: PendingUtterance,
    cut: ForcedCut,
) -> (PendingUtterance, Option<PendingUtterance>) {
    let total_chars = pending.text.chars().count();
    let remainder_exists = cut.remainder_text.is_some();
    let split_ms = interpolate_split_ms(
        pending.start_ms,
        pending.end_ms,
        cut.consumed_chars,
        total_chars,
        remainder_exists,
    )
    .max(pending.last_emitted_end_ms.unwrap_or(pending.start_ms));

    let finalized = PendingUtterance {
        utterance_id: pending.utterance_id.clone(),
        text: cut.finalized_text,
        start_ms: pending.start_ms,
        end_ms: split_ms,
        last_emitted_end_ms: pending.last_emitted_end_ms,
    };
    let remainder = cut.remainder_text.map(|text| PendingUtterance {
        utterance_id: new_utterance_id(),
        text,
        start_ms: split_ms,
        end_ms: pending.end_ms,
        last_emitted_end_ms: None,
    });

    (finalized, remainder)
}

fn interpolate_split_ms(
    start_ms: u64,
    end_ms: u64,
    consumed_chars: usize,
    total_chars: usize,
    remainder_exists: bool,
) -> u64 {
    if end_ms <= start_ms || total_chars == 0 {
        return end_ms;
    }

    let duration = end_ms - start_ms;
    let mut split_ms =
        start_ms + ((duration as u128 * consumed_chars as u128) / total_chars as u128) as u64;
    if remainder_exists && duration > 1 {
        split_ms = split_ms.clamp(start_ms + 1, end_ms - 1);
    }
    split_ms.min(end_ms)
}

fn combine_segments(segments: &[TranscriptSegment]) -> PendingUtterance {
    let first = &segments[0];
    let last = &segments[segments.len() - 1];
    let text = segments
        .iter()
        .map(|segment| segment.text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    PendingUtterance {
        utterance_id: new_utterance_id(),
        text,
        start_ms: first.start_ms,
        end_ms: last.end_ms,
        last_emitted_end_ms: None,
    }
}

fn is_meaningful_transcript_text(text: &str) -> bool {
    let trimmed = text.trim();
    !trimmed.is_empty()
        && trimmed != "[BLANK_AUDIO]"
        && trimmed.chars().any(char::is_alphanumeric)
}

fn split_text_for_cutoff(text: &str, max_chars: usize) -> Option<ForcedCut> {
    let total_chars = text.chars().count();
    if total_chars <= max_chars {
        return None;
    }

    if let Some((split_byte, consumed_chars)) = last_sentence_boundary_before(text, max_chars) {
        let finalized_text = text[..split_byte].trim().to_string();
        let remainder_text = trimmed_non_empty(text[split_byte..].trim());
        if finalized_text.is_empty() {
            return None;
        }
        return Some(ForcedCut {
            finalized_text,
            remainder_text,
            consumed_chars,
        });
    }

    let (split_byte, consumed_chars) = last_word_boundary_before(text, max_chars)
        .unwrap_or_else(|| (char_to_byte_index(text, max_chars), max_chars));
    let finalized_text = append_ellipsis(text[..split_byte].trim());
    let remainder_text =
        trimmed_non_empty(text[split_byte..].trim()).map(|value| prepend_ellipsis(&value));
    if finalized_text.is_empty() {
        return None;
    }

    Some(ForcedCut {
        finalized_text,
        remainder_text,
        consumed_chars,
    })
}

fn last_sentence_boundary_before(text: &str, max_chars: usize) -> Option<(usize, usize)> {
    let mut last_boundary = None;
    for (char_idx, (byte_idx, ch)) in text.char_indices().enumerate() {
        if char_idx >= max_chars {
            break;
        }
        if matches!(ch, '.' | '?' | '!') {
            last_boundary = Some((byte_idx + ch.len_utf8(), char_idx + 1));
        }
    }
    last_boundary
}

fn last_word_boundary_before(text: &str, max_chars: usize) -> Option<(usize, usize)> {
    let mut last_boundary = None;
    for (char_idx, (byte_idx, ch)) in text.char_indices().enumerate() {
        if char_idx >= max_chars {
            break;
        }
        if ch.is_whitespace() {
            last_boundary = Some((byte_idx, char_idx));
        }
    }
    last_boundary
}

fn char_to_byte_index(text: &str, char_index: usize) -> usize {
    text.char_indices()
        .nth(char_index)
        .map(|(byte_idx, _)| byte_idx)
        .unwrap_or(text.len())
}

fn trimmed_non_empty(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn prepend_ellipsis(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        String::new()
    } else if trimmed.starts_with("...") {
        trimmed.to_string()
    } else {
        format!("...{trimmed}")
    }
}

fn append_ellipsis(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        String::new()
    } else if trimmed.ends_with("...") {
        trimmed.to_string()
    } else {
        format!("{trimmed}...")
    }
}

fn merge_text(existing_text: &str, new_text: &str) -> String {
    let existing = existing_text.trim();
    let new = new_text.trim();
    if existing.is_empty() {
        return new.to_string();
    }
    if new.is_empty() {
        return existing.to_string();
    }

    let preserve_prefix_ellipsis = existing.starts_with("...") || new.starts_with("...");
    let existing = strip_leading_ellipsis(existing);
    let new = strip_leading_ellipsis(new);
    let merged = merge_text_core(existing, new);

    if preserve_prefix_ellipsis {
        prepend_ellipsis(&merged)
    } else {
        merged
    }
}

fn strip_leading_ellipsis(text: &str) -> &str {
    text.strip_prefix("...")
        .map(str::trim_start)
        .unwrap_or(text)
}

fn merge_text_core(existing: &str, new: &str) -> String {
    if new.starts_with(existing) {
        return new.to_string();
    }
    if existing.ends_with(new) {
        return existing.to_string();
    }

    let existing_words = existing.split_whitespace().collect::<Vec<_>>();
    let new_words = new.split_whitespace().collect::<Vec<_>>();
    let max_overlap = existing_words.len().min(new_words.len());
    for overlap in (1..=max_overlap).rev() {
        if existing_words[existing_words.len() - overlap..] == new_words[..overlap] {
            return existing_words
                .iter()
                .chain(new_words[overlap..].iter())
                .copied()
                .collect::<Vec<_>>()
                .join(" ");
        }
    }

    format!("{existing} {new}")
}

#[cfg(test)]
mod tests {
    use super::{merge_text, split_text_for_cutoff};

    #[test]
    fn split_text_for_cutoff_prefers_sentence_boundary() {
        let sentence = "This is a deliberately long sentence that should be emitted as a final chunk when it reaches the cutoff because it ends with a period.";
        let continuation = "This continuation should remain pending for the next partial update so the user still sees the next phrase taking shape in real time.";
        let text = format!("{sentence} {continuation}");

        let cut = split_text_for_cutoff(&text, 200).expect("cutoff should split long text");

        assert_eq!(cut.finalized_text, sentence);
        assert_eq!(cut.remainder_text.as_deref(), Some(continuation));
    }

    #[test]
    fn split_text_for_cutoff_adds_ellipsis_when_forcing_mid_thought_cut() {
        let text = "this transcript keeps running without any sentence marker so the pipeline needs to force a cutoff at a word boundary and keep the rest moving forward as a continued thought for the next partial update";

        let cut = split_text_for_cutoff(text, 120).expect("cutoff should split long text");

        assert!(cut.finalized_text.ends_with("..."));
        assert!(cut
            .remainder_text
            .as_deref()
            .expect("remainder should exist")
            .starts_with("..."));
    }

    #[test]
    fn merge_text_preserves_continuation_ellipsis() {
        let merged = merge_text(
            "...overlapping chunks and why",
            "overlapping chunks and why this still merges cleanly",
        );

        assert_eq!(
            merged,
            "...overlapping chunks and why this still merges cleanly"
        );
    }
}
