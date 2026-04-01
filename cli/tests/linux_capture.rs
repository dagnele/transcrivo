#![cfg(target_os = "linux")]

use transcrivo_cli_rs::audio::capture::CaptureSource;
use transcrivo_cli_rs::audio::devices::{
    AudioBackendTarget, AudioDevice, DeviceInventory, DeviceKind, PipeWireCaptureTargetKind,
    PipeWireTarget,
};
use transcrivo_cli_rs::audio::linux;

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

    assert_eq!(
        captures
            .get(CaptureSource::Mic)
            .expect("mic capture")
            .config
            .source,
        CaptureSource::Mic
    );
    assert_eq!(
        captures
            .get(CaptureSource::System)
            .expect("system capture")
            .config
            .source,
        CaptureSource::System
    );
}
