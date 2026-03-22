use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_tungstenite::{
    connect_async,
    tungstenite::client::IntoClientRequest,
    tungstenite::{self, Error as TungsteniteError, Message},
    MaybeTlsStream, WebSocketStream,
};
use tracing::{debug, info};

use crate::transport::protocol::{parse_message, serialize_message, MessageEnvelope, MessageType};

pub const DEFAULT_READY_TIMEOUT_SECONDS: f64 = 5.0;

type ClientStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[derive(Debug, thiserror::Error)]
pub enum WebSocketClientError {
    #[error("WebSocket client is already connected")]
    AlreadyConnected,
    #[error("Failed to connect to backend {0}")]
    ConnectFailed(String),
    #[error("Backend WebSocket handshake failed")]
    HandshakeFailed,
    #[error("WebSocket client is not connected")]
    NotConnected,
    #[error("Failed to send message to backend")]
    SendFailed,
    #[error("Failed to receive message from backend")]
    ReceiveFailed,
    #[error("Backend connection closed")]
    ConnectionClosed,
    #[error("Backend returned a non-text WebSocket message")]
    NonTextMessage,
    #[error("Timed out waiting for backend session.ready")]
    ReadyTimeout,
    #[error(transparent)]
    BackendSession(#[from] BackendSessionError),
    #[error(transparent)]
    Protocol(#[from] crate::transport::protocol::ProtocolError),
}

#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct BackendSessionError {
    pub message: String,
    pub code: Option<String>,
}

impl BackendSessionError {
    pub fn new(message: impl Into<String>, code: Option<String>) -> Self {
        Self {
            message: message.into(),
            code,
        }
    }
}

pub struct BackendWebSocketClient {
    backend_url: String,
    token: String,
    connection: Option<ClientStream>,
}

impl std::fmt::Debug for BackendWebSocketClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BackendWebSocketClient")
            .field("backend_url", &self.backend_url)
            .field("connected", &self.connection.is_some())
            .finish()
    }
}

impl BackendWebSocketClient {
    pub fn new(backend_url: impl Into<String>, token: impl Into<String>) -> Self {
        Self {
            backend_url: backend_url.into(),
            token: token.into(),
            connection: None,
        }
    }

    pub async fn connect(&mut self) -> Result<(), WebSocketClientError> {
        if self.connection.is_some() {
            return Err(WebSocketClientError::AlreadyConnected);
        }

        info!(backend_url = %self.backend_url, "backend connect start");
        let mut request = self
            .backend_url
            .clone()
            .into_client_request()
            .map_err(|error| match error {
                tungstenite::Error::Url(_) => {
                    WebSocketClientError::ConnectFailed(self.backend_url.clone())
                }
                _ => WebSocketClientError::HandshakeFailed,
            })?;
        request.headers_mut().insert(
            "Authorization",
            format!("Bearer {}", self.token)
                .parse()
                .map_err(|_| WebSocketClientError::HandshakeFailed)?,
        );

        let connection = connect_async(request)
            .await
            .map_err(|error| match error {
                tungstenite::Error::Http(_) | tungstenite::Error::HttpFormat(_) => {
                    WebSocketClientError::HandshakeFailed
                }
                tungstenite::Error::Url(_) | tungstenite::Error::Io(_) => {
                    WebSocketClientError::ConnectFailed(self.backend_url.clone())
                }
                _ => WebSocketClientError::HandshakeFailed,
            })?
            .0;

        self.connection = Some(connection);
        info!(backend_url = %self.backend_url, "backend connect complete");
        Ok(())
    }

    pub async fn close(&mut self) -> Result<(), WebSocketClientError> {
        let Some(connection) = self.connection.as_mut() else {
            return Ok(());
        };

        info!(backend_url = %self.backend_url, "backend close start");
        match connection.close(None).await {
            Ok(()) => {}
            Err(TungsteniteError::ConnectionClosed) | Err(TungsteniteError::AlreadyClosed) => {}
            Err(_) => return Err(WebSocketClientError::ReceiveFailed),
        }
        self.connection = None;
        info!(backend_url = %self.backend_url, "backend close complete");
        Ok(())
    }

    pub async fn send_message(
        &mut self,
        message: &MessageEnvelope,
    ) -> Result<(), WebSocketClientError> {
        let raw_message = serialize_message(message)?;
        debug!(
            message_type = ?message.message_type,
            sequence = message.sequence,
            payload_keys = ?message.payload.keys().collect::<Vec<_>>(),
            raw = %raw_message,
            "backend send"
        );
        self.require_connection()?
            .send(Message::Text(raw_message.into()))
            .await
            .map_err(|_| WebSocketClientError::SendFailed)
    }

    pub async fn receive_message(&mut self) -> Result<MessageEnvelope, WebSocketClientError> {
        loop {
            let raw_message = match self.require_connection()?.next().await {
                Some(Ok(Message::Text(text))) => text,
                Some(Ok(Message::Binary(bytes))) => String::from_utf8(bytes.to_vec())
                    .map_err(|_| WebSocketClientError::NonTextMessage)?
                    .into(),
                Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {
                    debug!("ignoring backend websocket control frame");
                    continue;
                }
                Some(Ok(Message::Frame(_))) => {
                    debug!("ignoring backend websocket frame event");
                    continue;
                }
                Some(Ok(Message::Close(_))) | None => {
                    return Err(WebSocketClientError::ConnectionClosed);
                }
                Some(Err(TungsteniteError::ConnectionClosed))
                | Some(Err(TungsteniteError::AlreadyClosed)) => {
                    return Err(WebSocketClientError::ConnectionClosed);
                }
                Some(Err(_)) => return Err(WebSocketClientError::ReceiveFailed),
            };

            let message = parse_message(&raw_message)?;
            debug!(
                message_type = ?message.message_type,
                sequence = message.sequence,
                payload_keys = ?message.payload.keys().collect::<Vec<_>>(),
                raw = %raw_message,
                "backend receive"
            );
            return Ok(message);
        }
    }

    pub async fn wait_for_session_ready(
        &mut self,
        timeout_seconds: f64,
    ) -> Result<MessageEnvelope, WebSocketClientError> {
        let wait_future = async {
            loop {
                let message = self.receive_message().await?;
                if message.message_type == MessageType::SessionError {
                    let backend_message = message
                        .payload
                        .get("message")
                        .and_then(|value| value.as_str())
                        .unwrap_or("unknown backend error")
                        .to_string();
                    let backend_code = message
                        .payload
                        .get("code")
                        .and_then(|value| value.as_str())
                        .map(str::to_owned);
                    return Err(WebSocketClientError::from(BackendSessionError::new(
                        backend_message,
                        backend_code,
                    )));
                }
                if message.message_type == MessageType::SessionReady {
                    return Ok(message);
                }
            }
        };

        timeout(Duration::from_secs_f64(timeout_seconds), wait_future)
            .await
            .map_err(|_| WebSocketClientError::ReadyTimeout)?
    }

    fn require_connection(&mut self) -> Result<&mut ClientStream, WebSocketClientError> {
        self.connection
            .as_mut()
            .ok_or(WebSocketClientError::NotConnected)
    }
}
