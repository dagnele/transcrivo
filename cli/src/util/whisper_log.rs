use std::borrow::Cow;
use std::ffi::{c_char, c_void, CStr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Once;

use whisper_rs::{GGMLLogLevel, WhisperLogCallback};

static INSTALL: Once = Once::new();
static SUPPRESS_ABORT_ERRORS: AtomicBool = AtomicBool::new(false);

#[cfg(all(windows, not(target_env = "gnu")))]
type WhisperRawLogLevel = i32;

#[cfg(any(not(windows), target_env = "gnu"))]
type WhisperRawLogLevel = u32;

pub fn install_whisper_log_hook() {
    INSTALL.call_once(|| unsafe {
        let callback: WhisperLogCallback = Some(whisper_log_callback);
        whisper_rs::set_log_callback(callback, std::ptr::null_mut());
    });
}

pub fn set_suppress_abort_errors(value: bool) {
    SUPPRESS_ABORT_ERRORS.store(value, Ordering::SeqCst);
}

pub fn should_suppress(level: GGMLLogLevel, text: &str) -> bool {
    should_suppress_log(&level, text)
}

unsafe extern "C" fn whisper_log_callback(
    level: WhisperRawLogLevel,
    text: *const c_char,
    _: *mut c_void,
) {
    if text.is_null() {
        tracing::error!("whisper_log_callback: text is nullptr");
        return;
    }

    let level = GGMLLogLevel::from(level);
    let text = unsafe { CStr::from_ptr(text) }.to_string_lossy();
    log_whisper_message(level, text);
}

fn log_whisper_message(level: GGMLLogLevel, text: Cow<'_, str>) {
    let trimmed = text.trim();
    if trimmed.is_empty() || should_suppress_log(&level, trimmed) {
        return;
    }

    match level {
        GGMLLogLevel::None => tracing::trace!(target: "whisper_rs", "{trimmed}"),
        GGMLLogLevel::Info => tracing::info!(target: "whisper_rs", "{trimmed}"),
        GGMLLogLevel::Warn => tracing::warn!(target: "whisper_rs", "{trimmed}"),
        GGMLLogLevel::Error => tracing::error!(target: "whisper_rs", "{trimmed}"),
        GGMLLogLevel::Debug => tracing::debug!(target: "whisper_rs", "{trimmed}"),
        GGMLLogLevel::Cont => tracing::trace!(target: "whisper_rs", "{trimmed}"),
        GGMLLogLevel::Unknown(level) => {
            tracing::warn!(target: "whisper_rs", "whisper log level {level}: {trimmed}")
        }
    }
}

fn should_suppress_log(level: &GGMLLogLevel, text: &str) -> bool {
    matches!(level, GGMLLogLevel::Error)
        && SUPPRESS_ABORT_ERRORS.load(Ordering::SeqCst)
        && matches!(text, "whisper_full_with_state: failed to encode")
}
