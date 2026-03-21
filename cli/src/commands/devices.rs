use anyhow::Result;
use clap::Args;
use tracing::info;

use crate::audio::devices::{discover_audio_devices, format_device_inventory};

#[derive(Debug, Args)]
pub struct DevicesArgs {}

pub async fn execute(_args: &DevicesArgs) -> Result<()> {
    info!(command = "devices", "starting devices command");
    let inventory = discover_audio_devices()?;
    println!("{}", format_device_inventory(&inventory));
    Ok(())
}
