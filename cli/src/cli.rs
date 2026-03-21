use clap::{Parser, Subcommand};

use crate::commands;

#[derive(Debug, Parser)]
#[command(name = "cheatcode")]
#[command(about = "Local Cheatcode CLI for audio capture and transcription")]
pub struct Cli {
    #[arg(long, global = true, help = "Enable verbose logging")]
    pub verbose: bool,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    Devices(commands::devices::DevicesArgs),
    Models(commands::models::ModelsArgs),
    Run(commands::run::RunArgs),
}
