use transcrivo_cli_rs::audio::capture::CaptureSource;
use transcrivo_cli_rs::session::models::Source;

#[test]
fn capture_source_converts_to_session_source() {
    assert_eq!(Source::from(CaptureSource::Mic), Source::Mic);
    assert_eq!(Source::from(CaptureSource::System), Source::System);
}
