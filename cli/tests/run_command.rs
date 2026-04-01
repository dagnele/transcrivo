use transcrivo_cli_rs::commands::models::validate_model_name;
use transcrivo_cli_rs::commands::run::{
    build_run_config, build_session_start_message, describe_selected_devices, validate_backend_url,
    validate_required_text, RunArgs, SelectedDevices,
};
use transcrivo_cli_rs::session::manager::SessionManager;
use transcrivo_cli_rs::session::models::Source;

fn selected_devices(mic_name: &str, system_name: &str) -> SelectedDevices {
    SelectedDevices {
        mic_device_id: "mic-1".to_string(),
        mic_device_name: mic_name.to_string(),
        system_device_id: "sys-1".to_string(),
        system_device_name: system_name.to_string(),
    }
}

#[test]
fn backend_url_accepts_websocket_urls() {
    assert_eq!(
        validate_backend_url("ws://localhost:8080/ws").expect("ws url should be valid"),
        "ws://localhost:8080/ws"
    );
    assert_eq!(
        validate_backend_url("wss://example.com/ws").expect("wss url should be valid"),
        "wss://example.com/ws"
    );
}

#[test]
fn backend_url_rejects_non_websocket_scheme() {
    let error =
        validate_backend_url("http://localhost:8080/ws").expect_err("http url should be rejected");

    assert_eq!(error.to_string(), "backend URL must use ws:// or wss://");
}

#[test]
fn required_text_rejects_blank_values() {
    let error = validate_required_text("token", "   ").expect_err("blank text should fail");

    assert_eq!(error.to_string(), "token must be non-empty");
}

#[test]
fn required_text_accepts_non_blank_values() {
    assert_eq!(
        validate_required_text("whisper model name", "small.en")
            .expect("non-blank text should pass"),
        "small.en"
    );
}

#[test]
fn whisper_model_name_rejects_unknown_values() {
    let error = validate_model_name("unknown-model").expect_err("unknown model should fail");

    assert_eq!(
        error.to_string(),
        "unsupported model `unknown-model`; run `transcrivo models list` to see available names"
    );
}

#[test]
fn build_session_start_message_includes_selected_device_ids() {
    let mut session = SessionManager::new(Some("linux".to_string()));
    let selected_devices = selected_devices("Headset Mic", "Monitor");
    let config = build_run_config(&RunArgs {
        backend_url: "ws://localhost:8080/ws".to_string(),
        token: "token".to_string(),
        mic_device: None,
        system_device: None,
        whisper_model_name: "large".to_string(),
        chunk_ms: 5_000,
        silence_hold_ms: 1_000,
        mic_min_rms: 0.005,
        system_min_rms: 0.005,
        session_ready_timeout_seconds: 5.0,
        whisper_language: "en".to_string(),
        whisper_use_context: true,
        whisper_use_gpu: false,
        whisper_flash_attn: false,
        whisper_gpu_device: 0,
    });

    let message = build_session_start_message(&mut session, &selected_devices, &config)
        .expect("start message should build");

    assert_eq!(message.payload["cli_version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(message.payload["mic_device_id"], "mic-1");
    assert_eq!(message.payload["system_device_id"], "sys-1");
    assert_eq!(message.payload["transcription_backend"], "whisper-rs");
    assert_eq!(message.payload["model"], "large");
}

#[test]
fn describe_selected_devices_includes_names_and_ids() {
    let selected_devices = selected_devices("Headset Mic", "Speaker Monitor");

    let description = describe_selected_devices(&selected_devices);

    assert_eq!(
        description,
        "Using devices:\n  Mic: Headset Mic (mic-1)\n  System: Speaker Monitor (sys-1)"
    );
}

#[test]
fn build_run_config_preserves_runtime_and_whisper_options() {
    let args = RunArgs {
        backend_url: "ws://localhost:8080/ws".to_string(),
        token: "token".to_string(),
        mic_device: None,
        system_device: None,
        whisper_model_name: "base.en".to_string(),
        chunk_ms: 2_500,
        silence_hold_ms: 750,
        mic_min_rms: 0.01,
        system_min_rms: 0.02,
        session_ready_timeout_seconds: 12.5,
        whisper_language: "it".to_string(),
        whisper_use_context: true,
        whisper_use_gpu: true,
        whisper_flash_attn: true,
        whisper_gpu_device: 2,
    };

    let config = build_run_config(&args);

    assert_eq!(config.live.chunk_ms, 2_500);
    assert_eq!(config.live.silence_hold_ms, 750);
    assert_eq!(config.live.mic_min_rms, 0.01);
    assert_eq!(config.live.system_min_rms, 0.02);
    assert_eq!(config.live.session_ready_timeout_seconds, 12.5);
    assert_eq!(config.whisper.whisper_model_name, "base.en");
    assert_eq!(config.whisper.whisper_language, "it");
    assert!(config.whisper.whisper_use_context);
    assert!(config.whisper.whisper_use_gpu);
    assert!(config.whisper.whisper_flash_attn);
    assert_eq!(config.whisper.whisper_gpu_device, 2);
}

#[test]
fn build_run_config_defaults_are_source_agnostic() {
    let args = RunArgs {
        backend_url: "ws://localhost:8080/ws".to_string(),
        token: "token".to_string(),
        mic_device: None,
        system_device: None,
        whisper_model_name: "large".to_string(),
        chunk_ms: 5_000,
        silence_hold_ms: 1_000,
        mic_min_rms: 0.005,
        system_min_rms: 0.005,
        session_ready_timeout_seconds: 5.0,
        whisper_language: "en".to_string(),
        whisper_use_context: true,
        whisper_use_gpu: false,
        whisper_flash_attn: false,
        whisper_gpu_device: 0,
    };

    let config = build_run_config(&args);

    assert_eq!(config.live.chunk_ms, 5_000);
    assert_eq!(config.live.silence_hold_ms, 1_000);
    assert_eq!(config.live.mic_min_rms, 0.005);
    assert_eq!(config.live.system_min_rms, 0.005);
    assert_eq!(config.live.session_ready_timeout_seconds, 5.0);
    assert_eq!(config.whisper.whisper_model_name, "large");
    assert_eq!(config.whisper.whisper_language, "en");
    assert!(config.whisper.whisper_use_context);
    assert!(!config.whisper.whisper_use_gpu);
    assert!(!config.whisper.whisper_flash_attn);
    assert_eq!(config.whisper.whisper_gpu_device, 0);
    assert_ne!(Source::Mic, Source::System);
}
