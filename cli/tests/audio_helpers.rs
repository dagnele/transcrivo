use cheatcode_cli_rs::audio::capture::{pcm16le_from_f32_frames, CaptureSource};
use cheatcode_cli_rs::audio::devices::{
    format_device_inventory, get_default_microphone, get_default_system_source,
    get_microphone_by_id, get_system_source_by_id, AudioBackendTarget, AudioDevice,
    DeviceInventory, DeviceKind, PipeWireCaptureTargetKind, PipeWireTarget,
};
use cheatcode_cli_rs::audio::{linux, linux_native, windows};
use serde_json::json;

#[test]
fn pcm16le_conversion_clips_and_scales() {
    let pcm = pcm16le_from_f32_frames(&[vec![1.5, -1.5], vec![0.0, 0.5]], 2)
        .expect("pcm conversion should succeed");

    let decoded: Vec<i16> = pcm
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();

    assert_eq!(decoded[0], 32767);
    assert_eq!(decoded[1], -32767);
    assert_eq!(decoded[2], 0);
    assert_eq!(decoded[3], 16384);
}

#[test]
fn default_device_helpers_prefer_marked_defaults() {
    let inventory = DeviceInventory {
        platform: "linux".to_string(),
        backend: Some("PulseAudio".to_string()),
        microphones: vec![
            AudioDevice {
                device_id: "mic-a".to_string(),
                name: "Mic A".to_string(),
                kind: DeviceKind::Mic,
                is_default: false,
                backend: None,
                backend_target: None,
                state: None,
            },
            AudioDevice {
                device_id: "mic-b".to_string(),
                name: "Mic B".to_string(),
                kind: DeviceKind::Mic,
                is_default: true,
                backend: None,
                backend_target: None,
                state: None,
            },
        ],
        system_sources: vec![AudioDevice {
            device_id: "sys-a".to_string(),
            name: "Sys A".to_string(),
            kind: DeviceKind::System,
            is_default: true,
            backend: None,
            backend_target: None,
            state: None,
        }],
        warnings: Vec::new(),
    };

    assert_eq!(
        get_default_microphone(&inventory)
            .expect("default mic")
            .device_id,
        "mic-b"
    );
    assert_eq!(
        get_default_system_source(&inventory)
            .expect("default system")
            .device_id,
        "sys-a"
    );
}

#[test]
fn device_lookup_helpers_match_explicit_ids() {
    let inventory = DeviceInventory {
        platform: "linux".to_string(),
        backend: Some("PulseAudio".to_string()),
        microphones: vec![
            AudioDevice {
                device_id: "mic-a".to_string(),
                name: "Mic A".to_string(),
                kind: DeviceKind::Mic,
                is_default: false,
                backend: None,
                backend_target: None,
                state: None,
            },
            AudioDevice {
                device_id: "mic-b".to_string(),
                name: "Mic B".to_string(),
                kind: DeviceKind::Mic,
                is_default: false,
                backend: None,
                backend_target: None,
                state: None,
            },
        ],
        system_sources: vec![AudioDevice {
            device_id: "sys-a".to_string(),
            name: "Sys A".to_string(),
            kind: DeviceKind::System,
            is_default: false,
            backend: None,
            backend_target: None,
            state: None,
        }],
        warnings: Vec::new(),
    };

    assert_eq!(
        get_microphone_by_id(&inventory, "mic-b")
            .expect("mic should exist")
            .name,
        "Mic B"
    );
    assert_eq!(
        get_system_source_by_id(&inventory, "sys-a")
            .expect("system source should exist")
            .name,
        "Sys A"
    );
    assert!(get_microphone_by_id(&inventory, "missing").is_none());
}

#[test]
fn format_inventory_lists_defaults_and_warnings() {
    let inventory = DeviceInventory {
        platform: "linux".to_string(),
        backend: Some("PipeWire".to_string()),
        microphones: vec![AudioDevice {
            device_id: "mic-1".to_string(),
            name: "Headset Mic".to_string(),
            kind: DeviceKind::Mic,
            is_default: true,
            backend: None,
            backend_target: None,
            state: Some("RUNNING".to_string()),
        }],
        system_sources: vec![AudioDevice {
            device_id: "sys-1".to_string(),
            name: "Monitor of Speakers".to_string(),
            kind: DeviceKind::System,
            is_default: false,
            backend: None,
            backend_target: None,
            state: Some("SUSPENDED".to_string()),
        }],
        warnings: vec!["Example warning".to_string()],
    };

    let rendered = format_device_inventory(&inventory);

    assert!(rendered.contains("Platform: linux"));
    assert!(rendered.contains("Audio backend: PipeWire"));
    assert!(rendered.contains("Headset Mic [mic-1] (default, running)"));
    assert!(rendered.contains("Monitor of Speakers [sys-1] (suspended)"));
    assert!(rendered.contains("Warnings:"));
}

#[test]
fn parse_wpctl_default_name_extracts_node_name() {
    let name = linux::parse_wpctl_default_name(
        "id 54, type PipeWire:Interface:Node\n  * node.name = \"source.default\"",
    );

    assert_eq!(name, Some("source.default"));
}

#[test]
fn parse_pipewire_nodes_splits_microphones_and_sinks() {
    let devices = linux::parse_pipewire_nodes(
        json!([
            {
                "type": "PipeWire:Interface:Node",
                "info": {
                    "state": "running",
                    "props": {
                        "media.class": "Audio/Source",
                        "node.name": "source.default",
                        "node.description": "Headset Mic"
                    }
                }
            },
            {
                "type": "PipeWire:Interface:Node",
                "info": {
                    "state": "suspended",
                    "props": {
                        "media.class": "Audio/Sink",
                        "node.name": "sink.default",
                        "node.description": "Speakers"
                    }
                }
            }
        ])
        .as_array()
        .expect("array payload"),
        Some("source.default"),
        Some("sink.default"),
    );

    assert_eq!(devices.len(), 2);
    assert_eq!(devices[0].kind, DeviceKind::Mic);
    assert!(devices[0].is_default);
    assert_eq!(
        devices[0].backend_target,
        Some(AudioBackendTarget::PipeWire(PipeWireTarget {
            node_name: Some("source.default".to_string()),
            object_id: None,
            object_serial: None,
            capture_target_kind: PipeWireCaptureTargetKind::Source,
        }))
    );
    assert_eq!(devices[1].kind, DeviceKind::System);
    assert!(devices[1].is_default);
    assert_eq!(
        devices[1].backend_target,
        Some(AudioBackendTarget::PipeWire(PipeWireTarget {
            node_name: Some("sink.default".to_string()),
            object_id: None,
            object_serial: None,
            capture_target_kind: PipeWireCaptureTargetKind::SinkMonitor,
        }))
    );
}

#[test]
fn parse_pipewire_nodes_preserves_backend_target_when_cli_id_falls_back_to_serial() {
    let devices = linux::parse_pipewire_nodes(
        json!([
            {
                "type": "PipeWire:Interface:Node",
                "info": {
                    "state": "running",
                    "props": {
                        "media.class": "Audio/Sink",
                        "object.id": 45,
                        "object.serial": 145,
                        "node.description": "Speakers"
                    }
                }
            }
        ])
        .as_array()
        .expect("array payload"),
        None,
        None,
    );

    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].device_id, "145");
    assert_eq!(
        devices[0].backend_target,
        Some(AudioBackendTarget::PipeWire(PipeWireTarget {
            node_name: None,
            object_id: Some(45),
            object_serial: Some(145),
            capture_target_kind: PipeWireCaptureTargetKind::SinkMonitor,
        }))
    );
}

#[test]
fn native_linux_capture_spec_uses_pipewire_backend_target() {
    let device = AudioDevice {
        device_id: "source.default".to_string(),
        name: "Headset Mic".to_string(),
        kind: DeviceKind::Mic,
        is_default: true,
        backend: Some("pipewire".to_string()),
        backend_target: Some(AudioBackendTarget::PipeWire(PipeWireTarget {
            node_name: Some("source.default".to_string()),
            object_id: Some(54),
            object_serial: Some(154),
            capture_target_kind: PipeWireCaptureTargetKind::Source,
        })),
        state: Some("running".to_string()),
    };

    let spec = linux_native::build_native_capture_spec(&device).expect("native spec");

    assert_eq!(spec.target.node_name.as_deref(), Some("source.default"));
    assert_eq!(spec.target.object_id, Some(54));
    assert_eq!(spec.target.object_serial, Some(154));
    assert_eq!(
        spec.target.capture_target_kind,
        PipeWireCaptureTargetKind::Source
    );
}

#[test]
fn build_channel_map_uses_requested_channel_count() {
    assert_eq!(
        linux::build_channel_map(2).expect("channel map"),
        vec![0, 1]
    );
}

#[test]
fn windows_inventory_from_enumerated_endpoints_marks_defaults_and_roles() {
    let inventory = windows::inventory_from_enumerated_endpoints(
        vec![("mic-default".to_string(), "USB Mic".to_string(), true)],
        vec![
            ("spk-default".to_string(), "Speakers".to_string(), true),
            ("hdmi-out".to_string(), "HDMI Output".to_string(), false),
        ],
    );

    assert_eq!(inventory.platform, "windows");
    assert_eq!(inventory.microphones.len(), 1);
    assert_eq!(inventory.system_sources.len(), 2);
    assert_eq!(inventory.microphones[0].device_id, "mic-default");
    assert!(inventory.microphones[0].is_default);
    assert_eq!(inventory.microphones[0].kind, DeviceKind::Mic);
    assert!(inventory.system_sources[0].is_default);
    assert_eq!(inventory.system_sources[0].kind, DeviceKind::System);
    assert!(inventory
        .warnings
        .iter()
        .any(|warning| warning.contains("Core Audio endpoints")));
}

#[test]
fn windows_source_captures_prefer_marked_default_render_endpoint() {
    let inventory = windows::inventory_from_enumerated_endpoints(
        vec![("mic-a".to_string(), "Desk Mic".to_string(), true)],
        vec![
            ("spk-a".to_string(), "USB Speakers".to_string(), false),
            ("spk-b".to_string(), "Dock Audio".to_string(), true),
        ],
    );

    let captures = windows::open_source_captures(&inventory, None, None).expect("source captures");

    let mic = captures.get(CaptureSource::Mic).expect("mic capture");
    let system = captures.get(CaptureSource::System).expect("system capture");
    assert_eq!(mic.config.device_id, "mic-a");
    assert_eq!(system.config.device_id, "spk-b");
    assert_eq!(mic.config.source, CaptureSource::Mic);
    assert_eq!(system.config.source, CaptureSource::System);
}

#[test]
fn windows_devices_preserve_stable_id_and_backend_target_identity() {
    let inventory = windows::inventory_from_enumerated_endpoints(
        vec![(
            "{0.0.1.00000000}.mic-endpoint".to_string(),
            "USB Mic".to_string(),
            true,
        )],
        vec![(
            "{0.0.0.00000000}.render-endpoint".to_string(),
            "Speakers".to_string(),
            true,
        )],
    );

    assert_eq!(
        inventory.microphones[0].device_id,
        "{0.0.1.00000000}.mic-endpoint"
    );
    assert_eq!(
        inventory.microphones[0].backend_target,
        Some(AudioBackendTarget::Wasapi {
            device_id: "{0.0.1.00000000}.mic-endpoint".to_string(),
        })
    );
    assert_eq!(
        inventory.system_sources[0].backend_target,
        Some(AudioBackendTarget::Wasapi {
            device_id: "{0.0.0.00000000}.render-endpoint".to_string(),
        })
    );
}

#[test]
fn source_capture_selection_preserves_source_roles_on_linux() {
    let inventory = DeviceInventory {
        platform: "linux".to_string(),
        backend: Some("PulseAudio".to_string()),
        microphones: vec![AudioDevice {
            device_id: "mic-1".to_string(),
            name: "Mic".to_string(),
            kind: DeviceKind::Mic,
            is_default: true,
            backend: None,
            backend_target: Some(AudioBackendTarget::PipeWire(PipeWireTarget {
                node_name: Some("mic-1".to_string()),
                object_id: Some(101),
                object_serial: Some(201),
                capture_target_kind: PipeWireCaptureTargetKind::Source,
            })),
            state: None,
        }],
        system_sources: vec![AudioDevice {
            device_id: "sys-1".to_string(),
            name: "Monitor".to_string(),
            kind: DeviceKind::System,
            is_default: true,
            backend: None,
            backend_target: Some(AudioBackendTarget::PipeWire(PipeWireTarget {
                node_name: Some("sys-1".to_string()),
                object_id: Some(102),
                object_serial: Some(202),
                capture_target_kind: PipeWireCaptureTargetKind::SinkMonitor,
            })),
            state: None,
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
