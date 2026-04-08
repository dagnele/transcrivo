use std::env;
use std::path::{Path, PathBuf};

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

pub fn default_logs_dir() -> Option<PathBuf> {
    if let Some(xdg_data_home) = env::var_os("XDG_DATA_HOME") {
        return Some(PathBuf::from(xdg_data_home).join("transcrivo/logs"));
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(home) = env::var_os("HOME") {
            return Some(PathBuf::from(home).join(".local/share/transcrivo/logs"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            return Some(PathBuf::from(local_app_data).join("Transcrivo/logs"));
        }
        if let Some(profile) = env::var_os("USERPROFILE") {
            return Some(PathBuf::from(profile).join("AppData/Local/Transcrivo/logs"));
        }
    }

    None
}

pub fn format_cli_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::{default_logs_dir, default_models_dir, format_cli_path};

    #[test]
    fn default_models_dir_resolves_on_supported_platform() {
        #[cfg(target_os = "linux")]
        assert!(default_models_dir().is_some());

        #[cfg(target_os = "windows")]
        assert!(default_models_dir().is_some());
    }

    #[test]
    fn default_logs_dir_resolves_on_supported_platform() {
        #[cfg(target_os = "linux")]
        assert!(default_logs_dir().is_some());

        #[cfg(target_os = "windows")]
        assert!(default_logs_dir().is_some());
    }

    #[test]
    fn format_cli_path_normalizes_windows_separators() {
        let path = Path::new(r"C:\Users\Daniele\AppData\Local\Transcrivo\models\ggml-medium.bin");
        assert_eq!(
            format_cli_path(path),
            "C:/Users/Daniele/AppData/Local/Transcrivo/models/ggml-medium.bin"
        );
    }

    #[test]
    fn format_cli_path_preserves_unix_style_paths() {
        let path = PathBuf::from("/home/daniele/.local/share/transcrivo/models/ggml-medium.bin");
        assert_eq!(
            format_cli_path(&path),
            "/home/daniele/.local/share/transcrivo/models/ggml-medium.bin"
        );
    }
}
