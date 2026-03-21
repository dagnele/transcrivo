use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    match cheatcode_cli_rs::run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error:#}");
            ExitCode::from(1)
        }
    }
}
