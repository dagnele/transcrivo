use cheatcode_cli_rs::audio::capture::{
    AudioCaptureWorker, CaptureConfig, CaptureSource, SourceCaptures,
};
use cheatcode_cli_rs::commands::models::validate_model_name;
use cheatcode_cli_rs::commands::run::{
    build_session_start_message, build_transcription_config, describe_selected_devices,
    validate_backend_url, validate_required_text, RunArgs, SelectedDevices,
};
use cheatcode_cli_rs::session::manager::SessionManager;

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
        "unsupported model `unknown-model`; run `cheatcode models list` to see available names"
    );
}

#[test]
fn build_session_start_message_includes_selected_device_ids() {
    let mut session = SessionManager::new(Some("linux".to_string()));
    let captures = SourceCaptures::new(
        AudioCaptureWorker::placeholder(CaptureConfig::new(
            CaptureSource::Mic,
            "mic-1",
            "Headset Mic",
        )),
        AudioCaptureWorker::placeholder(CaptureConfig::new(
            CaptureSource::System,
            "sys-1",
            "Monitor",
        )),
    );
    let selected_devices =
        SelectedDevices::from_source_captures(&captures).expect("selected devices should build");

    let message = build_session_start_message(&mut session, &selected_devices)
        .expect("start message should build");

    assert_eq!(message.payload["mic_device_id"], "mic-1");
    assert_eq!(message.payload["system_device_id"], "sys-1");
}

#[test]
fn describe_selected_devices_includes_names_and_ids() {
    let captures = SourceCaptures::new(
        AudioCaptureWorker::placeholder(CaptureConfig::new(
            CaptureSource::Mic,
            "mic-1",
            "Headset Mic",
        )),
        AudioCaptureWorker::placeholder(CaptureConfig::new(
            CaptureSource::System,
            "sys-1",
            "Speaker Monitor",
        )),
    );
    let selected_devices =
        SelectedDevices::from_source_captures(&captures).expect("selected devices should build");

    let description = describe_selected_devices(&selected_devices);

    assert_eq!(
        description,
        "Using devices:\n  Mic: Headset Mic (mic-1)\n  System: Speaker Monitor (sys-1)"
    );
}

#[test]
fn build_transcription_config_preserves_gpu_options() {
    let args = RunArgs {
        backend_url: Some("ws://localhost:8080/ws".to_string()),
        token: Some("token".to_string()),
        mic_device: None,
        system_device: None,
        whisper_model_name: Some("base.en".to_string()),
        whisper_use_gpu: true,
        whisper_flash_attn: true,
        whisper_gpu_device: 2,
    };

    let config = build_transcription_config(&args);

    assert_eq!(config.whisper_model_name.as_deref(), Some("base.en"));
    assert!(config.whisper_use_gpu);
    assert!(config.whisper_flash_attn);
    assert_eq!(config.whisper_gpu_device, 2);
}
