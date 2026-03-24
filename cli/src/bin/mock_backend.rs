use anyhow::Result;
use clap::Parser;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio_tungstenite::{accept_async, tungstenite::Message};

#[derive(Debug, Parser)]
#[command(name = "mock_backend")]
#[command(about = "Run a local mock websocket backend for transcrivo")]
struct Args {
    #[arg(long, default_value = "127.0.0.1")]
    host: String,

    #[arg(long, default_value_t = 8080)]
    port: u16,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let bind_address = format!("{}:{}", args.host, args.port);
    let listener = TcpListener::bind(&bind_address).await?;

    println!("Mock backend listening on ws://{}/ws", bind_address);

    loop {
        let (stream, remote_addr) = listener.accept().await?;
        tokio::spawn(async move {
            if let Err(error) = handle_connection(stream, remote_addr).await {
                eprintln!("mock backend connection error: {error:#}");
            }
        });
    }
}

async fn handle_connection(
    stream: tokio::net::TcpStream,
    remote_addr: std::net::SocketAddr,
) -> Result<()> {
    let mut websocket = accept_async(stream).await?;
    println!("Client connected from {remote_addr}");
    let mut ready_sent = false;

    while let Some(message) = websocket.next().await {
        match message? {
            Message::Text(text) => {
                print_message(&text);

                if !ready_sent {
                    let decoded: Result<Value, _> = serde_json::from_str(&text);
                    if decoded
                        .as_ref()
                        .ok()
                        .and_then(|value| value.get("type"))
                        .and_then(Value::as_str)
                        == Some("session.start")
                    {
                        websocket
                            .send(Message::Text(
                                json!({
                                    "type": "session.ready",
                                    "sequence": 1,
                                    "payload": { "status": "ok" }
                                })
                                .to_string()
                                .into(),
                            ))
                            .await?;
                        ready_sent = true;
                    }
                }
            }
            Message::Binary(bytes) => {
                println!("<binary {} bytes>", bytes.len());
            }
            Message::Close(frame) => {
                if let Some(frame) = frame {
                    println!(
                        "Client disconnected cleanly: code={} reason={}",
                        u16::from(frame.code),
                        frame.reason
                    );
                } else {
                    println!("Client disconnected cleanly");
                }
                return Ok(());
            }
            Message::Ping(payload) => {
                websocket.send(Message::Pong(payload)).await?;
            }
            Message::Pong(_) => {}
            Message::Frame(_) => {}
        }
    }

    println!("Client disconnected");
    Ok(())
}

fn print_message(raw: &str) {
    match serde_json::from_str::<Value>(raw) {
        Ok(decoded) => match serde_json::to_string_pretty(&decoded) {
            Ok(pretty) => println!("{pretty}"),
            Err(_) => println!("{raw}"),
        },
        Err(_) => println!("{raw}"),
    }
}
