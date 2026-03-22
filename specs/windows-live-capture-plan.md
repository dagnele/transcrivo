# Windows Live Capture Plan for `cheatcode run`

## Context

`cargo run -- devices` now works on Windows and returns stable WASAPI endpoint ids.
`cargo run -- run ...` still does not support live capture on Windows because the selected
mic and system endpoints are converted into placeholder capture workers instead of real
capture runtimes.

Today the main blocker is in `cli/src/audio/windows.rs`, where `open_source_captures(...)`
returns `AudioCaptureWorker::placeholder(...)` for both sources. That flows into
`cli/src/commands/run.rs`, where `run_live_session(...)` starts both workers and fails with
`CaptureError::NotImplemented`.

## Execution Status

- Phase 1 completed: added `cli/src/audio/windows_native.rs`, extended the generic capture worker,
  and exported the Windows runtime module.
- Phase 2 completed for a first shipping version: mic capture uses shared-mode WASAPI capture,
  system capture uses shared-mode WASAPI loopback, and packets are converted into PCM16LE bytes.
- Phase 3 completed: `cli/src/audio/windows.rs` now creates native WASAPI workers instead of
  placeholders.
- Phase 4 partially completed: pure Windows spec/selection tests were added in
  `cli/tests/audio_helpers.rs` and unit tests were added in `cli/src/audio/windows_native.rs`.
- Verification completed so far: `cargo test` passes on the current host and
  `cargo check --target x86_64-pc-windows-msvc` passes.
- Remaining work: real Windows runtime validation with hardware, README/platform-status updates,
  and any follow-up fixes from end-to-end manual testing.
- Follow-up cleanup completed: Linux and Windows native capture spec types now live in
  `cli/src/audio/linux_native.rs` and `cli/src/audio/windows_native.rs` instead of the shared
  `cli/src/audio/capture.rs` abstraction layer.

## Goal

Enable Windows live capture for the `run` command with these behaviors:

- microphone capture from a selected/default Windows capture endpoint
- system audio capture from a selected/default Windows render endpoint via WASAPI loopback
- compatibility with the existing live transcription pipeline and websocket protocol
- graceful shutdown on Ctrl+C, backend stop, or capture failure

## Non-goals

- changing the websocket/session protocol
- redesigning device discovery ids returned by `devices`
- adding new CLI flags unless required by an implementation constraint
- supporting unsupported Windows audio stacks outside WASAPI

## Current State

- `cli/src/audio/windows.rs` discovers endpoints and preserves CLI-facing ids using
  `AudioBackendTarget::Wasapi { device_id }`.
- `cli/src/audio/capture.rs` already has a cross-platform worker model, but only Linux has a
  native runtime implementation.
- `cli/src/audio/linux_native.rs` is the reference structure for a threaded native backend that
  feeds PCM chunks into the existing async pipeline.
- `cli/src/commands/run.rs` is already platform-agnostic once real `SourceCaptures` exist.

## Functional Requirements

1. `run` must open both selected sources on Windows using the same endpoint ids exposed by
   `devices`.
2. mic capture must use the selected capture endpoint.
3. system capture must use the selected render endpoint in loopback mode.
4. capture output must match `CaptureConfig` expectations: PCM16LE, chunked, with correct
   `sample_rate`, `channels`, `frame_count`, and `device_id`.
5. shutdown must stop both capture threads promptly and avoid hanging on process exit.
6. unsupported device formats or activation failures must surface as actionable capture errors.

## Proposed Design

### 1. Add a native Windows capture runtime

Introduce a Windows-native runtime parallel to the Linux one.

Suggested new file:

- `cli/src/audio/windows_native.rs`

Responsibilities:

- build a native capture spec from `AudioBackendTarget::Wasapi`
- start a dedicated capture thread per source
- initialize COM on that thread
- activate `IAudioClient` / `IAudioCaptureClient`
- use shared-mode capture for mic endpoints
- use shared-mode loopback capture for system endpoints
- read frames from the Windows audio engine, normalize them into PCM16LE, and forward byte
  buffers through a Tokio channel
- support clean stop signaling and thread join during shutdown

### 2. Extend the generic capture worker abstraction

`cli/src/audio/capture.rs` should gain a Windows-native backend variant, matching the Linux
pattern.

Expected changes:

- add a `NativeWindowsCaptureSpec`
- add a `CaptureBackendSpec::NativeWindowsWasapi(...)` variant behind `cfg(target_os = "windows")`
- add a `CaptureRuntime::NativeWindowsWasapi(...)` variant behind `cfg(target_os = "windows")`
- add an `AudioCaptureWorker::native_windows_wasapi(...)` constructor
- wire `start`, `read_chunk`, and `stop` into the Windows runtime

This keeps `cli/src/commands/run.rs` unchanged or close to unchanged.

### 3. Replace placeholder Windows workers with real workers

`cli/src/audio/windows.rs` should stop returning placeholder workers and instead create native
capture workers from the discovered backend target metadata.

Expected changes:

- add helper(s) that convert `AudioDevice` -> `NativeWindowsCaptureSpec`
- validate that the selected device has `AudioBackendTarget::Wasapi`
- return `AudioCaptureWorker::native_windows_wasapi(...)` for mic and system sources

### 4. Format handling and normalization

Windows endpoint mix formats may not already match the CLI pipeline defaults.

Implementation should:

- accept common engine formats such as PCM16 and float32
- convert capture frames into interleaved PCM16LE bytes before producing `PcmChunk`
- preserve the existing `CaptureConfig` defaults unless runtime negotiation requires the config to
  be updated explicitly
- document whether Windows capture stays fixed at `48_000 Hz / 2 channels` or whether config is
  updated from the negotiated format

Preferred approach: keep the runtime output aligned with the existing `CaptureConfig` contract so
the downstream preprocess/transcription pipeline does not need platform branches.

### 5. Error handling and observability

Add clear capture failures for:

- endpoint activation failure
- unsupported or unreadable mix format
- loopback initialization failure
- read failure after stream start

Log useful context with source role and device id, but do not change protocol semantics.

## Execution Plan

### Phase 1 - Runtime scaffolding

1. Add `cli/src/audio/windows_native.rs` with a start/read/stop runtime skeleton.
2. Extend `cli/src/audio/capture.rs` to support a Windows native backend variant.
3. Update `cli/src/audio/mod.rs` to export the new Windows runtime module.
4. Update `cli/Cargo.toml` with any additional `windows` crate feature flags required for WASAPI
   activation, audio client flags, events, or format structs.

Status: Done.

### Phase 2 - Endpoint activation and capture

1. Build a spec from `AudioBackendTarget::Wasapi` in `cli/src/audio/windows_native.rs`.
2. Implement mic capture with `IAudioClient` + `IAudioCaptureClient`.
3. Implement system capture with loopback on render endpoints.
4. Add format conversion into the `PcmChunk` byte contract expected by `cli/src/audio/capture.rs`.

Status: Done for the initial implementation. The current version uses polling rather than an
event-driven callback and normalizes common PCM16/float32 WASAPI mix formats into PCM16LE output.

### Phase 3 - Wire into source selection

1. Update `cli/src/audio/windows.rs` so `open_source_captures(...)` returns native workers.
2. Keep the existing default-device and explicit-id behavior unchanged.
3. Verify that `cli/src/commands/run.rs` can start both workers without platform-specific logic.

Status: Done.

### Phase 4 - Tests

1. Extend `cli/tests/audio_helpers.rs` with Windows-specific pure tests for:
   - spec building from `AudioBackendTarget::Wasapi`
   - source role preservation
   - default endpoint selection behavior
2. Add a new Windows-focused test file if needed, for example:
   - `cli/tests/windows_capture.rs`
3. Keep hardware-independent tests pure and deterministic.
4. If a real-device smoke test is added, gate it behind `#[ignore]` and a required env var,
   similar to the existing whisper smoke test pattern.

Status: In progress. Pure tests are in place; a real-device Windows smoke/integration test is not
yet added.

### Phase 5 - Docs and rollout

1. Update `cli/README.md` platform status once Windows `run` works.
2. Document any Windows prerequisites or known limitations.
3. Validate the end-to-end path with:
   - `cargo test`
   - `cargo run -- devices`
   - `cargo run -- run --backend-url ws://127.0.0.1:8080/ws --token test --whisper-model-name small.en`

Status: In progress. Automated compile/test validation is done; hardware-backed Windows runtime
validation and README updates remain.

## Files Expected To Change

Core implementation:

- `cli/src/audio/capture.rs`
- `cli/src/audio/windows.rs`
- `cli/src/audio/mod.rs`
- `cli/Cargo.toml`

New code likely to add:

- `cli/src/audio/windows_native.rs`
- `cli/tests/windows_capture.rs`

Tests/docs likely to update:

- `cli/tests/audio_helpers.rs`
- `cli/README.md`

Files expected to stay mostly unchanged:

- `cli/src/commands/run.rs`
- `cli/src/audio/devices.rs`

## Acceptance Criteria

- `cargo run -- devices` and `cargo run -- run ...` both work on Windows.
- `run` can capture both mic and system audio concurrently on Windows.
- explicit `--mic-device` and `--system-device` ids from `devices` still work.
- the existing live pipeline emits transcript events without Windows-specific branches in the run
  command.
- shutdown is clean and does not leave hanging capture threads.

## Risks / Notes

- WASAPI loopback and mic endpoints can expose different mix formats; conversion code must be
  robust.
- some Bluetooth or virtual devices may negotiate surprising channel counts or sample formats.
- event-driven capture may require extra Windows feature flags or synchronization primitives in
  `cli/Cargo.toml`.
- if endpoint timing proves fragile, a polling-based first version is acceptable as long as the
  chunk contract and shutdown behavior stay correct.

## Implementation Notes From Current Pass

- The current implementation keeps the downstream `run` pipeline unchanged by always emitting
  `PcmChunk` values aligned to the existing `CaptureConfig` contract.
- The first version uses a polling capture loop (`GetNextPacketSize` / `GetBuffer`) instead of an
  event-callback path, which keeps the runtime simpler and matches the accepted fallback in this
  plan.
- Silent WASAPI packets are converted through the same resampling/output-shaping path so chunk
  sizes stay aligned with the configured target format.
- Manual validation on an actual Windows host is still required before considering the feature
  production-ready.
