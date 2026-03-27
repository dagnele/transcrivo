use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio::net::TcpListener;
use tokio_tungstenite::{
    accept_hdr_async,
    tungstenite::handshake::server::{Callback, ErrorResponse, NoCallback, Request, Response},
    tungstenite::Message,
};

use transcrivo_cli_rs::transport::protocol::{MessageEnvelope, MessageType};
use transcrivo_cli_rs::transport::{BackendWebSocketClient, DEFAULT_READY_TIMEOUT_SECONDS};

struct AuthHeaderRecorder {
    auth_header: Arc<Mutex<Option<String>>>,
}

impl Callback for AuthHeaderRecorder {
    fn on_request(self, request: &Request, response: Response) -> Result<Response, ErrorResponse> {
        let header = request
            .headers()
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        *self.auth_header.lock().expect("auth lock") = header;
        Ok(response)
    }
}

#[tokio::test]
async fn connect_send_and_receive_ready() {
    let received_messages = Arc::new(Mutex::new(Vec::new()));
    let auth_header = Arc::new(Mutex::new(None::<String>));
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let address = listener.local_addr().expect("local addr");

    let server_received = Arc::clone(&received_messages);
    let server_auth = Arc::clone(&auth_header);
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.expect("accept connection");
        let mut websocket = accept_hdr_async(
            stream,
            AuthHeaderRecorder {
                auth_header: server_auth,
            },
        )
        .await
        .expect("accept websocket");

        if let Some(message) = websocket.next().await {
            let raw = message
                .expect("read message")
                .into_text()
                .expect("text message");
            let decoded: serde_json::Value = serde_json::from_str(&raw).expect("decode json");
            server_received
                .lock()
                .expect("messages lock")
                .push(decoded.clone());

            if decoded["type"] == "session.start" {
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
            }
        }
    });

    let mut client = BackendWebSocketClient::new(
        format!("ws://127.0.0.1:{}/ws", address.port()),
        "test-token",
    );
    client.connect().await.expect("connect client");

    let start_message = MessageEnvelope::new(
        MessageType::SessionStart,
        1,
        json!({
            "cli_version": env!("CARGO_PKG_VERSION"),
            "platform": "linux",
            "started_at": "2026-03-17T00:00:00.000Z",
            "transcription_backend": "whisper-rs",
            "model": "small.en"
        })
        .as_object()
        .unwrap()
        .clone(),
    )
    .expect("start envelope");

    client
        .send_message(&start_message)
        .await
        .expect("send start");
    let ready = client
        .wait_for_session_ready(DEFAULT_READY_TIMEOUT_SECONDS)
        .await
        .expect("wait for ready");
    client.close().await.expect("close client");
    server.await.expect("join server");

    assert_eq!(ready.message_type, MessageType::SessionReady);
    assert_eq!(
        received_messages.lock().expect("messages lock")[0]["type"],
        "session.start"
    );
    assert_eq!(
        auth_header.lock().expect("auth lock").as_deref(),
        Some("Bearer test-token")
    );
}

#[tokio::test]
async fn backend_error_is_returned_while_waiting_for_ready() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let address = listener.local_addr().expect("local addr");

    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.expect("accept connection");
        let mut websocket = accept_hdr_async(stream, NoCallback)
            .await
            .expect("accept websocket");

        if let Some(message) = websocket.next().await {
            let raw = message
                .expect("read message")
                .into_text()
                .expect("text message");
            let decoded: serde_json::Value = serde_json::from_str(&raw).expect("decode json");

            if decoded["type"] == "session.start" {
                websocket
                    .send(
                        MessageEnvelope::new(
                            MessageType::SessionError,
                            1,
                            json!({ "message": "invalid token" })
                                .as_object()
                                .unwrap()
                                .clone(),
                        )
                        .expect("error envelope")
                        .to_json()
                        .expect("error json")
                        .into(),
                    )
                    .await
                    .expect("send error");
            }
        }
    });

    let mut client = BackendWebSocketClient::new(
        format!("ws://127.0.0.1:{}/ws", address.port()),
        "test-token",
    );
    client.connect().await.expect("connect client");
    client
        .send_message(
            &MessageEnvelope::new(
                MessageType::SessionStart,
                1,
                json!({
                    "cli_version": env!("CARGO_PKG_VERSION"),
                    "platform": "linux",
                    "started_at": "2026-03-17T00:00:00.000Z",
                    "transcription_backend": "whisper-rs",
                    "model": "small.en"
                })
                .as_object()
                .unwrap()
                .clone(),
            )
            .expect("start envelope"),
        )
        .await
        .expect("send start");

    let error = client
        .wait_for_session_ready(DEFAULT_READY_TIMEOUT_SECONDS)
        .await
        .expect_err("backend error should fail ready wait");
    client.close().await.expect("close client");
    server.await.expect("join server");

    assert_eq!(error.to_string(), "invalid token");
}

#[tokio::test]
async fn backend_error_preserves_error_code_while_waiting_for_ready() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let address = listener.local_addr().expect("local addr");

    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.expect("accept connection");
        let mut websocket = accept_hdr_async(stream, NoCallback)
            .await
            .expect("accept websocket");

        if let Some(message) = websocket.next().await {
            let raw = message
                .expect("read message")
                .into_text()
                .expect("text message");
            let decoded: serde_json::Value = serde_json::from_str(&raw).expect("decode json");

            if decoded["type"] == "session.start" {
                websocket
                    .send(
                        MessageEnvelope::new(
                            MessageType::SessionError,
                            1,
                            json!({
                                "message": "Session has expired.",
                                "code": "session_expired"
                            })
                            .as_object()
                            .unwrap()
                            .clone(),
                        )
                        .expect("error envelope")
                        .to_json()
                        .expect("error json")
                        .into(),
                    )
                    .await
                    .expect("send error");
            }
        }
    });

    let mut client = BackendWebSocketClient::new(
        format!("ws://127.0.0.1:{}/ws", address.port()),
        "test-token",
    );
    client.connect().await.expect("connect client");
    client
        .send_message(
            &MessageEnvelope::new(
                MessageType::SessionStart,
                1,
                json!({
                    "cli_version": env!("CARGO_PKG_VERSION"),
                    "platform": "linux",
                    "started_at": "2026-03-17T00:00:00.000Z",
                    "transcription_backend": "whisper-rs",
                    "model": "small.en"
                })
                .as_object()
                .unwrap()
                .clone(),
            )
            .expect("start envelope"),
        )
        .await
        .expect("send start");

    let error = client
        .wait_for_session_ready(DEFAULT_READY_TIMEOUT_SECONDS)
        .await
        .expect_err("backend error should fail ready wait");
    client.close().await.expect("close client");
    server.await.expect("join server");

    match error {
        transcrivo_cli_rs::transport::WebSocketClientError::BackendSession(error) => {
            assert_eq!(error.message, "Session has expired.");
            assert_eq!(error.code.as_deref(), Some("session_expired"));
        }
        other => panic!("expected backend session error, got {other:?}"),
    }
}

#[tokio::test]
async fn wait_for_ready_ignores_control_frames() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let address = listener.local_addr().expect("local addr");

    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.expect("accept connection");
        let mut websocket = accept_hdr_async(stream, NoCallback)
            .await
            .expect("accept websocket");

        if let Some(message) = websocket.next().await {
            let raw = message
                .expect("read message")
                .into_text()
                .expect("text message");
            let decoded: serde_json::Value = serde_json::from_str(&raw).expect("decode json");

            if decoded["type"] == "session.start" {
                websocket
                    .send(Message::Ping(Vec::new().into()))
                    .await
                    .expect("send ping");
                websocket
                    .send(Message::Pong(Vec::new().into()))
                    .await
                    .expect("send pong");
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
            }
        }
    });

    let mut client = BackendWebSocketClient::new(
        format!("ws://127.0.0.1:{}/ws", address.port()),
        "test-token",
    );
    client.connect().await.expect("connect client");
    client
        .send_message(
            &MessageEnvelope::new(
                MessageType::SessionStart,
                1,
                json!({
                    "cli_version": env!("CARGO_PKG_VERSION"),
                    "platform": "linux",
                    "started_at": "2026-03-17T00:00:00.000Z",
                    "transcription_backend": "whisper-rs",
                    "model": "small.en"
                })
                .as_object()
                .unwrap()
                .clone(),
            )
            .expect("start envelope"),
        )
        .await
        .expect("send start");

    let ready = client
        .wait_for_session_ready(DEFAULT_READY_TIMEOUT_SECONDS)
        .await
        .expect("wait for ready");
    client.close().await.expect("close client");
    server.await.expect("join server");

    assert_eq!(ready.message_type, MessageType::SessionReady);
}

#[tokio::test]
async fn wait_for_ready_rejects_non_ok_status() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let address = listener.local_addr().expect("local addr");

    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.expect("accept connection");
        let mut websocket = accept_hdr_async(stream, NoCallback)
            .await
            .expect("accept websocket");

        if let Some(message) = websocket.next().await {
            let raw = message
                .expect("read message")
                .into_text()
                .expect("text message");
            let decoded: serde_json::Value = serde_json::from_str(&raw).expect("decode json");

            if decoded["type"] == "session.start" {
                websocket
                    .send(
                        MessageEnvelope::new(
                            MessageType::SessionReady,
                            1,
                            json!({ "status": "pending" }).as_object().unwrap().clone(),
                        )
                        .expect("ready envelope")
                        .to_json()
                        .expect("ready json")
                        .into(),
                    )
                    .await
                    .expect("send ready");
            }
        }
    });

    let mut client = BackendWebSocketClient::new(
        format!("ws://127.0.0.1:{}/ws", address.port()),
        "test-token",
    );
    client.connect().await.expect("connect client");
    client
        .send_message(
            &MessageEnvelope::new(
                MessageType::SessionStart,
                1,
                json!({
                    "cli_version": env!("CARGO_PKG_VERSION"),
                    "platform": "linux",
                    "started_at": "2026-03-17T00:00:00.000Z",
                    "transcription_backend": "whisper-rs",
                    "model": "small.en"
                })
                .as_object()
                .unwrap()
                .clone(),
            )
            .expect("start envelope"),
        )
        .await
        .expect("send start");

    let ready = client
        .wait_for_session_ready(DEFAULT_READY_TIMEOUT_SECONDS)
        .await
        .expect("wait for ready");
    let error = transcrivo_cli_rs::session::manager::SessionManager::new(Some("linux".to_string()))
        .handle_inbound_message(&ready)
        .expect_err("non-ok ready should be rejected");
    client.close().await.expect("close client");
    server.await.expect("join server");

    assert_eq!(error, "backend did not accept session as ready: status=pending");
}
