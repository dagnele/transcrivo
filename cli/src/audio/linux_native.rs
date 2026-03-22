use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use tokio::sync::mpsc::UnboundedReceiver;
use tokio::sync::mpsc::UnboundedSender;

use crate::audio::capture::{CaptureConfig, CaptureError, PcmChunk};
use crate::audio::devices::{AudioBackendTarget, AudioDevice, DeviceDiscoveryError};

use crate::audio::devices::PipeWireCaptureTargetKind;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeLinuxCaptureSpec {
    pub target: crate::audio::devices::PipeWireTarget,
}

impl NativeLinuxCaptureSpec {
    pub fn pipewire(target: crate::audio::devices::PipeWireTarget) -> Self {
        Self { target }
    }
}

pub fn build_native_capture_spec(
    device: &AudioDevice,
) -> Result<NativeLinuxCaptureSpec, DeviceDiscoveryError> {
    match &device.backend_target {
        Some(AudioBackendTarget::PipeWire(target)) => {
            Ok(NativeLinuxCaptureSpec::pipewire(target.clone()))
        }
        Some(_) => Err(DeviceDiscoveryError::InvalidData(format!(
            "Device {:?} is not backed by PipeWire targeting metadata",
            device.device_id
        ))),
        None => Err(DeviceDiscoveryError::InvalidData(format!(
            "Device {:?} is missing backend targeting metadata",
            device.device_id
        ))),
    }
}

#[derive(Debug)]
pub struct NativeLinuxPipeWireRuntime {
    rx: UnboundedReceiver<Vec<u8>>,
    stop_requested: Arc<AtomicBool>,
    join_handle: Option<JoinHandle<()>>,
    pending: Vec<u8>,
}

impl NativeLinuxPipeWireRuntime {
    pub fn start(
        spec: &NativeLinuxCaptureSpec,
        config: &CaptureConfig,
    ) -> Result<Self, CaptureError> {
        start_pipewire_runtime(spec, config)
    }

    pub async fn read_chunk(&mut self, config: &CaptureConfig) -> Result<PcmChunk, CaptureError> {
        let target_size = config.bytes_per_chunk();
        while self.pending.len() < target_size {
            let Some(bytes) = self.rx.recv().await else {
                return Err(CaptureError::ReadFailed(
                    "native PipeWire capture stream ended".to_string(),
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

fn start_pipewire_runtime(
    spec: &NativeLinuxCaptureSpec,
    config: &CaptureConfig,
) -> Result<NativeLinuxPipeWireRuntime, CaptureError> {
    use std::cell::RefCell;
    use std::convert::TryFrom;
    use std::rc::Rc;
    use std::sync::mpsc;
    use std::time::Duration;

    use libspa::param::audio::{AudioFormat, AudioInfoRaw};
    use pipewire as pw;
    use pw::properties::properties;
    use pw::spa;
    use spa::param::format::{MediaSubtype, MediaType};
    use spa::param::format_utils;
    use spa::pod::Pod;

    #[derive(Clone)]
    struct UserData {
        format: Rc<RefCell<AudioInfoRaw>>,
        sender: UnboundedSender<Vec<u8>>,
    }

    fn build_format_param(config: &CaptureConfig) -> Result<Vec<u8>, CaptureError> {
        let mut audio_info = AudioInfoRaw::new();
        audio_info.set_format(AudioFormat::S16LE);
        audio_info.set_rate(config.sample_rate);
        audio_info.set_channels(u32::from(config.channels));

        let obj = pw::spa::pod::Object {
            type_: pw::spa::utils::SpaTypes::ObjectParamFormat.as_raw(),
            id: pw::spa::param::ParamType::EnumFormat.as_raw(),
            properties: audio_info.into(),
        };

        pw::spa::pod::serialize::PodSerializer::serialize(
            std::io::Cursor::new(Vec::new()),
            &pw::spa::pod::Value::Object(obj),
        )
        .map(|serialized| serialized.0.into_inner())
        .map_err(|error| CaptureError::SpawnFailed(error.to_string()))
    }

    fn run_pipewire_capture_thread(
        spec: NativeLinuxCaptureSpec,
        config: CaptureConfig,
        audio_tx: UnboundedSender<Vec<u8>>,
        stop_requested: Arc<AtomicBool>,
        startup_tx: std::sync::mpsc::Sender<Result<(), CaptureError>>,
    ) -> Result<(), CaptureError> {
        let mainloop = pw::main_loop::MainLoopRc::new(None)
            .map_err(|error| CaptureError::SpawnFailed(error.to_string()))?;
        let context = pw::context::ContextRc::new(&mainloop, None)
            .map_err(|error| CaptureError::SpawnFailed(error.to_string()))?;
        let core = context
            .connect_rc(None)
            .map_err(|error| CaptureError::SpawnFailed(error.to_string()))?;

        let mut props = properties! {
            *pw::keys::MEDIA_TYPE => "Audio",
            *pw::keys::MEDIA_CATEGORY => "Capture",
            *pw::keys::MEDIA_ROLE => "Music",
        };
        if spec.target.capture_target_kind == PipeWireCaptureTargetKind::SinkMonitor {
            props.insert("stream.capture.sink", "true");
        }
        if let Some(node_name) = &spec.target.node_name {
            props.insert("target.object", node_name.clone());
        } else if let Some(object_serial) = spec.target.object_serial {
            props.insert("target.object", object_serial.to_string());
        }

        let stream = pw::stream::StreamRc::new(core, "cheatcode-native-capture", props)
            .map_err(|error| CaptureError::SpawnFailed(error.to_string()))?;

        let negotiated_format = Rc::new(RefCell::new(AudioInfoRaw::new()));
        let listener_data = UserData {
            format: Rc::clone(&negotiated_format),
            sender: audio_tx,
        };

        let _listener = stream
            .add_local_listener_with_user_data(listener_data)
            .param_changed(|_, user_data, id, param| {
                let Some(param) = param else {
                    return;
                };
                if id != spa::param::ParamType::Format.as_raw() {
                    return;
                }

                let Ok((media_type, media_subtype)) = format_utils::parse_format(param) else {
                    return;
                };
                if media_type != MediaType::Audio || media_subtype != MediaSubtype::Raw {
                    return;
                }

                let mut format = user_data.format.borrow_mut();
                let _ = format.parse(param);
            })
            .process(|stream, user_data| {
                let Some(mut buffer) = stream.dequeue_buffer() else {
                    return;
                };
                let datas = buffer.datas_mut();
                if datas.is_empty() {
                    return;
                }

                let format = user_data.format.borrow();
                if format.format() != AudioFormat::S16LE || !format.format().is_interleaved() {
                    return;
                }

                let data = &mut datas[0];
                let size = usize::try_from(data.chunk().size()).unwrap_or(0);
                let offset = usize::try_from(data.chunk().offset()).unwrap_or(0);
                let Some(bytes) = data.data() else {
                    return;
                };
                if offset >= bytes.len() {
                    return;
                }

                let end = offset.saturating_add(size).min(bytes.len());
                if end <= offset {
                    return;
                }

                let _ = user_data.sender.send(bytes[offset..end].to_vec());
            })
            .register()
            .map_err(|error| CaptureError::SpawnFailed(error.to_string()))?;

        let timer_mainloop = mainloop.clone();
        let timer_stop_requested = Arc::clone(&stop_requested);
        let timer = mainloop.loop_().add_timer(move |_| {
            if timer_stop_requested.load(Ordering::Relaxed) {
                timer_mainloop.quit();
            }
        });
        timer
            .update_timer(
                Some(Duration::from_millis(20)),
                Some(Duration::from_millis(20)),
            )
            .into_result()
            .map_err(|error| CaptureError::SpawnFailed(error.to_string()))?;

        let format_bytes = build_format_param(&config)?;
        let mut params = [Pod::from_bytes(&format_bytes).ok_or_else(|| {
            CaptureError::SpawnFailed("failed to build PipeWire format pod".to_string())
        })?];

        stream
            .connect(
                spa::utils::Direction::Input,
                spec.target.object_id,
                pw::stream::StreamFlags::AUTOCONNECT
                    | pw::stream::StreamFlags::MAP_BUFFERS
                    | pw::stream::StreamFlags::RT_PROCESS,
                &mut params,
            )
            .map_err(|error| CaptureError::SpawnFailed(error.to_string()))?;

        let _ = startup_tx.send(Ok(()));
        mainloop.run();
        Ok(())
    }

    let (startup_tx, startup_rx) = mpsc::channel();
    let (audio_tx, audio_rx) = tokio::sync::mpsc::unbounded_channel();
    let stop_requested = Arc::new(AtomicBool::new(false));
    let stop_for_thread = Arc::clone(&stop_requested);
    let spec = spec.clone();
    let config = config.clone();

    let join_handle = std::thread::spawn(move || {
        if let Err(error) =
            run_pipewire_capture_thread(spec, config, audio_tx, stop_for_thread, startup_tx.clone())
        {
            let _ = startup_tx.send(Err(error));
        }
    });

    match startup_rx.recv() {
        Ok(Ok(())) => Ok(NativeLinuxPipeWireRuntime {
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
