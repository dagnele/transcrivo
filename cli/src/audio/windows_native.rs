use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use tokio::sync::mpsc::UnboundedReceiver;

use crate::audio::capture::{CaptureConfig, CaptureError, PcmChunk};
use crate::audio::devices::{AudioBackendTarget, AudioDevice, DeviceDiscoveryError, DeviceKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeWindowsCaptureSpec {
    pub device_id: String,
    pub loopback: bool,
}

impl NativeWindowsCaptureSpec {
    pub fn wasapi(device_id: impl Into<String>, loopback: bool) -> Self {
        Self {
            device_id: device_id.into(),
            loopback,
        }
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use super::*;
    use std::ffi::c_void;

    use tokio::sync::mpsc::unbounded_channel;
    use tokio::sync::mpsc::UnboundedSender;
    use windows::core::PCWSTR;
    use windows::Win32::Media::Audio::{
        IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
        AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_E_DEVICE_INVALIDATED, AUDCLNT_E_SERVICE_NOT_RUNNING,
        AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_MULTITHREADED,
    };

    const REFTIMES_PER_MILLISECOND: i64 = 10_000;
    const BUFFER_DURATION_MS: i64 = 200;
    const CAPTURE_POLL_MS: u64 = 10;

    #[derive(Debug)]
    pub struct NativeWindowsWasapiRuntime {
        rx: UnboundedReceiver<Vec<u8>>,
        stop_requested: Arc<AtomicBool>,
        join_handle: Option<JoinHandle<()>>,
        pending: Vec<u8>,
    }

    impl NativeWindowsWasapiRuntime {
        pub fn start(
            spec: &NativeWindowsCaptureSpec,
            config: &CaptureConfig,
        ) -> Result<Self, CaptureError> {
            let (startup_tx, startup_rx) = std::sync::mpsc::channel();
            let (audio_tx, audio_rx) = unbounded_channel();
            let stop_requested = Arc::new(AtomicBool::new(false));
            let stop_for_thread = Arc::clone(&stop_requested);
            let spec = spec.clone();
            let config = config.clone();

            let join_handle = std::thread::spawn(move || {
                if let Err(error) =
                    run_capture_thread(spec, config, audio_tx, stop_for_thread, startup_tx.clone())
                {
                    let _ = startup_tx.send(Err(error));
                }
            });

            match startup_rx.recv() {
                Ok(Ok(())) => Ok(Self {
                    rx: audio_rx,
                    stop_requested,
                    join_handle: Some(join_handle),
                    pending: Vec::new(),
                }),
                Ok(Err(error)) => {
                    let _ = join_handle.join();
                    Err(error)
                }
                Err(error) => {
                    let _ = join_handle.join();
                    Err(CaptureError::SpawnFailed(error.to_string()))
                }
            }
        }

        pub async fn read_chunk(
            &mut self,
            config: &CaptureConfig,
        ) -> Result<PcmChunk, CaptureError> {
            let target_size = config.bytes_per_chunk();
            while self.pending.len() < target_size {
                let Some(bytes) = self.rx.recv().await else {
                    return Err(CaptureError::ReadFailed(
                        "native WASAPI capture stream ended".to_string(),
                    ));
                };
                self.pending.extend_from_slice(&bytes);
            }

            let pcm = self.pending.drain(..target_size).collect();
            Ok(PcmChunk {
                source: config.source,
                device_id: config.device_id.clone(),
                sample_rate: config.sample_rate,
                channels: config.channels,
                frame_count: config.frames_per_chunk,
                pcm,
            })
        }

        pub async fn stop(&mut self) {
            self.stop_requested.store(true, Ordering::Relaxed);
            if let Some(join_handle) = self.join_handle.take() {
                let _ = join_handle.join();
            }
            self.pending.clear();
        }
    }

    pub fn build_native_capture_spec(
        device: &AudioDevice,
    ) -> Result<NativeWindowsCaptureSpec, DeviceDiscoveryError> {
        match &device.backend_target {
            Some(AudioBackendTarget::Wasapi { device_id }) => Ok(NativeWindowsCaptureSpec::wasapi(
                device_id.clone(),
                device.kind == DeviceKind::System,
            )),
            Some(_) => Err(DeviceDiscoveryError::InvalidData(format!(
                "Device {:?} is not backed by WASAPI targeting metadata",
                device.device_id
            ))),
            None => Err(DeviceDiscoveryError::InvalidData(format!(
                "Device {:?} is missing backend targeting metadata",
                device.device_id
            ))),
        }
    }

    fn run_capture_thread(
        spec: NativeWindowsCaptureSpec,
        config: CaptureConfig,
        audio_tx: UnboundedSender<Vec<u8>>,
        stop_requested: Arc<AtomicBool>,
        startup_tx: std::sync::mpsc::Sender<Result<(), CaptureError>>,
    ) -> Result<(), CaptureError> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED)
                .ok()
                .map_err(|error| CaptureError::SpawnFailed(error.to_string()))?;
        }

        let result = run_capture_thread_inner(spec, config, audio_tx, stop_requested, startup_tx);

        unsafe {
            CoUninitialize();
        }

        result
    }

    fn run_capture_thread_inner(
        spec: NativeWindowsCaptureSpec,
        config: CaptureConfig,
        audio_tx: UnboundedSender<Vec<u8>>,
        stop_requested: Arc<AtomicBool>,
        startup_tx: std::sync::mpsc::Sender<Result<(), CaptureError>>,
    ) -> Result<(), CaptureError> {
        let enumerator: IMMDeviceEnumerator = unsafe {
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|error| CaptureError::SpawnFailed(error.to_string()))?
        };
        let endpoint_id = to_utf16_null(&spec.device_id);
        let device = unsafe {
            enumerator
                .GetDevice(PCWSTR::from_raw(endpoint_id.as_ptr()))
                .map_err(|error| CaptureError::SpawnFailed(error.to_string()))?
        };

        let audio_client: IAudioClient = unsafe {
            device
                .Activate(CLSCTX_ALL, None)
                .map_err(|error| CaptureError::SpawnFailed(error.to_string()))?
        };

        let mix_format = unsafe {
            audio_client
                .GetMixFormat()
                .map_err(|error| CaptureError::SpawnFailed(error.to_string()))?
        };

        let format_info =
            unsafe { read_wave_format(mix_format) }.map_err(CaptureError::SpawnFailed)?;

        let stream_flags = if spec.loopback {
            AUDCLNT_STREAMFLAGS_LOOPBACK
        } else {
            0
        };
        let hns_buffer_duration = BUFFER_DURATION_MS * REFTIMES_PER_MILLISECOND;

        unsafe {
            audio_client
                .Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    stream_flags,
                    hns_buffer_duration,
                    0,
                    mix_format,
                    None,
                )
                .map_err(|error| CaptureError::SpawnFailed(error.to_string()))?;
        }

        let capture_client: IAudioCaptureClient = unsafe {
            audio_client
                .GetService()
                .map_err(|error| CaptureError::SpawnFailed(error.to_string()))?
        };

        unsafe {
            audio_client
                .Start()
                .map_err(|error| CaptureError::SpawnFailed(error.to_string()))?;
        }

        let _ = startup_tx.send(Ok(()));

        let run_result = capture_loop(
            &audio_client,
            &capture_client,
            &config,
            &format_info,
            audio_tx,
            stop_requested,
        );

        unsafe {
            let _ = audio_client.Stop();
            CoTaskMemFree(Some(mix_format.cast::<c_void>()));
        }

        run_result
    }

    fn capture_loop(
        audio_client: &IAudioClient,
        capture_client: &IAudioCaptureClient,
        config: &CaptureConfig,
        format_info: &WaveFormatInfo,
        audio_tx: UnboundedSender<Vec<u8>>,
        stop_requested: Arc<AtomicBool>,
    ) -> Result<(), CaptureError> {
        let mut pending_output = Vec::new();

        while !stop_requested.load(Ordering::Relaxed) {
            let packet_size = unsafe { capture_client.GetNextPacketSize() }
                .map_err(|error| map_capture_error("failed to query next WASAPI packet", error))?;

            if packet_size == 0 {
                std::thread::sleep(Duration::from_millis(CAPTURE_POLL_MS));
                continue;
            }

            let mut data_ptr = std::ptr::null_mut();
            let mut frames_available = 0;
            let mut flags = 0;
            unsafe {
                capture_client
                    .GetBuffer(&mut data_ptr, &mut frames_available, &mut flags, None, None)
                    .map_err(|error| map_capture_error("failed to read WASAPI buffer", error))?;
            }

            let packet = if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 {
                build_silent_packet(
                    frames_available,
                    format_info,
                    config.sample_rate,
                    config.channels,
                )?
            } else {
                unsafe {
                    convert_packet_to_pcm16(
                        data_ptr,
                        frames_available,
                        format_info,
                        config.sample_rate,
                        config.channels,
                    )?
                }
            };

            unsafe {
                capture_client
                    .ReleaseBuffer(frames_available)
                    .map_err(|error| map_capture_error("failed to release WASAPI buffer", error))?;
            }

            pending_output.extend_from_slice(&packet);

            while pending_output.len() >= config.bytes_per_chunk() {
                let bytes = pending_output
                    .drain(..config.bytes_per_chunk())
                    .collect::<Vec<_>>();
                if audio_tx.send(bytes).is_err() {
                    return Ok(());
                }
            }
        }

        unsafe {
            let _ = audio_client.Reset();
        }
        Ok(())
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct WaveFormatInfo {
        sample_rate: u32,
        channels: u16,
        bits_per_sample: u16,
        block_align: u16,
        sample_format: SampleFormat,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum SampleFormat {
        Pcm16,
        Float32,
    }

    unsafe fn read_wave_format(format_ptr: *mut WAVEFORMATEX) -> Result<WaveFormatInfo, String> {
        if format_ptr.is_null() {
            return Err("WASAPI mix format was null".to_string());
        }

        let format = &*format_ptr;
        let w_format_tag = format.wFormatTag;
        let channels = format.nChannels;
        let sample_rate = format.nSamplesPerSec;
        let bits_per_sample = format.wBitsPerSample;
        let block_align = format.nBlockAlign;

        if channels == 0 || sample_rate == 0 || block_align == 0 {
            return Err("WASAPI mix format is invalid".to_string());
        }

        let sample_format = if u32::from(w_format_tag)
            == windows::Win32::Media::Audio::WAVE_FORMAT_PCM
        {
            if bits_per_sample != 16 {
                return Err(format!(
                    "unsupported PCM bits per sample: {bits_per_sample}; expected 16"
                ));
            }
            SampleFormat::Pcm16
        } else if u32::from(w_format_tag) == 3 {
            if bits_per_sample != 32 {
                return Err(format!(
                    "unsupported float bits per sample: {bits_per_sample}; expected 32"
                ));
            }
            SampleFormat::Float32
        } else if u32::from(w_format_tag) == 0xfffe {
            let extensible = std::ptr::read_unaligned(format_ptr as *const WAVEFORMATEXTENSIBLE);
            let sub_format = extensible.SubFormat;
            if sub_format == windows::core::GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71)
            {
                if bits_per_sample != 16 {
                    return Err(format!(
                        "unsupported extensible PCM bits per sample: {bits_per_sample}; expected 16"
                    ));
                }
                SampleFormat::Pcm16
            } else if sub_format
                == windows::core::GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71)
            {
                if bits_per_sample != 32 {
                    return Err(format!(
                        "unsupported extensible float bits per sample: {bits_per_sample}; expected 32"
                    ));
                }
                SampleFormat::Float32
            } else {
                return Err("unsupported extensible WASAPI mix format subtype".to_string());
            }
        } else {
            return Err(format!("unsupported WASAPI mix format tag: {w_format_tag}"));
        };

        Ok(WaveFormatInfo {
            sample_rate,
            channels,
            bits_per_sample,
            block_align,
            sample_format,
        })
    }

    unsafe fn convert_packet_to_pcm16(
        data_ptr: *mut u8,
        frames_available: u32,
        format_info: &WaveFormatInfo,
        target_sample_rate: u32,
        target_channels: u16,
    ) -> Result<Vec<u8>, CaptureError> {
        let input_bytes = frames_available as usize * usize::from(format_info.block_align);
        let input = std::slice::from_raw_parts(data_ptr, input_bytes);

        let frames = match format_info.sample_format {
            SampleFormat::Pcm16 => decode_pcm16_frames(input, format_info.channels),
            SampleFormat::Float32 => decode_f32_frames(input, format_info.channels),
        }?;

        let remapped = remap_channels(&frames, target_channels);
        let mono_for_resample = if target_channels == 1 {
            crate::audio::preprocess::downmix_to_mono(&remapped)
        } else {
            interleaved_to_mono(&remapped)
        };
        let resampled = crate::audio::preprocess::resample_audio(
            &mono_for_resample,
            format_info.sample_rate,
            target_sample_rate,
        )
        .map_err(|error| CaptureError::ReadFailed(error.to_string()))?;
        let output_frames = mono_to_frames(&resampled, target_channels);

        crate::audio::capture::pcm16le_from_f32_frames(&output_frames, target_channels)
            .map_err(|error| CaptureError::ReadFailed(error.to_string()))
    }

    fn build_silent_packet(
        frames_available: u32,
        format_info: &WaveFormatInfo,
        target_sample_rate: u32,
        target_channels: u16,
    ) -> Result<Vec<u8>, CaptureError> {
        let silent = vec![0.0; frames_available as usize];
        let resampled = crate::audio::preprocess::resample_audio(
            &silent,
            format_info.sample_rate,
            target_sample_rate,
        )
        .map_err(|error| CaptureError::ReadFailed(error.to_string()))?;
        let output_frames = mono_to_frames(&resampled, target_channels);

        crate::audio::capture::pcm16le_from_f32_frames(&output_frames, target_channels)
            .map_err(|error| CaptureError::ReadFailed(error.to_string()))
    }

    fn decode_pcm16_frames(input: &[u8], channels: u16) -> Result<Vec<Vec<f32>>, CaptureError> {
        if !input.len().is_multiple_of(2) {
            return Err(CaptureError::ReadFailed(
                "WASAPI PCM16 packet had odd byte length".to_string(),
            ));
        }

        let samples: Vec<f32> = input
            .chunks_exact(2)
            .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / 32767.0)
            .collect();
        samples_to_frames(samples, channels)
    }

    fn decode_f32_frames(input: &[u8], channels: u16) -> Result<Vec<Vec<f32>>, CaptureError> {
        if !input.len().is_multiple_of(4) {
            return Err(CaptureError::ReadFailed(
                "WASAPI float packet had invalid byte length".to_string(),
            ));
        }

        let samples: Vec<f32> = input
            .chunks_exact(4)
            .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            .collect();
        samples_to_frames(samples, channels)
    }

    fn samples_to_frames(samples: Vec<f32>, channels: u16) -> Result<Vec<Vec<f32>>, CaptureError> {
        let channels_usize = usize::from(channels);
        if channels_usize == 0 || !samples.len().is_multiple_of(channels_usize) {
            return Err(CaptureError::ReadFailed(
                "WASAPI packet did not align to channel count".to_string(),
            ));
        }

        Ok(samples
            .chunks_exact(channels_usize)
            .map(|frame| frame.to_vec())
            .collect())
    }

    fn remap_channels(frames: &[Vec<f32>], target_channels: u16) -> Vec<Vec<f32>> {
        frames
            .iter()
            .map(|frame| match target_channels {
                0 => Vec::new(),
                1 => vec![if frame.is_empty() {
                    0.0
                } else {
                    frame.iter().sum::<f32>() / frame.len() as f32
                }],
                channels if frame.len() == usize::from(channels) => frame.clone(),
                channels if frame.len() == 1 => vec![frame[0]; usize::from(channels)],
                channels => {
                    let mono = if frame.is_empty() {
                        0.0
                    } else {
                        frame.iter().sum::<f32>() / frame.len() as f32
                    };
                    vec![mono; usize::from(channels)]
                }
            })
            .collect()
    }

    fn interleaved_to_mono(frames: &[Vec<f32>]) -> Vec<f32> {
        frames
            .iter()
            .map(|frame| {
                if frame.is_empty() {
                    0.0
                } else {
                    frame.iter().sum::<f32>() / frame.len() as f32
                }
            })
            .collect()
    }

    fn mono_to_frames(samples: &[f32], channels: u16) -> Vec<Vec<f32>> {
        samples
            .iter()
            .map(|sample| vec![*sample; usize::from(channels)])
            .collect()
    }

    fn map_capture_error(context: &str, error: windows::core::Error) -> CaptureError {
        if error.code() == AUDCLNT_E_DEVICE_INVALIDATED
            || error.code() == AUDCLNT_E_SERVICE_NOT_RUNNING
        {
            CaptureError::ReadFailed(format!("{context}: {}", error.message()))
        } else {
            CaptureError::ReadFailed(format!("{context}: {error}"))
        }
    }

    fn to_utf16_null(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::audio::devices::AudioBackendTarget;

        #[test]
        fn build_native_capture_spec_uses_loopback_for_system_devices() {
            let device = AudioDevice {
                device_id: "render-1".to_string(),
                name: "Speakers".to_string(),
                kind: DeviceKind::System,
                is_default: true,
                backend: Some("wasapi".to_string()),
                backend_target: Some(AudioBackendTarget::Wasapi {
                    device_id: "render-1".to_string(),
                }),
                state: Some("active".to_string()),
            };

            let spec = build_native_capture_spec(&device).expect("native spec should build");

            assert_eq!(spec.device_id, "render-1");
            assert!(spec.loopback);
        }

        #[test]
        fn build_native_capture_spec_disables_loopback_for_mics() {
            let device = AudioDevice {
                device_id: "mic-1".to_string(),
                name: "Mic".to_string(),
                kind: DeviceKind::Mic,
                is_default: true,
                backend: Some("wasapi".to_string()),
                backend_target: Some(AudioBackendTarget::Wasapi {
                    device_id: "mic-1".to_string(),
                }),
                state: Some("active".to_string()),
            };

            let spec = build_native_capture_spec(&device).expect("native spec should build");

            assert_eq!(spec.device_id, "mic-1");
            assert!(!spec.loopback);
        }

        #[test]
        fn remap_channels_downmixes_to_mono() {
            let frames = vec![vec![0.5, -0.5], vec![1.0, 0.0]];
            let remapped = remap_channels(&frames, 1);

            assert_eq!(remapped, vec![vec![0.0], vec![0.5]]);
        }

        #[test]
        fn mono_to_frames_replicates_channels() {
            let frames = mono_to_frames(&[0.25, -0.25], 2);

            assert_eq!(frames, vec![vec![0.25, 0.25], vec![-0.25, -0.25]]);
        }

        #[test]
        fn silent_packet_resamples_to_target_shape() {
            let format_info = WaveFormatInfo {
                sample_rate: 44_100,
                channels: 2,
                bits_per_sample: 16,
                block_align: 4,
                sample_format: SampleFormat::Pcm16,
            };

            let packet = build_silent_packet(4_410, &format_info, 48_000, 2)
                .expect("silent packet should build");

            assert_eq!(packet.len(), 19_200);
            assert!(packet.iter().all(|byte| *byte == 0));
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::*;
