#![cfg(target_os = "linux")]

use cheatcode_cli_rs::audio::capture::{
    AudioCaptureWorker, CaptureConfig, CaptureSource, ProcessCaptureSpec,
};
use cheatcode_cli_rs::audio::devices::{
    AudioBackendTarget, AudioDevice, DeviceInventory, DeviceKind, PipeWireCaptureTargetKind,
    PipeWireTarget,
};
use cheatcode_cli_rs::audio::linux;

#[test]
fn linux_source_captures_use_native_backends() {
    let inventory = DeviceInventory {
        platform: "linux".to_string(),
        backend: Some("PipeWire".to_string()),
        microphones: vec![AudioDevice {
            device_id: "source.default".to_string(),
            name: "Headset Mic".to_string(),
            kind: DeviceKind::Mic,
            is_default: true,
            backend: Some("PipeWire".to_string()),
            backend_target: Some(AudioBackendTarget::PipeWire(PipeWireTarget {
                node_name: Some("source.default".to_string()),
                object_id: Some(54),
                object_serial: Some(154),
                capture_target_kind: PipeWireCaptureTargetKind::Source,
            })),
            state: Some("RUNNING".to_string()),
        }],
        system_sources: vec![AudioDevice {
            device_id: "sink.default".to_string(),
            name: "Speakers".to_string(),
            kind: DeviceKind::System,
            is_default: true,
            backend: Some("PipeWire".to_string()),
            backend_target: Some(AudioBackendTarget::PipeWire(PipeWireTarget {
                node_name: Some("sink.default".to_string()),
                object_id: Some(60),
                object_serial: Some(160),
                capture_target_kind: PipeWireCaptureTargetKind::SinkMonitor,
            })),
            state: Some("RUNNING".to_string()),
        }],
        warnings: Vec::new(),
    };

    let captures = linux::open_source_captures(&inventory, None, None).expect("source captures");

    assert!(captures
        .get(CaptureSource::Mic)
        .expect("mic capture")
        .process_spec()
        .is_none());
    assert!(captures
        .get(CaptureSource::System)
        .expect("system capture")
        .process_spec()
        .is_none());
}

#[tokio::test]
async fn process_capture_worker_reads_pcm_chunk() {
    let mut config = CaptureConfig::new(CaptureSource::Mic, "mic-1", "Headset Mic");
    config.frames_per_chunk = 4;
    config.channels = 2;

    let script = "import sys,time; sys.stdout.buffer.write(bytes(range(16))); sys.stdout.flush(); time.sleep(0.2)";
    let spec = ProcessCaptureSpec::new("python3", vec!["-c".to_string(), script.to_string()]);
    let mut worker = AudioCaptureWorker::process(config, spec);

    worker.start().await.expect("worker should start");
    let chunk = worker.read_chunk().await.expect("worker should read chunk");
    worker.stop().await.expect("worker should stop");

    assert_eq!(chunk.source, CaptureSource::Mic);
    assert_eq!(chunk.frame_count, 4);
    assert_eq!(chunk.channels, 2);
    assert_eq!(chunk.pcm, (0_u8..16_u8).collect::<Vec<_>>());
}
