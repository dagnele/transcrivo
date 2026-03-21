use std::path::PathBuf;

use anyhow::{bail, Context, Result};
use clap::{Args, Subcommand};
use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;
use tracing::info;

use crate::util::paths::default_models_dir;

const BASE_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const KNOWN_MODELS: &[&str] = &[
    "tiny",
    "tiny.en",
    "base",
    "base.en",
    "small",
    "small.en",
    "medium",
    "medium.en",
    "large-v1",
    "large-v2",
    "large-v3",
    "large-v3-turbo",
];

#[derive(Debug, Args)]
pub struct ModelsArgs {
    #[command(subcommand)]
    pub command: ModelsCommand,
}

#[derive(Debug, Subcommand)]
pub enum ModelsCommand {
    List,
    Status,
    Download(DownloadArgs),
}

#[derive(Debug, Args)]
pub struct DownloadArgs {
    #[arg(help = "Whisper model name, for example `small.en` or `base`.")]
    pub model: String,

    #[arg(
        long,
        help = "Directory to store the downloaded model. Defaults to the standard Cheatcode app data models directory."
    )]
    pub output_dir: Option<PathBuf>,

    #[arg(long, help = "Overwrite an existing model file.")]
    pub force: bool,
}

pub async fn execute(args: &ModelsArgs) -> Result<()> {
    match &args.command {
        ModelsCommand::List => list_models(),
        ModelsCommand::Status => status_models(),
        ModelsCommand::Download(args) => download_model(args).await,
    }
}

pub async fn ensure_model_downloaded(model: &str) -> Result<PathBuf> {
    validate_model_name(model)?;

    let output_dir = default_models_dir()
        .context("could not determine a default models directory for this platform")?;
    let destination = output_dir.join(model_filename(model));
    if destination.is_file() {
        return Ok(destination);
    }

    download_model(&DownloadArgs {
        model: model.to_string(),
        output_dir: Some(output_dir),
        force: false,
    })
    .await?;

    Ok(destination)
}

fn list_models() -> Result<()> {
    println!("Available whisper.cpp models:");
    for model in KNOWN_MODELS {
        println!("- {model}");
    }
    Ok(())
}

fn status_models() -> Result<()> {
    let models_dir = default_models_dir()
        .context("could not determine a default models directory for this platform")?;

    println!("Standard models directory:");
    println!("{}", models_dir.display());
    println!();

    if !models_dir.exists() {
        println!("Directory does not exist yet.");
        println!("Run `cheatcode models download <model>` to install one.");
        return Ok(());
    }

    println!("Known models:");
    for model in KNOWN_MODELS {
        let installed = models_dir.join(model_filename(model)).is_file();
        let status = if installed { "installed" } else { "missing" };
        println!("- {model}: {status}");
    }

    Ok(())
}

async fn download_model(args: &DownloadArgs) -> Result<()> {
    validate_model_name(&args.model)?;

    let output_dir = args
        .output_dir
        .clone()
        .or_else(default_models_dir)
        .context("could not determine a default models directory for this platform")?;
    tokio::fs::create_dir_all(&output_dir)
        .await
        .with_context(|| format!("failed to create model directory {}", output_dir.display()))?;

    let filename = model_filename(&args.model);
    let destination = output_dir.join(&filename);
    let temporary = destination.with_extension("bin.part");
    let url = format!("{BASE_URL}/{filename}");

    if destination.exists() && !args.force {
        println!("Model already exists: {}", destination.display());
        println!("Use --force to re-download.");
        return Ok(());
    }

    info!(model = %args.model, destination = %destination.display(), "downloading whisper model");
    println!("Downloading {} from {}", args.model, url);
    println!("Saving to {}", destination.display());

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .with_context(|| format!("failed to request {url}"))?
        .error_for_status()
        .with_context(|| format!("download request failed for {url}"))?;

    let total_bytes = response.content_length();
    let mut downloaded_bytes = 0_u64;
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(&temporary)
        .await
        .with_context(|| format!("failed to create {}", temporary.display()))?;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.with_context(|| format!("download interrupted for {url}"))?;
        file.write_all(&chunk)
            .await
            .with_context(|| format!("failed to write {}", temporary.display()))?;
        downloaded_bytes += chunk.len() as u64;
        print_progress(&filename, downloaded_bytes, total_bytes);
    }

    file.flush().await.with_context(|| {
        format!(
            "failed to flush downloaded model file {}",
            temporary.display()
        )
    })?;
    drop(file);

    if destination.exists() && args.force {
        tokio::fs::remove_file(&destination)
            .await
            .with_context(|| {
                format!(
                    "failed to replace existing model file {}",
                    destination.display()
                )
            })?;
    }
    tokio::fs::rename(&temporary, &destination)
        .await
        .with_context(|| {
            format!(
                "failed to move downloaded model into place at {}",
                destination.display()
            )
        })?;

    println!();
    println!("Done.");
    println!("Use with: --whisper-model-path {}", destination.display());
    Ok(())
}

pub fn validate_model_name(model: &str) -> Result<()> {
    if KNOWN_MODELS.contains(&model) {
        Ok(())
    } else {
        bail!("unsupported model `{model}`; run `cheatcode models list` to see available names")
    }
}

fn model_filename(model: &str) -> String {
    format!("ggml-{model}.bin")
}

fn print_progress(filename: &str, downloaded_bytes: u64, total_bytes: Option<u64>) {
    match total_bytes {
        Some(total_bytes) if total_bytes > 0 => {
            let percent = downloaded_bytes.saturating_mul(100) / total_bytes;
            print!(
                "\rDownloading {filename}: {percent:3}% ({} MiB / {} MiB)",
                downloaded_bytes / (1024 * 1024),
                total_bytes / (1024 * 1024)
            );
        }
        _ => {
            print!(
                "\rDownloading {filename}: {} MiB",
                downloaded_bytes / (1024 * 1024)
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{model_filename, validate_model_name};

    #[test]
    fn validates_known_model_names() {
        validate_model_name("small.en").expect("small.en should be supported");
        assert!(validate_model_name("unknown-model").is_err());
    }

    #[test]
    fn model_filename_matches_ggml_naming() {
        assert_eq!(model_filename("small.en"), "ggml-small.en.bin");
    }
}
