use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

use crate::cli::LogLevel;
use crate::util::paths::format_cli_path;

const LOG_FILE_PREFIX: &str = "transcrivo.log";
const LOG_RETENTION_DAYS: usize = 7;

static LOG_GUARD: OnceLock<WorkerGuard> = OnceLock::new();

pub fn init_logging(log_level: LogLevel) -> Result<()> {
    whisper_rs::install_logging_hooks();
    crate::util::whisper_log::install_whisper_log_hook();

    let filter = EnvFilter::new(format!(
        "{},whisper_rs=warn,whisper_rs_sys=warn",
        log_level.as_level().as_str().to_ascii_lowercase()
    ));

    let logs_dir = crate::util::paths::default_logs_dir()
        .context("could not determine default Transcrivo log directory")?;
    fs::create_dir_all(&logs_dir).with_context(|| {
        format!(
            "failed to create log directory at {}",
            format_cli_path(&logs_dir)
        )
    })?;
    prune_old_logs(&logs_dir)?;

    let file_appender = tracing_appender::rolling::daily(&logs_dir, LOG_FILE_PREFIX);
    let (file_writer, guard) = tracing_appender::non_blocking(file_appender);
    let _ = LOG_GUARD.set(guard);

    tracing_subscriber::registry()
        .with(filter)
        .with(
            tracing_subscriber::fmt::layer()
                .with_target(false)
                .with_ansi(false)
                .with_writer(file_writer),
        )
        .try_init()
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;

    Ok(())
}

fn prune_old_logs(logs_dir: &Path) -> Result<()> {
    let mut log_files = list_rotated_log_files(logs_dir)?;
    if log_files.len() <= LOG_RETENTION_DAYS {
        return Ok(());
    }

    log_files.sort_by_key(|entry| entry.created_at);
    let delete_count = log_files.len().saturating_sub(LOG_RETENTION_DAYS);

    for entry in log_files.into_iter().take(delete_count) {
        fs::remove_file(&entry.path).with_context(|| {
            format!(
                "failed to remove old log file {}",
                format_cli_path(&entry.path)
            )
        })?;
    }

    Ok(())
}

fn list_rotated_log_files(logs_dir: &Path) -> Result<Vec<LogFileEntry>> {
    let mut files = Vec::new();

    for entry in fs::read_dir(logs_dir)
        .with_context(|| format!("failed to read log directory {}", format_cli_path(logs_dir)))?
    {
        let entry = entry?;
        let path = entry.path();
        if !entry.file_type()?.is_file() || !is_transcrivo_log_file(&path) {
            continue;
        }

        let metadata = entry.metadata()?;
        let created_at: DateTime<Utc> = metadata
            .modified()
            .with_context(|| format!("failed to read mtime for {}", format_cli_path(&path)))?
            .into();
        files.push(LogFileEntry { path, created_at });
    }

    Ok(files)
}

fn is_transcrivo_log_file(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(OsStr::to_str) else {
        return false;
    };

    file_name == LOG_FILE_PREFIX || file_name.starts_with(&format!("{LOG_FILE_PREFIX}."))
}

struct LogFileEntry {
    path: PathBuf,
    created_at: DateTime<Utc>,
}
