use transcrivo_cli_rs::transport::protocol::{
    parse_message, serialize_message, MessageEnvelope, MessageType, ProtocolError,
};
use serde_json::json;

#[test]
fn serializes_minimal_message_envelope() {
    let envelope = MessageEnvelope::new(
        MessageType::SessionStart,
        1,
        json!({ "platform": "linux" }).as_object().unwrap().clone(),
    )
    .expect("envelope should build");

    let encoded = serde_json::to_value(&envelope).expect("envelope should serialize");

    assert_eq!(encoded["type"], "session.start");
    assert_eq!(encoded["sequence"], 1);
    assert_eq!(encoded["payload"]["platform"], "linux");

    let raw = serialize_message(&envelope).expect("envelope should encode");
    let parsed = parse_message(&raw).expect("envelope should decode");

    assert_eq!(parsed, envelope);
}

#[test]
fn rejects_missing_payload() {
    let error = parse_message(r#"{"type":"session.ready","sequence":1}"#)
        .expect_err("missing payload should be rejected");

    assert_eq!(error, ProtocolError::InvalidPayload);
}
