pub mod capture;
pub mod devices;
pub mod linux;
pub mod linux_native;
pub mod preprocess;
pub mod vad;
pub mod windows;

use capture::SourceCaptures;
use devices::DeviceDiscoveryError;

pub fn open_default_source_captures(
    mic_device_id: Option<&str>,
    system_device_id: Option<&str>,
) -> Result<SourceCaptures, DeviceDiscoveryError> {
    #[cfg(target_os = "linux")]
    {
        return linux::open_default_source_captures(mic_device_id, system_device_id);
    }

    #[cfg(target_os = "windows")]
    {
        return windows::open_default_source_captures(mic_device_id, system_device_id);
    }

    #[allow(unreachable_code)]
    Err(DeviceDiscoveryError::UnsupportedPlatform(
        std::env::consts::OS.to_string(),
    ))
}
