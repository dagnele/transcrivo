use clap::{Parser, Subcommand};
use tracing::Level;

use crate::commands;

#[derive(Clone, Copy, Debug, clap::ValueEnum)]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

impl LogLevel {
    pub fn as_level(self) -> Level {
        match self {
            Self::Error => Level::ERROR,
            Self::Warn => Level::WARN,
            Self::Info => Level::INFO,
            Self::Debug => Level::DEBUG,
            Self::Trace => Level::TRACE,
        }
    }
}

#[derive(Debug, Parser)]
#[command(name = "transcrivo")]
#[command(version)]
#[command(about = "Local Transcrivo CLI for audio capture and transcription")]
#[command(
    long_about = "Capture microphone and system audio locally, transcribe it with whisper.cpp, and stream session events to the Transcrivo backend."
)]
#[command(propagate_version = true)]
pub struct Cli {
    #[arg(long, global = true, value_enum, default_value_t = LogLevel::Info, help = "Set the log level")]
    pub log_level: LogLevel,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    #[command(about = "List available audio input and loopback devices")]
    Devices(commands::devices::DevicesArgs),

    #[command(about = "Manage local whisper.cpp models")]
    Models(commands::models::ModelsArgs),

    #[command(about = "Start live capture, transcription, and backend streaming")]
    Run(commands::run::RunArgs),
}
