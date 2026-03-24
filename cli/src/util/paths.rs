use std::env;
use std::path::PathBuf;

pub fn default_models_dir() -> Option<PathBuf> {
    if let Some(xdg_data_home) = env::var_os("XDG_DATA_HOME") {
        return Some(PathBuf::from(xdg_data_home).join("transcrivo/models"));
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(home) = env::var_os("HOME") {
            return Some(PathBuf::from(home).join(".local/share/transcrivo/models"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            return Some(PathBuf::from(local_app_data).join("Transcrivo/models"));
        }
        if let Some(profile) = env::var_os("USERPROFILE") {
            return Some(PathBuf::from(profile).join("AppData/Local/Transcrivo/models"));
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::default_models_dir;

    #[test]
    fn default_models_dir_resolves_on_supported_platform() {
        #[cfg(target_os = "linux")]
        assert!(default_models_dir().is_some());

        #[cfg(target_os = "windows")]
        assert!(default_models_dir().is_some());
    }
}
