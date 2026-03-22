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

pub fn chunk_rms(samples: &[f32]) -> Option<f32> {
    if samples.is_empty() {
        return None;
    }

    let mean_square =
        samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32;
    Some(mean_square.sqrt())
}

pub fn should_keep_chunk(samples: &[f32], config: &VadConfig) -> bool {
    if !config.enabled {
        return true;
    }

    chunk_rms(samples).is_some_and(|rms| rms_is_speech(rms, config.min_rms))
}
