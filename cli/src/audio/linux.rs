use std::process::Command;

use serde_json::Value;

use crate::audio::capture::{AudioCaptureWorker, CaptureConfig, CaptureSource, SourceCaptures};
use crate::audio::devices::{
    get_default_microphone, get_default_system_source, get_microphone_by_id,
    get_system_source_by_id, AudioBackendTarget, AudioDevice, DeviceDiscoveryError,
    DeviceInventory, DeviceKind, PipeWireCaptureTargetKind, PipeWireTarget,
};

pub fn discover_audio_devices() -> Result<DeviceInventory, DeviceDiscoveryError> {
    let default_source = parse_wpctl_default_name(&run_command([
        "wpctl",
        "inspect",
        "@DEFAULT_AUDIO_SOURCE@",
    ])?)
    .map(str::to_string);
    let default_sink =
        parse_wpctl_default_name(&run_command(["wpctl", "inspect", "@DEFAULT_AUDIO_SINK@"])?)
            .map(str::to_string);
    let dump_json = run_command(["pw-dump"])?;

    discover_audio_devices_from_outputs(
        default_source.as_deref(),
        default_sink.as_deref(),
        &dump_json,
    )
}

pub fn discover_audio_devices_from_outputs(
    default_source_name: Option<&str>,
    default_sink_name: Option<&str>,
    dump_json: &str,
) -> Result<DeviceInventory, DeviceDiscoveryError> {
    let decoded: Value = serde_json::from_str(dump_json).map_err(|_| {
        DeviceDiscoveryError::InvalidData("Failed to parse pw-dump JSON output".to_string())
    })?;
    let entries = decoded.as_array().ok_or_else(|| {
        DeviceDiscoveryError::InvalidData("pw-dump returned an unexpected shape".to_string())
    })?;

    let mut inventory = DeviceInventory {
        platform: "linux".to_string(),
        backend: Some("PipeWire".to_string()),
        microphones: Vec::new(),
        system_sources: Vec::new(),
        warnings: Vec::new(),
    };

    for device in parse_pipewire_nodes(entries, default_source_name, default_sink_name) {
        match device.kind {
            DeviceKind::Mic => inventory.microphones.push(device),
            DeviceKind::System => inventory.system_sources.push(device),
        }
    }

    if inventory.microphones.is_empty() {
        inventory
            .warnings
            .push("No PipeWire microphone sources were discovered.".to_string());
    }
    if inventory.system_sources.is_empty() {
        inventory
            .warnings
            .push("No PipeWire sink nodes were discovered for system capture.".to_string());
    }

    Ok(inventory)
}

pub fn open_default_source_captures(
    mic_device_id: Option<&str>,
    system_device_id: Option<&str>,
) -> Result<SourceCaptures, DeviceDiscoveryError> {
    let inventory = discover_audio_devices()?;
    open_source_captures(&inventory, mic_device_id, system_device_id)
}

pub fn open_source_captures(
    inventory: &DeviceInventory,
    mic_device_id: Option<&str>,
    system_device_id: Option<&str>,
) -> Result<SourceCaptures, DeviceDiscoveryError> {
    let mic_device = match mic_device_id {
        Some(device_id) => get_microphone_by_id(inventory, device_id),
        None => get_default_microphone(inventory),
    }
    .ok_or_else(|| match mic_device_id {
        Some(device_id) => DeviceDiscoveryError::InvalidData(format!(
            "Configured microphone source {device_id:?} was not found"
        )),
        None => DeviceDiscoveryError::InvalidData(
            "No default microphone source is available".to_string(),
        ),
    })?;

    let system_device = match system_device_id {
        Some(device_id) => get_system_source_by_id(inventory, device_id),
        None => get_default_system_source(inventory),
    }
    .ok_or_else(|| match system_device_id {
        Some(device_id) => DeviceDiscoveryError::InvalidData(format!(
            "Configured system source {device_id:?} was not found"
        )),
        None => DeviceDiscoveryError::InvalidData(
            "No default system output source is available".to_string(),
        ),
    })?;

    Ok(SourceCaptures::new(
        create_mic_capture(mic_device)?,
        create_system_capture(system_device)?,
    ))
}

pub fn parse_wpctl_default_name(raw_inspect: &str) -> Option<&str> {
    raw_inspect.lines().find_map(|line| {
        let (_, value) = line.split_once("node.name =")?;
        let trimmed = value.trim();
        trimmed.strip_prefix('"')?.strip_suffix('"')
    })
}

pub fn parse_pipewire_nodes(
    entries: &[Value],
    default_source_name: Option<&str>,
    default_sink_name: Option<&str>,
) -> Vec<AudioDevice> {
    entries
        .iter()
        .filter_map(parse_pipewire_node)
        .filter_map(|(kind, info, props)| {
            let node_name = props
                .get("node.name")
                .and_then(Value::as_str)
                .map(str::to_string);
            let object_id = props
                .get("object.id")
                .and_then(Value::as_u64)
                .and_then(|value| u32::try_from(value).ok());
            let object_serial = props
                .get("object.serial")
                .and_then(Value::as_u64)
                .and_then(|value| u32::try_from(value).ok());
            let device_id = node_name
                .clone()
                .or_else(|| object_serial.map(|value| value.to_string()))?;

            let name = props
                .get("node.description")
                .and_then(Value::as_str)
                .or_else(|| props.get("node.nick").and_then(Value::as_str))
                .or_else(|| {
                    props
                        .get("device.profile.description")
                        .and_then(Value::as_str)
                })
                .unwrap_or(device_id.as_str())
                .to_string();

            let is_default = match kind {
                DeviceKind::Mic => default_source_name == Some(device_id.as_str()),
                DeviceKind::System => default_sink_name == Some(device_id.as_str()),
            };
            let capture_target_kind = match kind {
                DeviceKind::Mic => PipeWireCaptureTargetKind::Source,
                DeviceKind::System => PipeWireCaptureTargetKind::SinkMonitor,
            };

            Some(AudioDevice {
                device_id,
                name,
                kind,
                is_default,
                backend: Some("pipewire".to_string()),
                backend_target: Some(AudioBackendTarget::PipeWire(PipeWireTarget {
                    node_name,
                    object_id,
                    object_serial,
                    capture_target_kind,
                })),
                state: info
                    .get("state")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            })
        })
        .collect()
}

pub fn build_channel_map(channels: u16) -> Result<Vec<u16>, DeviceDiscoveryError> {
    if channels == 0 {
        return Err(DeviceDiscoveryError::InvalidData(
            "channels must be greater than zero".to_string(),
        ));
    }

    Ok((0..channels).collect())
}

fn parse_pipewire_node(entry: &Value) -> Option<PipewireNode<'_>> {
    if entry.get("type")?.as_str()? != "PipeWire:Interface:Node" {
        return None;
    }

    let info = entry.get("info")?.as_object()?;
    let props = info.get("props")?.as_object()?;
    let kind = match props.get("media.class")?.as_str()? {
        "Audio/Source" => DeviceKind::Mic,
        "Audio/Sink" => DeviceKind::System,
        _ => return None,
    };

    Some((kind, info, props))
}

type PipewireNode<'a> = (
    DeviceKind,
    &'a serde_json::Map<String, Value>,
    &'a serde_json::Map<String, Value>,
);

fn create_mic_config(device: &AudioDevice) -> CaptureConfig {
    CaptureConfig::new(
        CaptureSource::Mic,
        device.device_id.clone(),
        device.name.clone(),
    )
}

fn create_system_config(device: &AudioDevice) -> CaptureConfig {
    CaptureConfig::new(
        CaptureSource::System,
        device.device_id.clone(),
        device.name.clone(),
    )
}

fn create_mic_capture(device: &AudioDevice) -> Result<AudioCaptureWorker, DeviceDiscoveryError> {
    let config = create_mic_config(device);

    let spec = crate::audio::linux_native::build_native_capture_spec(device)?;
    Ok(AudioCaptureWorker::native_linux_pipewire(config, spec))
}

fn create_system_capture(device: &AudioDevice) -> Result<AudioCaptureWorker, DeviceDiscoveryError> {
    let config = create_system_config(device);

    let spec = crate::audio::linux_native::build_native_capture_spec(device)?;
    Ok(AudioCaptureWorker::native_linux_pipewire(config, spec))
}

fn run_command<const N: usize>(command: [&str; N]) -> Result<String, DeviceDiscoveryError> {
    let output = Command::new(command[0])
        .args(&command[1..])
        .output()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                DeviceDiscoveryError::RequiredCommandUnavailable(command[0].to_string())
            } else {
                DeviceDiscoveryError::CommandFailed(error.to_string())
            }
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(DeviceDiscoveryError::CommandFailed(if stderr.is_empty() {
            format!("Command failed: {}", command.join(" "))
        } else {
            stderr
        }));
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
