use clap::{Parser, Subcommand};

use crate::commands;

#[derive(Debug, Parser)]
#[command(name = "transcrivo")]
#[command(version)]
#[command(about = "Local Transcrivo CLI for audio capture and transcription")]
#[command(
    long_about = "Capture microphone and system audio locally, transcribe it with whisper.cpp, and stream session events to the Transcrivo backend."
)]
#[command(propagate_version = true)]
pub struct Cli {
    #[arg(long, global = true, help = "Enable verbose logging")]
    pub verbose: bool,

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
