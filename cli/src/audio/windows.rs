use crate::audio::capture::{AudioCaptureWorker, CaptureConfig, CaptureSource, SourceCaptures};
use crate::audio::devices::{
    get_default_microphone, AudioBackendTarget, AudioDevice, DeviceDiscoveryError, DeviceInventory,
    DeviceKind,
};
#[cfg(target_os = "windows")]
use crate::audio::windows_native::build_native_capture_spec;

#[cfg(target_os = "windows")]
mod imp {
    use windows::core::PWSTR;
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Media::Audio::eCapture;
    use windows::Win32::Media::Audio::eConsole;
    use windows::Win32::Media::Audio::eRender;
    use windows::Win32::Media::Audio::IMMDevice;
    use windows::Win32::Media::Audio::IMMDeviceEnumerator;
    use windows::Win32::Media::Audio::MMDeviceEnumerator;
    use windows::Win32::Media::Audio::DEVICE_STATE_ACTIVE;
    use windows::Win32::System::Com::CoCreateInstance;
    use windows::Win32::System::Com::CoInitializeEx;
    use windows::Win32::System::Com::CoUninitialize;
    use windows::Win32::System::Com::StructuredStorage::PropVariantClear;
    use windows::Win32::System::Com::CLSCTX_ALL;
    use windows::Win32::System::Com::STGM_READ;
    use windows::Win32::System::Com::{StructuredStorage::PROPVARIANT, COINIT_MULTITHREADED};

    use crate::audio::devices::{
        AudioBackendTarget, AudioDevice, DeviceDiscoveryError, DeviceInventory, DeviceKind,
    };

    pub fn discover_audio_devices() -> Result<DeviceInventory, DeviceDiscoveryError> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED)
                .ok()
                .map_err(|error| DeviceDiscoveryError::CommandFailed(error.to_string()))?;
        }

        let result = discover_audio_devices_inner();

        unsafe {
            CoUninitialize();
        }

        result
    }

    fn discover_audio_devices_inner() -> Result<DeviceInventory, DeviceDiscoveryError> {
        let enumerator: IMMDeviceEnumerator = unsafe {
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|error| DeviceDiscoveryError::CommandFailed(error.to_string()))?
        };

        let default_mic_id = get_default_endpoint_id(&enumerator, eCapture)?;
        let default_render_id = get_default_endpoint_id(&enumerator, eRender)?;

        let microphones = collect_devices(
            &enumerator,
            eCapture,
            DeviceKind::Mic,
            default_mic_id.as_deref(),
        )?;
        let system_sources = collect_devices(
            &enumerator,
            eRender,
            DeviceKind::System,
            default_render_id.as_deref(),
        )?;

        let mut warnings = Vec::new();
        if microphones.is_empty() {
            warnings.push("No active Windows capture endpoints were found.".to_string());
        }
        if system_sources.is_empty() {
            warnings.push(
                "No active Windows render endpoints were found for loopback capture.".to_string(),
            );
        }
        Ok(DeviceInventory {
            platform: "windows".to_string(),
            backend: Some("wasapi".to_string()),
            microphones,
            system_sources,
            warnings,
        })
    }

    fn get_default_endpoint_id(
        enumerator: &IMMDeviceEnumerator,
        flow: windows::Win32::Media::Audio::EDataFlow,
    ) -> Result<Option<String>, DeviceDiscoveryError> {
        let endpoint = unsafe { enumerator.GetDefaultAudioEndpoint(flow, eConsole) };
        match endpoint {
            Ok(device) => Ok(Some(read_device_id(&device)?)),
            Err(_) => Ok(None),
        }
    }

    fn collect_devices(
        enumerator: &IMMDeviceEnumerator,
        flow: windows::Win32::Media::Audio::EDataFlow,
        kind: DeviceKind,
        default_device_id: Option<&str>,
    ) -> Result<Vec<AudioDevice>, DeviceDiscoveryError> {
        let collection = unsafe { enumerator.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE) }
            .map_err(|error| DeviceDiscoveryError::CommandFailed(error.to_string()))?;

        let count = unsafe { collection.GetCount() }
            .map_err(|error| DeviceDiscoveryError::CommandFailed(error.to_string()))?;

        let mut devices = Vec::with_capacity(count as usize);
        for index in 0..count {
            let endpoint = unsafe { collection.Item(index) }
                .map_err(|error| DeviceDiscoveryError::CommandFailed(error.to_string()))?;
            let device_id = read_device_id(&endpoint)?;
            let name = read_friendly_name(&endpoint)?;
            let is_default = default_device_id
                .map(|default_id| default_id == device_id)
                .unwrap_or(false);

            devices.push(AudioDevice {
                device_id: device_id.clone(),
                name,
                kind,
                is_default,
                backend: Some("wasapi".to_string()),
                backend_target: Some(AudioBackendTarget::Wasapi {
                    device_id: device_id.clone(),
                }),
                state: Some("active".to_string()),
            });
        }

        Ok(devices)
    }

    fn read_device_id(device: &IMMDevice) -> Result<String, DeviceDiscoveryError> {
        let id = unsafe { device.GetId() }
            .map_err(|error| DeviceDiscoveryError::CommandFailed(error.to_string()))?;
        pwstr_to_string(id)
    }

    fn read_friendly_name(device: &IMMDevice) -> Result<String, DeviceDiscoveryError> {
        let property_store = unsafe { device.OpenPropertyStore(STGM_READ) }
            .map_err(|error| DeviceDiscoveryError::CommandFailed(error.to_string()))?;

        let mut value: PROPVARIANT = unsafe { property_store.GetValue(&PKEY_Device_FriendlyName) }
            .map_err(|error| DeviceDiscoveryError::CommandFailed(error.to_string()))?;

        let result = propvariant_string(&value).ok_or_else(|| {
            DeviceDiscoveryError::InvalidData(
                "Windows endpoint friendly name was missing or invalid".to_string(),
            )
        });

        unsafe {
            let _ = PropVariantClear(&mut value);
        }

        result
    }

    fn propvariant_string(value: &PROPVARIANT) -> Option<String> {
        let ptr = unsafe { value.Anonymous.Anonymous.Anonymous.pwszVal };
        if ptr.is_null() {
            return None;
        }
        pwstr_to_string(PWSTR(ptr.0)).ok()
    }

    fn pwstr_to_string(value: PWSTR) -> Result<String, DeviceDiscoveryError> {
        unsafe { value.to_string() }
            .map_err(|error| DeviceDiscoveryError::CommandFailed(error.to_string()))
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    use crate::audio::devices::{
        AudioBackendTarget, AudioDevice, DeviceDiscoveryError, DeviceInventory, DeviceKind,
    };
    use serde_json::Value;
    use std::process::Command;

    pub fn discover_audio_devices() -> Result<DeviceInventory, DeviceDiscoveryError> {
        let raw_devices = run_command([
            "powershell",
            "-NoProfile",
            "-Command",
            "$devices = Get-CimInstance Win32_SoundDevice | Select-Object Name, DeviceID, Status; $devices | ConvertTo-Json",
        ])?;
        parse_powershell_devices_json(&raw_devices)
    }

    pub fn parse_powershell_devices_json(
        raw_devices: &str,
    ) -> Result<DeviceInventory, DeviceDiscoveryError> {
        let decoded: Value = serde_json::from_str(raw_devices).map_err(|_| {
            DeviceDiscoveryError::InvalidData(
                "Failed to parse PowerShell device output".to_string(),
            )
        })?;

        let decoded_devices = match decoded {
            Value::Object(object) => vec![Value::Object(object)],
            Value::Array(array) => array,
            _ => {
                return Err(DeviceDiscoveryError::InvalidData(
                    "Windows device discovery returned an unexpected shape".to_string(),
                ))
            }
        };

        let mut microphones = Vec::new();
        let mut system_sources = Vec::new();

        for entry in decoded_devices.iter().filter_map(Value::as_object) {
            let name = entry
                .get("Name")
                .or_else(|| entry.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("Unknown device")
                .to_string();
            let device_id = entry
                .get("DeviceID")
                .or_else(|| entry.get("device_id"))
                .and_then(Value::as_str)
                .unwrap_or(&name)
                .to_string();
            let status = entry
                .get("Status")
                .or_else(|| entry.get("status"))
                .and_then(Value::as_str)
                .map(str::to_string);
            let lowered_name = name.to_lowercase();

            if ["microphone", "mic", "headset"]
                .iter()
                .any(|token| lowered_name.contains(token))
            {
                microphones.push(AudioDevice {
                    device_id: device_id.clone(),
                    name: name.clone(),
                    kind: DeviceKind::Mic,
                    is_default: false,
                    backend: Some("wasapi".to_string()),
                    backend_target: Some(AudioBackendTarget::Wasapi {
                        device_id: device_id.clone(),
                    }),
                    state: status.clone(),
                });
            }

            system_sources.push(AudioDevice {
                device_id,
                name,
                kind: DeviceKind::System,
                is_default: false,
                backend: Some("wasapi".to_string()),
                backend_target: Some(AudioBackendTarget::Wasapi {
                    device_id: entry
                        .get("DeviceID")
                        .or_else(|| entry.get("device_id"))
                        .and_then(Value::as_str)
                        .unwrap_or("Unknown device")
                        .to_string(),
                }),
                state: status,
            });
        }

        let mut warnings = Vec::new();
        if microphones.is_empty() {
            warnings.push(
                "No microphone-like devices were identified from Win32_SoundDevice names."
                    .to_string(),
            );
        }
        warnings.push(
            "Default Windows mic and loopback selection remain best-effort until capture APIs are wired."
                .to_string(),
        );

        Ok(DeviceInventory {
            platform: "windows".to_string(),
            backend: Some("wasapi".to_string()),
            microphones,
            system_sources,
            warnings,
        })
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
}

pub fn open_source_captures(
    inventory: &DeviceInventory,
    mic_device_id: Option<&str>,
    system_device_id: Option<&str>,
) -> Result<SourceCaptures, DeviceDiscoveryError> {
    let mic_device = match mic_device_id {
        Some(device_id) => crate::audio::devices::get_microphone_by_id(inventory, device_id),
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
        Some(device_id) => inventory
            .system_sources
            .iter()
            .find(|device| device.device_id == device_id),
        None => inventory
            .system_sources
            .iter()
            .find(|device| device.is_default),
    }
    .or_else(|| inventory.system_sources.first())
    .ok_or_else(|| match system_device_id {
        Some(device_id) => DeviceDiscoveryError::InvalidData(format!(
            "Configured system source {device_id:?} was not found"
        )),
        None => {
            DeviceDiscoveryError::InvalidData("No default system source is available".to_string())
        }
    })?;

    Ok(SourceCaptures::new(
        create_mic_capture(mic_device)?,
        create_system_capture(system_device)?,
    ))
}

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

#[cfg(target_os = "windows")]
fn create_mic_capture(device: &AudioDevice) -> Result<AudioCaptureWorker, DeviceDiscoveryError> {
    let config = create_mic_config(device);
    let spec = build_native_capture_spec(device)?;
    Ok(AudioCaptureWorker::native_windows_wasapi(config, spec))
}

#[cfg(not(target_os = "windows"))]
fn create_mic_capture(_device: &AudioDevice) -> Result<AudioCaptureWorker, DeviceDiscoveryError> {
    Err(DeviceDiscoveryError::UnsupportedPlatform(
        std::env::consts::OS.to_string(),
    ))
}

#[cfg(target_os = "windows")]
fn create_system_capture(device: &AudioDevice) -> Result<AudioCaptureWorker, DeviceDiscoveryError> {
    let config = create_system_config(device);
    let spec = build_native_capture_spec(device)?;
    Ok(AudioCaptureWorker::native_windows_wasapi(config, spec))
}

#[cfg(not(target_os = "windows"))]
fn create_system_capture(
    _device: &AudioDevice,
) -> Result<AudioCaptureWorker, DeviceDiscoveryError> {
    Err(DeviceDiscoveryError::UnsupportedPlatform(
        std::env::consts::OS.to_string(),
    ))
}

pub fn inventory_from_enumerated_endpoints(
    microphones: Vec<(String, String, bool)>,
    system_sources: Vec<(String, String, bool)>,
) -> DeviceInventory {
    DeviceInventory {
        platform: "windows".to_string(),
        backend: Some("wasapi".to_string()),
        microphones: microphones
            .into_iter()
            .map(|(device_id, name, is_default)| AudioDevice {
                backend: Some("wasapi".to_string()),
                backend_target: Some(AudioBackendTarget::Wasapi {
                    device_id: device_id.clone(),
                }),
                device_id,
                name,
                kind: DeviceKind::Mic,
                is_default,
                state: Some("active".to_string()),
            })
            .collect(),
        system_sources: system_sources
            .into_iter()
            .map(|(device_id, name, is_default)| AudioDevice {
                backend: Some("wasapi".to_string()),
                backend_target: Some(AudioBackendTarget::Wasapi {
                    device_id: device_id.clone(),
                }),
                device_id,
                name,
                kind: DeviceKind::System,
                is_default,
                state: Some("active".to_string()),
            })
            .collect(),
        warnings: Vec::new(),
    }
}

pub fn open_default_source_captures(
    mic_device_id: Option<&str>,
    system_device_id: Option<&str>,
) -> Result<SourceCaptures, DeviceDiscoveryError> {
    let inventory = discover_audio_devices()?;
    open_source_captures(&inventory, mic_device_id, system_device_id)
}

pub use imp::*;
