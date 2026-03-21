use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thiserror::Error;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum MessageType {
    #[serde(rename = "session.start")]
    SessionStart,
    #[serde(rename = "transcript.partial")]
    TranscriptPartial,
    #[serde(rename = "transcript.final")]
    TranscriptFinal,
    #[serde(rename = "session.stop")]
    SessionStop,
    #[serde(rename = "session.ready")]
    SessionReady,
    #[serde(rename = "session.error")]
    SessionError,
}

impl MessageType {
    pub fn parse(value: &str) -> Result<Self, ProtocolError> {
        match value {
            "session.start" => Ok(Self::SessionStart),
            "transcript.partial" => Ok(Self::TranscriptPartial),
            "transcript.final" => Ok(Self::TranscriptFinal),
            "session.stop" => Ok(Self::SessionStop),
            "session.ready" => Ok(Self::SessionReady),
            "session.error" => Ok(Self::SessionError),
            _ => Err(ProtocolError::UnsupportedEnvelopeType(value.to_string())),
        }
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ProtocolError {
    #[error("Envelope must be valid JSON")]
    InvalidJson,
    #[error("Envelope JSON root must be an object")]
    InvalidJsonRoot,
    #[error("Envelope type must be a non-empty string")]
    InvalidType,
    #[error("Unsupported envelope type: {0}")]
    UnsupportedEnvelopeType(String),
    #[error("Envelope sequence must be an integer")]
    InvalidSequence,
    #[error("Envelope sequence must be greater than zero")]
    NonPositiveSequence,
    #[error("Envelope payload must be an object")]
    InvalidPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MessageEnvelope {
    #[serde(rename = "type")]
    pub message_type: MessageType,
    pub sequence: u64,
    pub payload: Map<String, Value>,
}

impl MessageEnvelope {
    pub fn new(
        message_type: MessageType,
        sequence: u64,
        payload: Map<String, Value>,
    ) -> Result<Self, ProtocolError> {
        if sequence == 0 {
            return Err(ProtocolError::NonPositiveSequence);
        }

        Ok(Self {
            message_type,
            sequence,
            payload,
        })
    }

    pub fn to_json(&self) -> Result<String, ProtocolError> {
        serde_json::to_string(self).map_err(|_| ProtocolError::InvalidJson)
    }

    pub fn from_value(raw_message: Value) -> Result<Self, ProtocolError> {
        let raw_message = match raw_message {
            Value::Object(map) => map,
            _ => return Err(ProtocolError::InvalidJsonRoot),
        };

        let message_type = match raw_message.get("type") {
            Some(Value::String(value)) if !value.is_empty() => MessageType::parse(value)?,
            _ => return Err(ProtocolError::InvalidType),
        };

        let sequence = match raw_message.get("sequence") {
            Some(Value::Number(value)) => value.as_u64().ok_or(ProtocolError::InvalidSequence)?,
            _ => return Err(ProtocolError::InvalidSequence),
        };

        let payload = match raw_message.get("payload") {
            Some(Value::Object(payload)) => payload.clone(),
            _ => return Err(ProtocolError::InvalidPayload),
        };

        Self::new(message_type, sequence, payload)
    }

    pub fn from_json(raw_message: &str) -> Result<Self, ProtocolError> {
        let decoded = serde_json::from_str(raw_message).map_err(|_| ProtocolError::InvalidJson)?;
        Self::from_value(decoded)
    }
}

pub fn serialize_message(message: &MessageEnvelope) -> Result<String, ProtocolError> {
    message.to_json()
}

pub fn parse_message(raw_message: &str) -> Result<MessageEnvelope, ProtocolError> {
    MessageEnvelope::from_json(raw_message)
}
