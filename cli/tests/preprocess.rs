use transcrivo_cli_rs::audio::capture::{CaptureSource, PcmChunk};
use transcrivo_cli_rs::audio::preprocess::{
    downmix_to_mono, frames_to_ms, ms_to_frames, normalize_audio, pcm16le_to_f32, resample_audio,
    PreprocessConfig, PreprocessState,
};
use transcrivo_cli_rs::audio::vad::{should_keep_chunk, VadConfig};

#[test]
fn pcm16le_round_trip_shape() {
    let pcm = [0_i16, 32767, -32767, 16384]
        .into_iter()
        .flat_map(i16::to_le_bytes)
        .collect::<Vec<_>>();

    let frames = pcm16le_to_f32(&pcm, 2).expect("pcm should decode");

    assert_eq!(frames.len(), 2);
    assert_eq!(frames[0].len(), 2);
    assert!((frames[0][1] - 1.0).abs() < 0.001);
}

#[test]
fn downmix_to_mono_averages_channels() {
    let mono = downmix_to_mono(&[vec![1.0, -1.0], vec![0.5, 0.5]]);

    assert_eq!(mono.len(), 2);
    assert!(mono[0].abs() < 0.00001);
    assert!((mono[1] - 0.5).abs() < 0.00001);
}

#[test]
fn normalize_audio_scales_to_peak() {
    let normalized = normalize_audio(&[0.2, 0.4], 0.8);
    let max = normalized
        .iter()
        .fold(0.0_f32, |current, sample| current.max(sample.abs()));

    assert!((max - 0.8).abs() < 0.0001);
}

#[test]
fn resample_audio_changes_frame_count() {
    let frames = (0..48)
        .map(|index| -1.0 + 2.0 * index as f32 / 47.0)
        .collect::<Vec<_>>();

    let resampled = resample_audio(&frames, 48_000, 16_000).expect("resample should work");

    assert_eq!(resampled.len(), 16);
}

#[test]
fn frame_ms_helpers_are_inverse_enough_for_chunks() {
    let frames = ms_to_frames(1000, 16_000).expect("ms to frames should work");
    let duration_ms = frames_to_ms(frames, 16_000).expect("frames to ms should work");

    assert_eq!(frames, 16_000);
    assert_eq!(duration_ms, 1000);
}

#[test]
fn process_emits_timestamped_chunks_and_flushes_remainder() {
    let mut state = PreprocessState::new(CaptureSource::Mic, "mic-1", PreprocessConfig::default());

    let frames_a = vec![0.25_f32; 48_000 * 2];
    let frames_b = vec![0.25_f32; 24_000 * 2];
    let chunk_a = PcmChunk {
        source: CaptureSource::Mic,
        device_id: "mic-1".to_string(),
        sample_rate: 48_000,
        channels: 2,
        frame_count: 48_000,
        pcm: frames_a
            .chunks_exact(2)
            .flat_map(|frame| {
                frame
                    .iter()
                    .map(|sample| (*sample * 32767.0) as i16)
                    .flat_map(i16::to_le_bytes)
                    .collect::<Vec<_>>()
            })
            .collect(),
    };
    let chunk_b = PcmChunk {
        source: CaptureSource::Mic,
        device_id: "mic-1".to_string(),
        sample_rate: 48_000,
        channels: 2,
        frame_count: 24_000,
        pcm: frames_b
            .chunks_exact(2)
            .flat_map(|frame| {
                frame
                    .iter()
                    .map(|sample| (*sample * 32767.0) as i16)
                    .flat_map(i16::to_le_bytes)
                    .collect::<Vec<_>>()
            })
            .collect(),
    };

    let first_output = state.process(&chunk_a).expect("first process should work");
    let second_output = state.process(&chunk_b).expect("second process should work");
    let final_output = state
        .flush()
        .expect("flush should work")
        .expect("flush output");

    assert_eq!(first_output.len(), 1);
    assert_eq!(first_output[0].start_ms, 0);
    assert_eq!(first_output[0].end_ms, 1000);
    assert_eq!(first_output[0].sample_rate, 16_000);
    assert_eq!(first_output[0].channels, 1);

    assert_eq!(second_output.len(), 0);
    assert_eq!(final_output.start_ms, 1000);
    assert_eq!(final_output.end_ms, 1500);
    assert_eq!(final_output.frame_count, 8_000);
}

#[test]
fn vad_keeps_all_chunks_when_disabled() {
    assert!(should_keep_chunk(&[0.0; 10], &VadConfig::default()));
}

#[test]
fn vad_filters_quiet_chunks_when_enabled() {
    assert!(!should_keep_chunk(
        &[0.0; 10],
        &VadConfig {
            enabled: true,
            min_rms: 0.1,
        }
    ));
    assert!(should_keep_chunk(
        &[0.5; 10],
        &VadConfig {
            enabled: true,
            min_rms: 0.1,
        }
    ));
}
