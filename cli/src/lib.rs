pub mod audio;
pub mod cli;
pub mod commands;
pub mod logging;
pub mod session;
pub mod transcribe;
pub mod transport;
pub mod util;

use anyhow::Result;
use clap::Parser;

pub async fn run() -> Result<()> {
    let cli = cli::Cli::parse();
    logging::config::init_logging(cli.verbose)?;

    match &cli.command {
        cli::Command::Devices(args) => commands::devices::execute(args).await,
        cli::Command::Models(args) => commands::models::execute(args).await,
        cli::Command::Run(args) => commands::run::execute(args).await,
    }
}
