use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio::net::TcpListener;
use tokio_tungstenite::{accept_async, tungstenite::Message};

use cheatcode_cli_rs::audio::capture::{
    AudioCaptureWorker, CaptureConfig, CaptureSource, ProcessCaptureSpec, SourceCaptures,
};
use cheatcode_cli_rs::commands::run::{
    run_live_session_with_adapter_factory, TranscriptionConfig,
};
use cheatcode_cli_rs::session::manager::SessionManager;
use cheatcode_cli_rs::session::models::Source;
use cheatcode_cli_rs::transport::protocol::{MessageEnvelope, MessageType};
use cheatcode_cli_rs::transport::BackendWebSocketClient;
use cheatcode_cli_rs::transcribe::whisper_cpp::{WhisperCppAdapter, TranscriptionError};
use cheatcode_cli_rs::util::shutdown::ShutdownController;

fn adapter_factory(
    _source: Source,
    _config: &TranscriptionConfig,
    _shutdown: &ShutdownController,
) -> Result<WhisperCppAdapter, TranscriptionError> {
    Ok(WhisperCppAdapter::debug())
}

fn python_capture_worker(source: CaptureSource, device_id: &str, device_name: &str, script: &str) -> AudioCaptureWorker {
    let mut config = CaptureConfig::new(source, device_id, device_name);
    config.sample_rate = 48_000;
    config.channels = 2;
    config.frames_per_chunk = 4;

    AudioCaptureWorker::process(
        config,
        ProcessCaptureSpec::new("python3", vec!["-c".to_string(), script.to_string()]),
    )
}

#[tokio::test]
async fn run_live_session_returns_error_when_one_source_ends_unexpectedly() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let address = listener.local_addr().expect("local addr");

    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.expect("accept connection");
        let mut websocket = accept_async(stream).await.expect("accept websocket");

        let start = websocket
            .next()
            .await
            .expect("session.start frame")
            .expect("session.start message")
            .into_text()
            .expect("session.start text");
        let decoded: serde_json::Value = serde_json::from_str(&start).expect("decode start");
        assert_eq!(decoded["type"], "session.start");

        websocket
            .send(
                MessageEnvelope::new(
                    MessageType::SessionReady,
                    1,
                    json!({ "status": "ok" }).as_object().unwrap().clone(),
                )
                .expect("ready envelope")
                .to_json()
                .expect("ready json")
                .into(),
            )
            .await
            .expect("send ready");

        while let Some(message) = websocket.next().await {
            match message {
                Ok(Message::Close(_)) => break,
                Ok(_) => {}
                Err(_) => break,
            }
        }
    });

    let mut client = BackendWebSocketClient::new(
        format!("ws://127.0.0.1:{}/ws", address.port()),
        "test-token",
    );
    client.connect().await.expect("connect client");

    let mut session = SessionManager::new(Some("linux".to_string()));
    let start_message = session
        .create_session_start(Some("mic-1".to_string()), Some("sys-1".to_string()))
        .expect("start message");
    client
        .send_message(&start_message)
        .await
        .expect("send start");
    let ready = client
        .wait_for_session_ready(Duration::from_secs(1).as_secs_f64())
        .await
        .expect("wait for ready");
    session
        .handle_inbound_message(&ready)
        .expect("ready handled");

    let mic_script = "import sys; sys.stdout.buffer.write(bytes(range(16))); sys.stdout.flush()";
    let system_script = "import sys,time; sys.stdout.buffer.write(bytes(range(16))); sys.stdout.flush(); time.sleep(2)";
    let source_captures = SourceCaptures::new(
        python_capture_worker(CaptureSource::Mic, "mic-1", "Mic", mic_script),
        python_capture_worker(CaptureSource::System, "sys-1", "System", system_script),
    );

    let shutdown = ShutdownController::new();
    let result = run_live_session_with_adapter_factory(
        &mut session,
        &mut client,
        source_captures,
        &shutdown,
        TranscriptionConfig::default(),
        adapter_factory,
    )
    .await;

    let error = result.expect_err("one source ending should fail the live session");
    assert!(
        error.to_string().contains("Mic capture stream ended unexpectedly"),
        "unexpected error: {error}"
    );

    let _ = client.close().await;
    server.await.expect("join server");
}
