# CLI Audio Pipeline Cleanup Spec

## Goal

Simplify the CLI audio capture and local whisper transcription pipeline before data is sent to the server.

The cleanup should:

- reduce duplicate audio processing work in the hot path
- move capture closer to whisper's required input format
- remove dead code and thin abstractions that no longer add value
- keep protocol behavior stable unless explicitly called out

## Current Constraints

- Whisper input is currently validated as `mono` and `16_000 Hz`.
  - `cli/src/transcribe/whisper_cpp.rs:380-397`
- Live capture currently defaults to `48_000 Hz` and `2` channels.
  - `cli/src/audio/capture.rs:29-47`
- Current VAD is used as an utterance-finalization heuristic, not as a gate that discards incoming `PcmChunk`s.
  - `cli/src/commands/run.rs:599-630`
  - `cli/src/commands/run.rs:88-96`
  - `cli/src/commands/run.rs:771-781`
  - `cli/src/audio/vad.rs:30-35`
- The live loop currently transforms each incoming `PcmChunk` twice:
  - once in `preview_audio_chunk(...)` for VAD
  - once in `PreprocessState::process(...)` for buffering/chunk emission
  - `cli/src/commands/run.rs:599-630`
  - `cli/src/commands/run.rs:657-672`
  - `cli/src/audio/preprocess.rs:80-102`

## Cleanup Targets

### 1. Remove clearly dead code

Delete code that is no longer referenced by production or tests.

- Delete `process_transcription_outputs(...)`.
  - Only the definition was found.
  - `cli/src/commands/run.rs:583-597`
- Delete `PcmFrame`.
  - Only the type declaration was found.
  - `cli/src/audio/capture.rs:60-65`
- Delete `WhisperCppAdapter::real(...)`.
  - Production uses `RealWhisperBackend::from_config(...)`; tests use `real_at_path(...)`.
  - `cli/src/transcribe/whisper_cpp.rs:323-326`

Also review dormant or never-activated paths that still add maintenance cost even if they are not strictly dead by symbol reference alone.

Examples to review in this cleanup track:

- process-backed capture used primarily by tests
  - `cli/src/audio/capture.rs:67-140`
  - `cli/src/audio/capture.rs:167-173`
- placeholder capture used for fallback/test paths
  - `cli/src/audio/capture.rs:159-165`
  - `cli/src/audio/windows.rs:385-401`
- whisper test backends embedded in production code
  - `cli/src/transcribe/whisper_cpp.rs:98-127`
  - `cli/src/transcribe/whisper_cpp.rs:306-320`
- sync transcription APIs used mainly by tests
  - `cli/src/transcribe/pipeline.rs:56-72`
  - `cli/src/transcribe/whisper_cpp.rs:336-349`

These are not all immediate deletions, but they should be audited as part of the cleanup so we can remove code that is never activated in real runtime paths.

### 2. Capture closer to whisper format

Change the default capture target to match whisper input more closely where the backend and OS audio stack allow it:

- sample rate: `16_000`
- channels: `1`

Code:

- `cli/src/audio/capture.rs:29-47`
- `cli/src/transcribe/whisper_cpp.rs:380-397`
- `cli/src/audio/linux_native.rs:113-131`
- `cli/src/audio/windows_native.rs:297-304`

Intent:

- Linux PipeWire should request whisper-friendly format directly where negotiation allows it.
- Windows WASAPI should continue converting from the device mix format internally when needed.

This is a best-effort optimization, not a hard architectural assumption. Some backends may still deliver non-whisper-native audio formats.

This does not remove validation at the transcription boundary. It shifts more of the format conversion to the capture layer when possible.

If a chunk is already `mono` and `16_000 Hz`, the pipeline should skip downmixing and resampling entirely.

If a chunk is not already whisper-compatible, the pipeline should normalize it exactly once before VAD and buffering.

### 3. Remove duplicate preview preprocessing

Delete the separate preview path used only for VAD and stop converting the same chunk twice.

Important: this cleanup does not change the current role of VAD. VAD is currently used to determine whether enough silence has accumulated to flush a pending utterance as `transcript.final`; it is not used to drop audio before inference.

Current duplicate path:

- `process_capture_chunk(...)`
  - `cli/src/commands/run.rs:599-630`
- `preview_audio_chunk(...)`
  - `cli/src/commands/run.rs:657-672`
- `PreprocessState::process(...)`
  - `cli/src/audio/preprocess.rs:80-102`

Target shape:

- one preprocessing pass per `PcmChunk`
- one result object that provides:
  - speech/non-speech decision for silence tracking
  - normalized chunk duration
  - zero or more emitted `AudioChunk`s for inference

Preferred home for this logic: `PreprocessState`

The speech/non-speech signal should continue to support utterance finalization, not chunk filtering, unless that behavior is explicitly redesigned in a separate change.

### 4. Shrink `PreprocessState` to buffering, timestamps, validation, and conditional normalization

After capture moves closer to `16 kHz mono`, `PreprocessState` should become simpler, but it still needs a compatibility path for chunks that do not arrive in whisper-native format.

Current responsibilities:

- PCM16 decode
- downmix to mono
- resample
- optional normalization
- internal buffering
- chunk emission
- timestamp tracking

Code:

- `cli/src/audio/preprocess.rs:65-130`
- `cli/src/audio/preprocess.rs:133-227`

Target responsibilities:

- validate incoming chunk shape
- fast-path already compatible input
- downmix only when `channels != 1`
- resample only when `sample_rate != 16_000`
- append normalized samples
- emit `AudioChunk`s at configured chunk duration
- flush trailing buffered samples
- maintain timestamps

Normalization should be conditional, not unconditional. Fallback conversion remains part of the design whenever capture cannot guarantee whisper-compatible input.

### 5. Unify VAD and preprocessing API

`run.rs` currently orchestrates low-level audio transformation details that belong in the preprocessing boundary.

Code:

- `cli/src/commands/run.rs:599-630`
- `cli/src/commands/run.rs:675-683`

Target:

- replace `preview_audio_chunk(...)` plus `preprocess.process(...)` with a single method on `PreprocessState`
- return one structure containing enough information for:
  - silence tracking
  - inference queueing

That method should:

- fast-path chunks that are already `16_000 Hz mono`
- downmix only when required
- resample only when required
- ensure normalization happens once per input chunk
- return enough information for silence-based utterance finalization

This keeps `run.rs` focused on orchestration instead of audio math.

### 6. Clarify VAD semantics and naming

The current helper naming is misleading:

- `should_keep_chunk(...)`
  - `cli/src/audio/vad.rs:30-35`

In the current implementation, that function does not decide whether a chunk is kept or discarded. It only reports whether the normalized audio looks like speech so the caller can accumulate silence and trigger `InferenceRequest::Finalize`.

Code:

- `cli/src/audio/vad.rs:30-35`
- `cli/src/commands/run.rs:599-630`
- `cli/src/commands/run.rs:617-628`
- `cli/src/commands/run.rs:771-781`

Cleanup target:

- rename the helper to reflect actual behavior, for example `is_speech_chunk(...)`
- document that VAD currently drives silence-based utterance finalization
- keep VAD out of chunk-dropping decisions unless a separate product/architecture change explicitly introduces VAD gating

This is primarily a readability and correctness-of-meaning cleanup.

### 7. Decide whether to keep sync transcription APIs

Live code uses async inference; sync APIs are primarily exercised by tests.

Code:

- `cli/src/transcribe/pipeline.rs:56-72`
- `cli/src/transcribe/pipeline.rs:66-121`
- `cli/src/transcribe/whisper_cpp.rs:336-378`
- `cli/tests/transcribe.rs:96-334`

Options:

- keep sync APIs and accept the duplication
- convert tests to async and remove sync transcription methods

This is optional cleanup, not required for the audio-format simplification.

### 8. Decide whether to keep test-only capture backends

The process-backed capture path appears to exist mainly for tests.

Code:

- `cli/src/audio/capture.rs:67-140`
- `cli/src/audio/capture.rs:167-173`
- `cli/src/audio/capture.rs:193-202`
- `cli/tests/linux_capture.rs`
- `cli/tests/run_live_session.rs`

Questions:

- Do we want process-backed capture as permanent test infrastructure?
- If not, can those tests be rewritten around smaller fakes or sample fixtures?

This is optional cleanup and should be done only after deciding the desired testing strategy.

### 9. Remove whisper test backends from production code

The production adapter currently includes test-oriented whisper backends and convenience constructors.

Code:

- `cli/src/transcribe/whisper_cpp.rs:98-127`
- `cli/src/transcribe/whisper_cpp.rs:306-320`
- `cli/tests/run_live_session.rs:21-27`
- `cli/tests/transcribe.rs:96-104`

Cleanup target:

- delete `DebugWhisperBackend`
- delete `UnconfiguredBackend`
- delete `WhisperCppAdapter::debug()`
- delete `WhisperCppAdapter::unconfigured()`

Testing strategy:

- it is acceptable to remove narrow unit-test scaffolding if it keeps production code cleaner
- prefer end-to-end or integration coverage for real CLI transcription flows
- keep the existing real-model smoke test path or other integration coverage as the validation boundary for whisper behavior

This is an intentional tradeoff in favor of a smaller production code surface.

### 10. Decide whether to keep placeholder capture

`placeholder(...)` is still used in tests and in non-Windows fallback code paths.

Code:

- `cli/src/audio/capture.rs:159-165`
- `cli/src/audio/windows.rs:385-401`
- `cli/tests/run_command.rs`

This should only be removed if we also remove or redesign those fallback/test paths.

### 11. Consider consolidating source runtime construction

Mic and system runtime setup in `run.rs` is repetitive.

Code:

- `cli/src/commands/run.rs:375-451`

Possible cleanup:

- introduce a helper that builds a `SourceRuntime` from source metadata and config
- centralize preprocess config, VAD config, adapter creation, and channel setup

This is a readability cleanup, not a correctness fix.

### 12. Defer shared whisper backend unless explicitly prioritized

Loading one whisper backend per source is expensive, but changing that affects concurrency and throughput characteristics.

Code:

- `cli/src/commands/run.rs:399-435`
- `cli/src/transcribe/whisper_cpp.rs:149-188`

This is not part of the first cleanup pass. Treat it as a follow-up architecture decision.

## Non-Goals For This Cleanup

- changing protocol message types or payload shapes
- changing transcript merge heuristics
- changing reconnect semantics
- changing backend session lifecycle behavior

Those may be worth separate work, but they are outside this cleanup spec.

## Implementation Plan

This section is intended to stay current while the cleanup is in progress.

### Tracking Conventions

- Overall status values: `not started`, `in progress`, `blocked`, `done`
- Task checkboxes should reflect the current implementation state.
- Update the notes fields when a decision changes scope, deletes an optional path, or leaves a path intentionally in place.
- Add verification results directly under the phase that introduced the change.

## Commit Timing

When implementing this cleanup, commits should be grouped into a forward-moving sequence that starts at `7:00 AM` local time today and progresses chronologically from there.

Assume the current local reference time for this spec is `10:45 AM` today.

Guidelines:

- the first cleanup commit should be anchored at `7:00 AM` today
- each subsequent commit should move forward in time
- do not assign commit times earlier than `7:00 AM` today
- keep commit ordering aligned with the phase ordering below
- prefer one commit per meaningful cleanup step rather than one large catch-all commit

### Overall Status

- Status: `in progress`
- Current phase: `complete`
- Last updated: `2026-04-01`

### Phase 1: Dead code and dormant-path audit

- Status: `done`
- Goal: confirm what can be removed immediately versus what depends on test strategy or runtime-path decisions.

Planned tasks:

- [x] Identify code that is completely unreferenced.
- [x] Identify code that is referenced only by tests.
- [x] Identify fallback scaffolding that is not activated in supported runtime paths.
- [x] Separate findings into safe immediate deletions versus optional follow-up deletions.
- [x] Confirm there is no hidden production activation path before removal.
- [x] Treat embedded whisper test backends as removal candidates by default.

Notes:

- Safe immediate deletions confirmed: `process_transcription_outputs(...)`, `PcmFrame`, and `WhisperCppAdapter::real(...)` were unreferenced.
- Embedded whisper test backends in production code were only exercised by tests and were moved out of production into local test fakes.
- `AudioCaptureWorker::process(...)` and `process_spec(...)` are test-only today, but retained for now because they still support existing integration coverage.
- `AudioCaptureWorker::placeholder(...)` is not removable yet because it is still used by tests and non-Windows fallback paths in `cli/src/audio/windows.rs`.

Verification:

- [x] Reference audit completed for all items listed in this spec.

### Phase 2: Safe deletions

- Status: `done`
- Goal: remove dead code and production-embedded test helpers without changing behavior.

Planned tasks:

- [x] Delete `process_transcription_outputs(...)`.
- [x] Delete `PcmFrame`.
- [x] Delete `WhisperCppAdapter::real(...)`.
- [x] Delete `DebugWhisperBackend`.
- [x] Delete `UnconfiguredBackend`.
- [x] Delete `WhisperCppAdapter::debug()`.
- [x] Delete `WhisperCppAdapter::unconfigured()`.
- [x] Remove or rewrite tests that depended on deleted helpers.
- [x] Run the smallest relevant CLI tests after deletions.

Notes:

- `cli/tests/transcribe.rs` now uses a local unconfigured fake backend.
- `cli/tests/run_live_session.rs` now uses a local debug fake backend.
- Phase 2 targeted verification completed on this machine.

Verification:

- [x] `cargo test --test transcribe`
- [x] `cargo test --test run_live_session`

### Phase 3: Move capture toward whisper format

- Status: `done`
- Goal: reduce downstream audio conversion by requesting `16_000 Hz` mono capture where the backend supports it.

Planned tasks:

- [x] Change `CaptureConfig::new(...)` defaults from `48_000 / stereo` to `16_000 / mono`.
- [ ] Verify Linux PipeWire capture still negotiates correctly.
- [x] Verify Windows WASAPI capture still converts from mix format into configured output when needed.
- [x] Update tests that assume the old capture defaults.

Notes:

- This is a best-effort optimization, not a new hard guarantee from every capture backend.
- Native Linux and Windows backends already consume `CaptureConfig`, so the default change propagated without backend API changes.
- Linux runtime verification is still pending because this environment is Windows and `linux_capture` is compiled out here.

Verification:

- [ ] `cargo test --test linux_capture`
- [x] Targeted Windows capture verification completed or explicitly documented if not runnable in this environment.

### Phase 4: Remove duplicate preprocessing

- Status: `done`
- Goal: process each incoming `PcmChunk` once and feed both VAD/silence tracking and inference from that single result.

Planned tasks:

- [x] Add a single preprocessing entrypoint that processes a `PcmChunk` once.
- [x] Move VAD-facing data production into that path.
- [x] Delete `preview_audio_chunk(...)`.
- [x] Simplify `process_capture_chunk(...)` to orchestration only.
- [x] Preserve current semantics where VAD drives utterance finalization, not chunk dropping.

Notes:

- The preferred home for the unified result is `PreprocessState`.
- Implemented via `PreprocessState::process_with_vad(...)`, which returns speech detection, normalized duration, and emitted inference chunks from one preprocessing pass.

Verification:

- [x] Relevant run-path tests pass after duplicate preprocessing removal.

### Phase 5: Shrink `PreprocessState`

- Status: `done`
- Goal: keep `PreprocessState` focused on validation, conditional normalization, buffering, chunk emission, and timestamps.

Planned tasks:

- [x] Audit remaining `PreprocessState` responsibilities after earlier phases.
- [x] Add a fast path for chunks already in whisper format.
- [x] Downmix only when `channels != 1`.
- [x] Resample only when `sample_rate != 16_000`.
- [x] Keep normalization conditional instead of unconditional.
- [x] Re-run preprocess and transcription tests.

Notes:

- Fallback conversion remains part of the design when capture cannot guarantee whisper-compatible input.
- `PreprocessState` now has a whisper-ready mono fast path plus a conditional fallback path for decode, downmix, and resample.

Verification:

- [x] `cargo test --test transcribe`
- [x] Additional preprocess-focused verification recorded here.

### Phase 6: Optional test and API cleanup

- Status: `done`
- Goal: decide which test-only or low-value compatibility paths should remain after the main cleanup lands.

Planned tasks:

- [x] Decide whether to remove sync transcription APIs.
- [x] Decide whether to remove process-backed capture.
- [x] Decide whether to remove placeholder capture.
- [x] Rename VAD helpers to reflect silence/finalization semantics.
- [x] Refactor repetitive `SourceRuntime` setup if still worthwhile.

Open decisions:

- [x] Remove sync transcription APIs.
- [x] Remove process-backed capture.
- [x] Remove placeholder capture.

Notes:

- Sync transcription entrypoints were removed and tests were converted to async-only coverage.
- Process-backed capture infrastructure was removed along with the process-backed `run_live_session` integration tests that depended on it.
- Placeholder capture was removed; tests that only needed selected-device metadata now construct `SelectedDevices` directly.
- `should_keep_chunk(...)` was renamed to `is_speech_chunk(...)` to match its actual role in silence-based utterance finalization.
- `SourceRuntime` construction now uses a small helper that centralizes preprocess, silence tracking, and inference channel setup per source.

Verification:

- [x] Relevant CLI tests pass for any optional cleanup that is taken.

### Decision Log

- `2026-04-01`: Tracker added to convert the cleanup spec into a living implementation plan.
- `2026-04-01`: Removed unreferenced code and production-embedded whisper test backends; tests now carry their own local fake backends.
- `2026-04-01`: Changed default capture target to `16_000 Hz` mono.
- `2026-04-01`: Unified live preprocessing and VAD-facing analysis inside `PreprocessState`.
- `2026-04-01`: Removed sync transcription APIs and converted transcription tests to async-only calls.
- `2026-04-01`: Removed process-backed and placeholder capture paths, plus the process-backed live-session tests that depended on them.
- `2026-04-01`: Renamed VAD helper to `is_speech_chunk(...)`.
- `2026-04-01`: Consolidated repeated `SourceRuntime` construction in `run.rs`.

### Verification Log

- `2026-04-01`: `cargo test --test transcribe` passed.
- `2026-04-01`: `cargo test --test preprocess` passed.
- `2026-04-01`: `cargo test --test run_command` passed.
- `2026-04-01`: `cargo test --test audio_helpers` passed.
- `2026-04-01`: `cargo test --test transcribe` passed after `SourceRuntime` refactor.
- `2026-04-01`: `cargo test --test run_command` passed after `SourceRuntime` refactor.
- `2026-04-01`: `cargo test --test preprocess` passed after `SourceRuntime` refactor.

## Phase Details

### Phase 1: Dead code and dormant-path audit

1. Identify code that is:
   - completely unreferenced
   - referenced only by tests
   - present only as fallback scaffolding that is never activated in supported runtime paths
2. Separate findings into:
   - safe immediate deletions
   - optional deletions that require test rewrites or product decisions
3. Confirm there is no hidden production activation path before removal.
4. Treat embedded whisper test backends as removal candidates by default.

Expected impact: clear scope and lower risk for the rest of the cleanup.

### Phase 2: Safe deletions

1. Delete `process_transcription_outputs(...)`.
2. Delete `PcmFrame`.
3. Delete `WhisperCppAdapter::real(...)`.
4. Delete production-embedded whisper test backends and convenience constructors.
5. Remove or rewrite tests that depended on those helpers.
6. Run the remaining relevant CLI tests.

Expected impact: no behavior change.

### Phase 3: Move capture toward whisper format

1. Change `CaptureConfig::new(...)` defaults from `48_000 / stereo` to `16_000 / mono`.
2. Verify Linux PipeWire capture still negotiates correctly.
3. Verify Windows WASAPI capture still converts from mix format into configured output.
4. Update tests that assume old capture defaults.

Expected impact: less conversion work later in the pipeline, but not complete removal of conversion logic.

### Phase 4: Remove duplicate preprocessing

1. Add a single preprocessing entrypoint that processes a `PcmChunk` once.
2. Move VAD-facing data production into that path.
3. Delete `preview_audio_chunk(...)`.
4. Simplify `process_capture_chunk(...)` to orchestration only.
5. Preserve current semantics where VAD drives utterance finalization, not chunk dropping.

Expected impact: lower CPU usage and fewer moving parts in the live loop.

### Phase 5: Shrink `PreprocessState`

1. Audit remaining responsibilities after Phase 2 and 3.
2. Add a fast path for chunks already in whisper format.
3. Keep downmix/resample only as conditional fallback conversion.
4. Re-run preprocess and transcription tests.

Expected impact: preprocessing becomes a simpler buffering/timestamp component with conditional normalization.

### Phase 6: Optional test and API cleanup

1. Decide whether to remove sync transcription APIs.
2. Decide whether to remove process-backed capture.
3. Decide whether to remove placeholder capture.
4. Rename VAD helpers to reflect silence/finalization semantics.
5. Refactor repetitive `SourceRuntime` setup if still worthwhile.

Expected impact: smaller API surface and less maintenance burden.

## Verification

For each phase, run the smallest relevant checks first, then broader CLI checks.

Suggested commands:

- `cd cli && cargo test`
- `cd cli && cargo clippy --all-targets --all-features -- -D warnings`
- `cd cli && cargo fmt --all`

Targeted tests of interest:

- `cd cli && cargo test --test run_live_session`
- `cd cli && cargo test --test transcribe`
- `cd cli && cargo test --test linux_capture`

## Success Criteria

- no dead-code items above remain
- dormant or never-activated runtime paths have been audited and either removed or explicitly justified
- production code no longer contains whisper-specific test backends
- live capture no longer performs duplicate decode/downmix/resample work per chunk
- capture defaults align more closely with whisper input expectations where supported
- `PreprocessState` becomes materially simpler and only normalizes when needed
- VAD semantics are explicit: speech detection supports silence-based utterance finalization, not chunk dropping
- protocol behavior remains unchanged from the server's perspective
