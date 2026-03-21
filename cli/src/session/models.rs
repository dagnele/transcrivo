use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::transport::protocol::MessageType;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    Mic,
    System,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Speaker {
    Mic,
    System,
}

impl Speaker {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mic => "Mic",
            Self::System => "System",
        }
    }
}

impl Source {
    pub fn speaker_label(self) -> Speaker {
        match self {
            Self::Mic => Speaker::Mic,
            Self::System => Speaker::System,
        }
    }
}

impl From<crate::audio::capture::CaptureSource> for Source {
    fn from(source: crate::audio::capture::CaptureSource) -> Self {
        match source {
            crate::audio::capture::CaptureSource::Mic => Self::Mic,
            crate::audio::capture::CaptureSource::System => Self::System,
        }
    }
}

pub fn speaker_for_source(source: Source) -> Speaker {
    source.speaker_label()
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Initialized,
    Started,
    Ready,
    Stopped,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TranscriptMessageType {
    #[serde(rename = "transcript.partial")]
    Partial,
    #[serde(rename = "transcript.final")]
    Final,
}

impl TranscriptMessageType {
    pub fn as_message_type(self) -> MessageType {
        match self {
            Self::Partial => MessageType::TranscriptPartial,
            Self::Final => MessageType::TranscriptFinal,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionContext {
    pub platform: String,
    pub started_at: String,
    pub state: SessionState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionStartPayload {
    pub platform: String,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mic_device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_device_id: Option<String>,
}

impl SessionStartPayload {
    pub fn to_map(&self) -> Map<String, Value> {
        match serde_json::to_value(self).expect("session.start payload should serialize") {
            Value::Object(map) => map,
            _ => unreachable!("session.start payload should serialize as an object"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionStopPayload {
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl SessionStopPayload {
    pub fn to_map(&self) -> Map<String, Value> {
        match serde_json::to_value(self).expect("session.stop payload should serialize") {
            Value::Object(map) => map,
            _ => unreachable!("session.stop payload should serialize as an object"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionReadyPayload {
    pub status: String,
}

impl Default for SessionReadyPayload {
    fn default() -> Self {
        Self {
            status: "ok".to_string(),
        }
    }
}

impl SessionReadyPayload {
    pub fn from_map(payload: &Map<String, Value>) -> Result<Self, String> {
        match payload.get("status") {
            None => Ok(Self::default()),
            Some(Value::String(status)) if !status.is_empty() => Ok(Self {
                status: status.clone(),
            }),
            _ => Err("session.ready payload requires a non-empty string status".to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionErrorPayload {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

impl SessionErrorPayload {
    pub fn from_map(payload: &Map<String, Value>) -> Result<Self, String> {
        let message = match payload.get("message") {
            Some(Value::String(message)) if !message.is_empty() => message.clone(),
            _ => {
                return Err("session.error payload requires a non-empty string message".to_string())
            }
        };

        let code = match payload.get("code") {
            None => None,
            Some(Value::String(code)) => Some(code.clone()),
            Some(_) => {
                return Err("session.error payload code must be a string when present".to_string())
            }
        };

        Ok(Self { message, code })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranscriptEvent {
    pub event_id: String,
    pub sequence: u64,
    #[serde(rename = "type")]
    pub event_type: TranscriptMessageType,
    pub source: Source,
    pub speaker: Speaker,
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunk_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_overlap: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<Map<String, Value>>,
}

impl TranscriptEvent {
    pub fn validate(&self) -> Result<(), String> {
        if self.text.trim().is_empty() {
            return Err("Transcript text must be non-empty".to_string());
        }

        if self.end_ms < self.start_ms {
            return Err("Transcript end_ms must be greater than or equal to start_ms".to_string());
        }

        let expected_speaker = speaker_for_source(self.source);
        if self.speaker != expected_speaker {
            return Err(format!(
                "Speaker {:?} does not match source {:?}; expected {:?}",
                self.speaker, self.source, expected_speaker
            ));
        }

        Ok(())
    }

    pub fn to_map(&self) -> Map<String, Value> {
        self.validate().expect("transcript event should be valid");
        match serde_json::to_value(self).expect("transcript event should serialize") {
            Value::Object(map) => map,
            _ => unreachable!("transcript event should serialize as an object"),
        }
    }

    pub fn to_payload_map(&self) -> Map<String, Value> {
        let mut payload = self.to_map();
        payload.remove("sequence");
        payload.remove("type");
        payload
    }
}
