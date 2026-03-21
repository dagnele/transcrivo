use anyhow::Result;
use tracing_subscriber::EnvFilter;

pub fn init_logging(verbose: bool) -> Result<()> {
    whisper_rs::install_logging_hooks();
    crate::util::whisper_log::install_whisper_log_hook();

    let filter = if verbose {
        EnvFilter::new("debug,whisper_rs=warn,whisper_rs_sys=warn")
    } else {
        EnvFilter::new("info,whisper_rs=warn,whisper_rs_sys=warn")
    };

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init()
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;

    Ok(())
}
