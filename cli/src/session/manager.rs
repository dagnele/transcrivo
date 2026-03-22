use std::env;

use serde_json::{Map, Value};

use crate::session::models::{
    speaker_for_source, SessionContext, SessionErrorPayload, SessionReadyPayload,
    SessionStartPayload, SessionState, SessionStopPayload, Source, TranscriptEvent,
    TranscriptMessageType,
};
use crate::session::sequence::Sequence;
use crate::transport::protocol::{MessageEnvelope, MessageType, ProtocolError};
use crate::util::ids::{new_event_id, new_utterance_id};
use crate::util::time::SessionClock;

#[derive(Debug, Clone, PartialEq)]
pub enum InboundPayload {
    Ready(SessionReadyPayload),
    Error(SessionErrorPayload),
}

#[derive(Debug, Clone, PartialEq)]
pub struct InboundMessageResult {
    pub state: SessionState,
    pub payload: InboundPayload,
}

#[derive(Debug, Clone)]
pub struct SessionManager {
    clock: SessionClock,
    sequence: Sequence,
    pub context: SessionContext,
}

impl SessionManager {
    pub fn new(platform_name: Option<String>) -> Self {
        Self::with_dependencies(platform_name, Sequence::new(), SessionClock::new())
    }

    pub fn with_dependencies(
        platform_name: Option<String>,
        sequence: Sequence,
        clock: SessionClock,
    ) -> Self {
        let platform = platform_name.unwrap_or_else(default_platform_name);
        let context = SessionContext {
            platform,
            started_at: clock.started_at(),
            state: SessionState::Initialized,
        };

        Self {
            clock,
            sequence,
            context,
        }
    }

    pub fn create_session_start(
        &mut self,
        mic_device_id: Option<String>,
        system_device_id: Option<String>,
    ) -> Result<MessageEnvelope, ProtocolError> {
        let payload = SessionStartPayload {
            platform: self.context.platform.clone(),
            started_at: self.context.started_at.clone(),
            mic_device_id,
            system_device_id,
        };

        self.context.state = SessionState::Started;
        MessageEnvelope::new(
            MessageType::SessionStart,
            self.sequence.next(),
            payload.to_map(),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_transcript_message(
        &self,
        event_type: TranscriptMessageType,
        utterance_id: Option<String>,
        source: Source,
        text: String,
        start_ms: u64,
        end_ms: u64,
        confidence: Option<f64>,
        language: Option<String>,
        device_id: Option<String>,
        chunk_id: Option<String>,
        is_overlap: Option<bool>,
        meta: Option<Map<String, Value>>,
    ) -> Result<MessageEnvelope, ProtocolError> {
        let sequence = self.sequence.next();
        let event = TranscriptEvent {
            event_id: new_event_id(),
            utterance_id: utterance_id.unwrap_or_else(new_utterance_id),
            sequence,
            event_type,
            source,
            speaker: speaker_for_source(source),
            text,
            start_ms,
            end_ms,
            created_at: self.clock.created_at(),
            confidence,
            language,
            device_id,
            chunk_id,
            is_overlap,
            meta,
        };

        event
            .validate()
            .map_err(|_| ProtocolError::InvalidPayload)?;
        MessageEnvelope::new(
            event_type.as_message_type(),
            sequence,
            event.to_payload_map(),
        )
    }

    pub fn create_session_stop(
        &mut self,
        reason: Option<String>,
    ) -> Result<MessageEnvelope, ProtocolError> {
        let payload = SessionStopPayload {
            created_at: self.clock.created_at(),
            reason,
        };

        self.context.state = SessionState::Stopped;
        MessageEnvelope::new(
            MessageType::SessionStop,
            self.sequence.next(),
            payload.to_map(),
        )
    }

    pub fn handle_inbound_message(
        &mut self,
        message: &MessageEnvelope,
    ) -> Result<InboundMessageResult, String> {
        match message.message_type {
            MessageType::SessionReady => {
                let payload = SessionReadyPayload::from_map(&message.payload)?;
                self.context.state = SessionState::Ready;
                Ok(InboundMessageResult {
                    state: self.context.state,
                    payload: InboundPayload::Ready(payload),
                })
            }
            MessageType::SessionError => {
                let payload = SessionErrorPayload::from_map(&message.payload)?;
                self.context.state = SessionState::Error;
                Ok(InboundMessageResult {
                    state: self.context.state,
                    payload: InboundPayload::Error(payload),
                })
            }
            _ => Err(format!(
                "Unsupported inbound message type: {:?}",
                message.message_type
            )),
        }
    }
}

fn default_platform_name() -> String {
    match env::consts::OS {
        "windows" => "windows".to_string(),
        "linux" => "linux".to_string(),
        other => other.to_string(),
    }
}
