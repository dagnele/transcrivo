use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{TimeZone, Utc};
use serde_json::json;

use cheatcode_cli_rs::session::manager::{InboundPayload, SessionManager};
use cheatcode_cli_rs::session::models::{SessionState, Source, TranscriptMessageType};
use cheatcode_cli_rs::session::sequence::Sequence;
use cheatcode_cli_rs::transport::protocol::{MessageEnvelope, MessageType};
use cheatcode_cli_rs::util::time::SessionClock;

#[test]
fn sequence_starts_at_one() {
    let sequence = Sequence::new();

    assert_eq!(sequence.next(), 1);
    assert_eq!(sequence.next(), 2);
}

#[test]
fn sequence_can_start_from_existing_value() {
    let sequence = Sequence::with_start(9);

    assert_eq!(sequence.current(), 9);
    assert_eq!(sequence.next(), 10);
}

#[test]
fn session_manager_builds_start_transcript_and_stop_messages() {
    let wall_times = Arc::new(Mutex::new(
        vec![
            Utc.with_ymd_and_hms(2026, 3, 17, 14, 52, 30)
                .single()
                .unwrap(),
            Utc.with_ymd_and_hms(2026, 3, 17, 14, 52, 31)
                .single()
                .unwrap()
                + chrono::TimeDelta::milliseconds(118),
            Utc.with_ymd_and_hms(2026, 3, 17, 14, 52, 32)
                .single()
                .unwrap(),
        ]
        .into_iter(),
    ));
    let monotonic_values = Arc::new(Mutex::new(
        vec![Duration::from_secs(100), Duration::from_secs(100)].into_iter(),
    ));

    let clock = SessionClock::from_sources(
        {
            let wall_times = Arc::clone(&wall_times);
            move || {
                wall_times
                    .lock()
                    .expect("wall clock lock")
                    .next()
                    .expect("wall time")
            }
        },
        {
            let monotonic_values = Arc::clone(&monotonic_values);
            move || {
                monotonic_values
                    .lock()
                    .expect("monotonic lock")
                    .next()
                    .expect("monotonic value")
            }
        },
    );
    let mut manager =
        SessionManager::with_dependencies(Some("linux".to_string()), Sequence::new(), clock);

    let start_message = manager
        .create_session_start(
            Some("default-mic".to_string()),
            Some("default-output".to_string()),
        )
        .expect("start should build");
    let transcript_message = manager
        .create_transcript_message(
            TranscriptMessageType::Final,
            Source::System,
            "Can you optimize that approach?".to_string(),
            18_320,
            21_540,
            Some(0.94),
            Some("en".to_string()),
            None,
            None,
            None,
            None,
        )
        .expect("transcript should build");
    let stop_message = manager
        .create_session_stop(Some("user_interrupt".to_string()))
        .expect("stop should build");

    assert_eq!(start_message.sequence, 1);
    assert_eq!(start_message.message_type, MessageType::SessionStart);
    assert_eq!(start_message.payload["platform"], "linux");
    assert_eq!(start_message.payload["mic_device_id"], "default-mic");

    assert_eq!(transcript_message.sequence, 2);
    assert_eq!(
        transcript_message.message_type,
        MessageType::TranscriptFinal
    );
    assert_eq!(transcript_message.payload["speaker"], "System");
    assert_eq!(
        transcript_message.payload["created_at"],
        "2026-03-17T14:52:31.118Z"
    );
    assert!(transcript_message.payload["event_id"]
        .as_str()
        .expect("event id should be a string")
        .starts_with("evt_"));

    assert_eq!(stop_message.sequence, 3);
    assert_eq!(stop_message.message_type, MessageType::SessionStop);
    assert_eq!(stop_message.payload["reason"], "user_interrupt");
    assert_eq!(manager.context.state, SessionState::Stopped);
}

#[test]
fn session_manager_handles_inbound_ready_and_error_messages() {
    let mut manager = SessionManager::new(Some("linux".to_string()));

    let ready_message = MessageEnvelope::new(
        MessageType::SessionReady,
        1,
        json!({ "status": "ok" }).as_object().unwrap().clone(),
    )
    .expect("ready envelope should build");
    let error_message = MessageEnvelope::new(
        MessageType::SessionError,
        2,
        json!({ "message": "invalid token", "code": "auth_failed" })
            .as_object()
            .unwrap()
            .clone(),
    )
    .expect("error envelope should build");

    let ready_result = manager
        .handle_inbound_message(&ready_message)
        .expect("ready should parse");
    assert_eq!(ready_result.state, SessionState::Ready);
    match ready_result.payload {
        InboundPayload::Ready(payload) => assert_eq!(payload.status, "ok"),
        _ => panic!("expected ready payload"),
    }

    let error_result = manager
        .handle_inbound_message(&error_message)
        .expect("error should parse");
    assert_eq!(error_result.state, SessionState::Error);
    match error_result.payload {
        InboundPayload::Error(payload) => {
            assert_eq!(payload.message, "invalid token");
            assert_eq!(payload.code.as_deref(), Some("auth_failed"));
        }
        _ => panic!("expected error payload"),
    }
}

#[test]
fn empty_transcript_text_is_rejected() {
    let manager = SessionManager::new(Some("linux".to_string()));

    let error = manager
        .create_transcript_message(
            TranscriptMessageType::Final,
            Source::Mic,
            "   ".to_string(),
            0,
            100,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .expect_err("empty transcript text should fail");

    assert_eq!(
        error,
        cheatcode_cli_rs::transport::protocol::ProtocolError::InvalidPayload
    );
}
