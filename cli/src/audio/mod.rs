pub mod capture;
pub mod devices;
#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "linux")]
pub mod linux_native;
pub mod preprocess;
pub mod vad;
pub mod windows;
#[cfg(target_os = "windows")]
pub mod windows_native;

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
