use transcrivo_cli_rs::audio::capture::{CaptureSource, PcmChunk};
use transcrivo_cli_rs::audio::preprocess::{
    downmix_to_mono, frames_to_ms, ms_to_frames, normalize_audio, pcm16le_to_f32,
    prepare_pcm_chunk, resample_audio, PreprocessConfig,
};
use transcrivo_cli_rs::audio::segmenter::{AudioSegment, SegmentBoundary};

fn mono_pcm(samples: &[f32]) -> Vec<u8> {
    samples
        .iter()
        .map(|sample| ((*sample).clamp(-1.0, 1.0) * 32767.0) as i16)
        .flat_map(i16::to_le_bytes)
        .collect()
}

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
fn prepare_pcm_chunk_fast_paths_whisper_ready_audio() {
    let chunk = PcmChunk {
        source: CaptureSource::Mic,
        device_id: "mic-1".to_string(),
        sample_rate: 16_000,
        channels: 1,
        frame_count: 8_000,
        pcm: mono_pcm(&vec![0.5_f32; 8_000]),
    };

    let result = prepare_pcm_chunk(&chunk, &PreprocessConfig::default())
        .expect("prepare pcm chunk should work");

    assert_eq!(result.duration_ms, 500);
    assert_eq!(result.samples.len(), 8_000);
    assert!(result
        .samples
        .iter()
        .all(|sample| (*sample - 0.5).abs() < 0.001));
}

#[test]
fn prepare_pcm_chunk_downmixes_and_resamples() {
    let stereo_frames = vec![0.25_f32; 48_000 * 2];
    let chunk = PcmChunk {
        source: CaptureSource::Mic,
        device_id: "mic-1".to_string(),
        sample_rate: 48_000,
        channels: 2,
        frame_count: 48_000,
        pcm: stereo_frames
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

    let result = prepare_pcm_chunk(&chunk, &PreprocessConfig::default())
        .expect("prepare pcm chunk should work");

    assert_eq!(result.duration_ms, 1000);
    assert_eq!(result.samples.len(), 16_000);
}

#[test]
fn audio_segment_preserves_basic_shape() {
    let chunk = AudioSegment {
        source: transcrivo_cli_rs::session::models::Source::Mic,
        device_id: "mic-1".to_string(),
        sample_rate: 16_000,
        channels: 1,
        start_ms: 0,
        end_ms: 500,
        samples: vec![0.0, 0.5, -0.5],
        boundary: SegmentBoundary::Flush,
    };

    assert_eq!(chunk.sample_rate, 16_000);
    assert_eq!(chunk.channels, 1);
    assert_eq!(chunk.samples.len(), 3);
}
