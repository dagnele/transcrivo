use std::sync::Arc;

use transcrivo_cli_rs::audio::segmenter::{AudioSegment, SegmentBoundary};
use transcrivo_cli_rs::session::manager::SessionManager;
use transcrivo_cli_rs::session::models::Source;
use transcrivo_cli_rs::transcribe::pipeline::TranscriptPipeline;
use transcrivo_cli_rs::transcribe::whisper_cpp::{
    TranscriptSegment, TranscriptionError, WhisperBackend, WhisperCppAdapter, WhisperCppConfig,
};
use transcrivo_cli_rs::transport::protocol::MessageType;

async fn pipeline_transcribe_chunk(
    pipeline: &mut TranscriptPipeline,
    chunk: &AudioSegment,
) -> Result<Vec<transcrivo_cli_rs::transport::protocol::MessageEnvelope>, TranscriptionError> {
    pipeline.transcribe_chunk_async(chunk).await
}

const WHISPER_SMOKE_MODEL_PATH_ENV: &str = "TRANSCRIVO_WHISPER_SMOKE_MODEL_PATH";

#[derive(Debug)]
struct FakeBackend {
    responses: Vec<Vec<TranscriptSegment>>,
}

impl FakeBackend {
    fn new(responses: Vec<Vec<TranscriptSegment>>) -> Self {
        Self { responses }
    }
}

struct FakeBackendHandle(std::sync::Mutex<FakeBackend>);

impl WhisperBackend for FakeBackendHandle {
    fn transcribe(
        &self,
        _chunk: &AudioSegment,
        _config: &WhisperCppConfig,
    ) -> Result<Vec<TranscriptSegment>, TranscriptionError> {
        let mut backend = self.0.lock().expect("backend lock");
        Ok(if backend.responses.is_empty() {
            Vec::new()
        } else {
            backend.responses.remove(0)
        })
    }
}

#[derive(Debug, Default)]
struct UnconfiguredTestBackend;

impl WhisperBackend for UnconfiguredTestBackend {
    fn transcribe(
        &self,
        _chunk: &AudioSegment,
        _config: &WhisperCppConfig,
    ) -> Result<Vec<TranscriptSegment>, TranscriptionError> {
        Err(TranscriptionError::NotConfigured)
    }
}

fn build_chunk(source: Source, start_ms: u64, end_ms: u64) -> AudioSegment {
    AudioSegment {
        source,
        device_id: format!("{:?}-device", source).to_lowercase(),
        sample_rate: 16_000,
        channels: 1,
        start_ms,
        end_ms,
        samples: (0..16_000)
            .map(|i| -0.2 + 0.4 * i as f32 / 15_999.0)
            .collect(),
        boundary: SegmentBoundary::Flush,
    }
}

fn build_smoke_chunk(source: Source) -> AudioSegment {
    let sample_rate = 16_000;
    let duration_seconds = 2.0_f32;
    let frame_count = (sample_rate as f32 * duration_seconds) as usize;
    let samples = (0..frame_count)
        .map(|index| {
            let time = index as f32 / sample_rate as f32;
            let envelope = (1.0 - (time / duration_seconds)).max(0.2);
            let tone_a = (2.0 * std::f32::consts::PI * 220.0 * time).sin();
            let tone_b = (2.0 * std::f32::consts::PI * 440.0 * time).sin();
            0.15 * envelope * (0.7 * tone_a + 0.3 * tone_b)
        })
        .collect();

    AudioSegment {
        source,
        device_id: format!("{:?}-smoke-device", source).to_lowercase(),
        sample_rate,
        channels: 1,
        start_ms: 0,
        end_ms: 2000,
        samples,
        boundary: SegmentBoundary::Flush,
    }
}

fn build_adapter(responses: Vec<Vec<TranscriptSegment>>) -> WhisperCppAdapter {
    WhisperCppAdapter::new(
        WhisperCppConfig {
            language: Some("en".to_string()),
            ..WhisperCppConfig::default()
        },
        Box::new(FakeBackendHandle(std::sync::Mutex::new(FakeBackend::new(
            responses,
        )))),
    )
}

fn build_unconfigured_adapter() -> WhisperCppAdapter {
    WhisperCppAdapter::new(
        WhisperCppConfig::default(),
        Box::new(UnconfiguredTestBackend),
    )
}

#[tokio::test]
async fn adapter_reports_unconfigured_backend() {
    let adapter = build_unconfigured_adapter();
    let error = adapter
        .transcribe_chunk_async(&build_chunk(Source::Mic, 0, 1000))
        .await
        .expect_err("unconfigured adapter should fail");

    assert_eq!(error.to_string(), "whisper.cpp adapter is not configured");
}

#[tokio::test]
async fn pipeline_emits_final_messages() {
    let session = Arc::new(SessionManager::new(Some("linux".to_string())));
    let adapter = build_adapter(vec![vec![TranscriptSegment {
        text: "answer".to_string(),
        start_ms: 0,
        end_ms: 500,
        is_partial: false,
    }]]);
    let mut pipeline = TranscriptPipeline::new(Source::Mic, session, adapter, false);

    let messages = pipeline_transcribe_chunk(&mut pipeline, &build_chunk(Source::Mic, 0, 1000))
        .await
        .expect("pipeline should transcribe");

    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].message_type, MessageType::TranscriptFinal);
    assert_eq!(messages[0].payload["source"], "mic");
    assert_eq!(messages[0].payload["text"], "answer");
}

#[tokio::test]
async fn pipeline_drops_partials_by_default() {
    let session = Arc::new(SessionManager::new(Some("linux".to_string())));
    let adapter = build_adapter(vec![vec![TranscriptSegment {
        text: "draft".to_string(),
        start_ms: 0,
        end_ms: 500,
        is_partial: true,
    }]]);
    let mut pipeline = TranscriptPipeline::new(Source::System, session, adapter, false);

    let messages = pipeline_transcribe_chunk(&mut pipeline, &build_chunk(Source::System, 1000, 2000))
        .await
        .expect("pipeline should transcribe");

    assert!(messages.is_empty());
}

#[tokio::test]
async fn pipeline_can_emit_partials_when_enabled() {
    let session = Arc::new(SessionManager::new(Some("linux".to_string())));
    let adapter = build_adapter(vec![vec![TranscriptSegment {
        text: "draft".to_string(),
        start_ms: 1000,
        end_ms: 1500,
        is_partial: true,
    }]]);
    let mut pipeline = TranscriptPipeline::new(Source::System, session, adapter, true);

    let messages = pipeline_transcribe_chunk(&mut pipeline, &build_chunk(Source::System, 1000, 2000))
        .await
        .expect("pipeline should transcribe");

    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].message_type, MessageType::TranscriptPartial);
    assert_eq!(messages[0].payload["source"], "system");
}

#[tokio::test]
async fn pipeline_flush_pending_finalizes_last_partial() {
    let session = Arc::new(SessionManager::new(Some("linux".to_string())));
    let adapter = build_adapter(vec![vec![TranscriptSegment {
        text: "closing thought".to_string(),
        start_ms: 0,
        end_ms: 500,
        is_partial: false,
    }]]);
    let mut pipeline = TranscriptPipeline::new(Source::System, session, adapter, true);

    let partial_messages = pipeline_transcribe_chunk(&mut pipeline, &build_chunk(Source::System, 0, 1000))
        .await
        .expect("partial should emit");
    let final_messages = pipeline.flush_pending().expect("flush should work");

    assert_eq!(partial_messages.len(), 1);
    assert_eq!(
        partial_messages[0].message_type,
        MessageType::TranscriptPartial
    );
    assert_eq!(final_messages.len(), 1);
    assert_eq!(final_messages[0].message_type, MessageType::TranscriptFinal);
    assert_eq!(final_messages[0].payload["text"], "closing thought");
    assert_eq!(
        partial_messages[0].payload["utterance_id"],
        final_messages[0].payload["utterance_id"]
    );
}

#[tokio::test]
async fn pipeline_forced_cutoff_does_not_move_end_ms_backwards_for_existing_utterance() {
    let session = Arc::new(SessionManager::new(Some("linux".to_string())));
    let sentence = "This is a deliberately long sentence that should be emitted as a final chunk when it reaches the cutoff because it ends with a period and keeps going long enough to consume most of the allowed pending utterance budget before we hand off to the continuation.";
    let continuation = "This continuation should remain pending for the next partial update so the user still sees the next phrase taking shape in real time while the pipeline preserves a clean boundary between the finalized sentence and the remaining live text.";
    let adapter = build_adapter(vec![
        vec![TranscriptSegment {
            text: "This is an opening thought about housing demand and supply trends".to_string(),
            start_ms: 0,
            end_ms: 3500,
            is_partial: false,
        }],
        vec![TranscriptSegment {
            text: format!("{sentence} {continuation}"),
            start_ms: 0,
            end_ms: 6000,
            is_partial: false,
        }],
    ]);
    let mut pipeline = TranscriptPipeline::new(Source::System, session, adapter, true);

    let first_messages =
        pipeline_transcribe_chunk(&mut pipeline, &build_chunk(Source::System, 0, 3500))
            .await
            .expect("first partial should emit");
    let second_messages =
        pipeline_transcribe_chunk(&mut pipeline, &build_chunk(Source::System, 3500, 6000))
            .await
            .expect("second chunk should trigger cutoff");

    assert_eq!(first_messages.len(), 1);
    assert_eq!(first_messages[0].message_type, MessageType::TranscriptPartial);
    assert_eq!(second_messages.len(), 2);
    assert_eq!(second_messages[0].message_type, MessageType::TranscriptFinal);
    assert_eq!(second_messages[1].message_type, MessageType::TranscriptPartial);
    assert_eq!(
        first_messages[0].payload["utterance_id"],
        second_messages[0].payload["utterance_id"]
    );
    assert!(
        second_messages[0].payload["end_ms"]
            .as_u64()
            .expect("final end_ms should be numeric")
            >= first_messages[0].payload["end_ms"]
                .as_u64()
                .expect("partial end_ms should be numeric")
    );
}

#[tokio::test]
async fn pipeline_rejects_source_mismatch() {
    let session = Arc::new(SessionManager::new(Some("linux".to_string())));
    let adapter = build_adapter(vec![Vec::new()]);
    let mut pipeline = TranscriptPipeline::new(Source::Mic, session, adapter, false);

    let error = pipeline_transcribe_chunk(&mut pipeline, &build_chunk(Source::System, 0, 1000))
        .await
        .expect_err("source mismatch should fail");

    assert!(error.to_string().contains("cannot process segment"));
}

#[tokio::test]
async fn pipeline_drops_blank_audio_segments() {
    let session = Arc::new(SessionManager::new(Some("linux".to_string())));
    let adapter = build_adapter(vec![vec![TranscriptSegment {
        text: "[BLANK_AUDIO]".to_string(),
        start_ms: 0,
        end_ms: 1000,
        is_partial: false,
    }]]);
    let mut pipeline = TranscriptPipeline::new(Source::Mic, session, adapter, true);

    let messages = pipeline_transcribe_chunk(&mut pipeline, &build_chunk(Source::Mic, 0, 1000))
        .await
        .expect("blank audio should be ignored");

    assert!(messages.is_empty());
    assert!(!pipeline.has_pending());
}

#[tokio::test]
async fn pipeline_drops_punctuation_only_segments() {
    let session = Arc::new(SessionManager::new(Some("linux".to_string())));
    let adapter = build_adapter(vec![vec![TranscriptSegment {
        text: ".".to_string(),
        start_ms: 0,
        end_ms: 1000,
        is_partial: false,
    }]]);
    let mut pipeline = TranscriptPipeline::new(Source::Mic, session, adapter, true);

    let messages = pipeline_transcribe_chunk(&mut pipeline, &build_chunk(Source::Mic, 0, 1000))
        .await
        .expect("punctuation-only audio should be ignored");

    assert!(messages.is_empty());
    assert!(!pipeline.has_pending());
}

#[tokio::test]
async fn pipeline_flush_ignores_punctuation_only_partial() {
    let session = Arc::new(SessionManager::new(Some("linux".to_string())));
    let adapter = build_adapter(vec![vec![TranscriptSegment {
        text: ".".to_string(),
        start_ms: 0,
        end_ms: 1000,
        is_partial: true,
    }]]);
    let mut pipeline = TranscriptPipeline::new(Source::Mic, session, adapter, true);

    let partial_messages =
        pipeline_transcribe_chunk(&mut pipeline, &build_chunk(Source::Mic, 0, 1000))
            .await
            .expect("punctuation-only partial should be ignored");
    let final_messages = pipeline.flush_pending().expect("flush should work");

    assert!(partial_messages.is_empty());
    assert!(final_messages.is_empty());
    assert!(!pipeline.has_pending());
}

#[tokio::test]
async fn pipeline_forces_cutoff_and_marks_mid_thought_continuation() {
    let session = Arc::new(SessionManager::new(Some("linux".to_string())));
    let text = "this transcript keeps running without any sentence marker so the pipeline needs to force a cutoff at a word boundary and keep the rest moving forward as a continued thought for the next partial update while more audio is still coming through the system and then it keeps elaborating on the same idea with extra detail so the cutoff logic has to split it before the utterance grows too large for one live item";
    let adapter = build_adapter(vec![vec![TranscriptSegment {
        text: text.to_string(),
        start_ms: 0,
        end_ms: 3000,
        is_partial: false,
    }]]);
    let mut pipeline = TranscriptPipeline::new(Source::System, session, adapter, true);

    let messages = pipeline_transcribe_chunk(&mut pipeline, &build_chunk(Source::System, 0, 3000))
        .await
        .expect("pipeline should transcribe");

    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0].message_type, MessageType::TranscriptFinal);
    assert_eq!(messages[1].message_type, MessageType::TranscriptPartial);
    assert!(messages[0].payload["text"]
        .as_str()
        .expect("final text")
        .ends_with("..."));
    assert!(messages[1].payload["text"]
        .as_str()
        .expect("partial text")
        .starts_with("..."));
}

#[tokio::test]
async fn pipeline_flushes_remainder_after_forced_cutoff() {
    let session = Arc::new(SessionManager::new(Some("linux".to_string())));
    let sentence = "This is a deliberately long sentence that should be emitted as a final chunk when it reaches the cutoff because it ends with a period and keeps going long enough to consume most of the allowed pending utterance budget before we hand off to the continuation.";
    let continuation = "This continuation should remain pending for the next partial update so the user still sees the next phrase taking shape in real time while the pipeline preserves a clean boundary between the finalized sentence and the remaining live text.";
    let adapter = build_adapter(vec![vec![TranscriptSegment {
        text: format!("{sentence} {continuation}"),
        start_ms: 0,
        end_ms: 3000,
        is_partial: false,
    }]]);
    let mut pipeline = TranscriptPipeline::new(Source::System, session, adapter, true);

    let messages = pipeline_transcribe_chunk(&mut pipeline, &build_chunk(Source::System, 0, 3000))
        .await
        .expect("pipeline should transcribe");
    let flushed = pipeline.flush_pending().expect("flush should work");

    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0].payload["text"], sentence);
    assert_eq!(messages[1].payload["text"], continuation);
    assert_eq!(flushed.len(), 1);
    assert_eq!(flushed[0].message_type, MessageType::TranscriptFinal);
    assert_eq!(flushed[0].payload["text"], continuation);
}

#[tokio::test]
async fn pipeline_rotates_utterance_id_after_forced_cutoff_flush() {
    let session = Arc::new(SessionManager::new(Some("linux".to_string())));
    let text = "this transcript keeps running without any sentence marker so the pipeline needs to force a cutoff at a word boundary and keep the rest moving forward as a continued thought for the next partial update while more audio is still coming through the system and then it keeps elaborating on the same idea with extra detail so the cutoff logic has to split it before the utterance grows too large for one live item";
    let adapter = build_adapter(vec![vec![TranscriptSegment {
        text: text.to_string(),
        start_ms: 0,
        end_ms: 3000,
        is_partial: false,
    }]]);
    let mut pipeline = TranscriptPipeline::new(Source::System, session, adapter, true);

    let messages = pipeline_transcribe_chunk(&mut pipeline, &build_chunk(Source::System, 0, 3000))
        .await
        .expect("pipeline should transcribe");
    let flushed = pipeline.flush_pending().expect("flush should work");

    assert_eq!(messages.len(), 2);
    assert_eq!(flushed.len(), 1);
    assert_ne!(
        messages[0].payload["utterance_id"],
        messages[1].payload["utterance_id"]
    );
    assert_eq!(
        messages[1].payload["utterance_id"],
        flushed[0].payload["utterance_id"]
    );
}

#[test]
#[ignore = "requires TRANSCRIVO_WHISPER_SMOKE_MODEL_PATH to point to a local ggml whisper model"]
fn real_whisper_backend_smoke_test() {
    let model_path = std::env::var(WHISPER_SMOKE_MODEL_PATH_ENV)
        .expect("smoke model path env var should be set when running ignored smoke test");
    let adapter = WhisperCppAdapter::real_at_path(
        WhisperCppConfig {
            language: Some("en".to_string()),
            ..WhisperCppConfig::default()
        },
        model_path,
    )
    .expect("real adapter should initialize from model path");

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
    let segments = runtime
        .block_on(adapter.transcribe_chunk_async(&build_smoke_chunk(Source::Mic)))
        .expect("real backend should complete inference");

    for segment in &segments {
        segment
            .validate()
            .expect("returned segments should be valid");
    }
}
