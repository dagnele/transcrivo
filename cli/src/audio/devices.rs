use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceKind {
    Mic,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PipeWireCaptureTargetKind {
    Source,
    SinkMonitor,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PipeWireTarget {
    pub node_name: Option<String>,
    pub object_id: Option<u32>,
    pub object_serial: Option<u32>,
    pub capture_target_kind: PipeWireCaptureTargetKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AudioBackendTarget {
    PipeWire(PipeWireTarget),
    Wasapi { device_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioDevice {
    pub device_id: String,
    pub name: String,
    pub kind: DeviceKind,
    pub is_default: bool,
    pub backend: Option<String>,
    // Stable CLI-facing identity lives in `device_id`; backend-specific target
    // details stay opaque here so runtime code does not branch on platform internals.
    pub backend_target: Option<AudioBackendTarget>,
    pub state: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceInventory {
    pub platform: String,
    pub backend: Option<String>,
    pub microphones: Vec<AudioDevice>,
    pub system_sources: Vec<AudioDevice>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Error)]
pub enum DeviceDiscoveryError {
    #[error("Audio device discovery is not supported on platform {0:?}")]
    UnsupportedPlatform(String),
    #[error("Required command is unavailable: {0}")]
    RequiredCommandUnavailable(String),
    #[error("{0}")]
    CommandFailed(String),
    #[error("{0}")]
    InvalidData(String),
}

pub fn get_default_microphone(inventory: &DeviceInventory) -> Option<&AudioDevice> {
    get_default_device(&inventory.microphones)
}

pub fn get_default_system_source(inventory: &DeviceInventory) -> Option<&AudioDevice> {
    get_default_device(&inventory.system_sources)
}

pub fn get_microphone_by_id<'a>(
    inventory: &'a DeviceInventory,
    device_id: &str,
) -> Option<&'a AudioDevice> {
    get_device_by_id(&inventory.microphones, device_id)
}

pub fn get_system_source_by_id<'a>(
    inventory: &'a DeviceInventory,
    device_id: &str,
) -> Option<&'a AudioDevice> {
    get_device_by_id(&inventory.system_sources, device_id)
}

pub fn discover_audio_devices() -> Result<DeviceInventory, DeviceDiscoveryError> {
    #[cfg(target_os = "linux")]
    {
        return crate::audio::linux::discover_audio_devices();
    }

    #[cfg(target_os = "windows")]
    {
        return crate::audio::windows::discover_audio_devices();
    }

    #[allow(unreachable_code)]
    Err(DeviceDiscoveryError::UnsupportedPlatform(
        std::env::consts::OS.to_string(),
    ))
}

pub fn format_device_inventory(inventory: &DeviceInventory) -> String {
    let mut lines = vec![format!("Platform: {}", inventory.platform)];
    if let Some(backend) = &inventory.backend {
        lines.push(format!("Audio backend: {backend}"));
    }

    lines.push(String::new());
    lines.push("Microphones:".to_string());
    if inventory.microphones.is_empty() {
        lines.push("- none found".to_string());
    } else {
        lines.extend(format_device_lines(&inventory.microphones));
    }

    lines.push(String::new());
    lines.push("System Output Sources:".to_string());
    if inventory.system_sources.is_empty() {
        lines.push("- none found".to_string());
    } else {
        lines.extend(format_device_lines(&inventory.system_sources));
    }

    if !inventory.warnings.is_empty() {
        lines.push(String::new());
        lines.push("Warnings:".to_string());
        lines.extend(
            inventory
                .warnings
                .iter()
                .map(|warning| format!("- {warning}")),
        );
    }

    lines.join("\n")
}

fn format_device_lines(devices: &[AudioDevice]) -> Vec<String> {
    devices
        .iter()
        .map(|device| {
            let mut suffix = Vec::new();
            if device.is_default {
                suffix.push("default".to_string());
            }
            if let Some(state) = &device.state {
                suffix.push(state.to_lowercase());
            }
            let details = if suffix.is_empty() {
                String::new()
            } else {
                format!(" ({})", suffix.join(", "))
            };
            format!("- {} [{}]{}", device.name, device.device_id, details)
        })
        .collect()
}

fn get_default_device(devices: &[AudioDevice]) -> Option<&AudioDevice> {
    devices
        .iter()
        .find(|device| device.is_default)
        .or_else(|| devices.first())
}

fn get_device_by_id<'a>(devices: &'a [AudioDevice], device_id: &str) -> Option<&'a AudioDevice> {
    devices.iter().find(|device| device.device_id == device_id)
}
