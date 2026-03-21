#[derive(Debug, Clone, PartialEq)]
pub struct VadConfig {
    pub enabled: bool,
    pub min_rms: f32,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            min_rms: 0.01,
        }
    }
}

pub fn rms_is_speech(rms: f32, threshold: f32) -> bool {
    rms >= threshold
}

pub fn should_keep_chunk(samples: &[f32], config: &VadConfig) -> bool {
    if !config.enabled {
        return true;
    }
    if samples.is_empty() {
        return false;
    }

    let mean_square =
        samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32;
    rms_is_speech(mean_square.sqrt(), config.min_rms)
}
