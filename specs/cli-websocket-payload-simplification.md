# CLI WebSocket Payload Simplification

## Status

- Proposed
- No implementation changes are part of this spec

## Context

The CLI and web backend communicate over a websocket protocol with these primary outbound CLI messages:

- `session.start`
- `transcript.partial`
- `transcript.final`
- `session.stop`

Today, some payload fields are session-level facts that do not change during a run, while other fields are sent on every transcript event even though they are either derivable or currently unused.

The goal is to make the protocol clearer:

- `session.start` should carry stable session metadata
- `session.ready` should remain a simple acknowledgement from the backend
- transcript events should carry only per-event data that actually changes

## Goals

- Keep `created_at` on transcript events
- Keep `cli_version` on `session.start`
- Add transcription backend and model information to `session.start`
- Reduce repeated transcript payload fields that do not need to be resent
- Keep the backend authoritative for `sessionId` via the signed websocket token
- Prefer a direct contract cutover over any compatibility layer for legacy payload shapes

## Non-goals

- No client-generated `session_id` field in websocket payloads
- No change to auth or token semantics
- No change to the high-level lifecycle: `session.start` -> `session.ready` -> transcript events -> `session.stop`
- No DB schema migration is required for this protocol cleanup alone
- No backward compatibility for old websocket payload shapes or old transcript-field fallbacks

## Backward Compatibility Stance

Backward compatibility is explicitly out of scope for this change.

- The CLI and backend should be updated together to the new contract.
- The backend does not need to accept both old and new websocket transcript payloads.
- The CLI does not need to tolerate legacy `session.ready` semantics beyond `status: "ok"`.
- Web UI and downstream consumers do not need to keep supporting transcript payloads that rely on removed fields such as `speaker` or `chunk_id`.
- Historical data cleanup may be handled separately if needed, but the protocol and application code should target the new shape only.

## Desired Protocol

### Common Envelope

All websocket messages continue to use:

```json
{
  "type": "message.kind",
  "sequence": 1,
  "payload": {}
}
```

### `session.start`

The CLI sends all stable session metadata once at the start of the websocket session.

Desired payload:

```json
{
  "cli_version": "0.1.3",
  "platform": "linux",
  "started_at": "2026-03-17T00:00:00.000Z",
  "mic_device_id": "mic-1",
  "system_device_id": "sys-1",
  "transcription_backend": "whisper-rs",
  "model": "small.en"
}
```

Notes:

- `cli_version` is already being added by the CLI and validated by the backend.
- `transcription_backend` should identify the runtime transcription engine, for example `whisper-rs` or `debug`.
- `model` should identify the configured model name, for example `small.en`.
- Optional future extensions may include language or GPU flags, but they are not required for the first pass.

### `session.ready`

The backend acknowledges a valid and accepted session start.

Payload remains:

```json
{
  "status": "ok"
}
```

This message is an acknowledgement barrier. The CLI must not send transcript events before `session.ready`.

Required behavior:

- `status` must be exactly `"ok"` for the CLI to proceed
- if the CLI receives `session.ready` with any other non-empty status, it must:
  - log an error or warning that the backend did not accept the session as ready
  - stop the live run
  - shut down without sending transcript events
- if the backend wants to communicate a failure condition, `session.error` remains the preferred explicit failure message

Examples:

- allowed: `{ "status": "ok" }`
- rejected by the CLI: `{ "status": "pending" }`
- rejected by the CLI: `{ "status": "not_ok" }`

### `transcript.partial`

The CLI sends only per-event data that changes over time.

Desired payload:

```json
{
  "event_id": "evt_123",
  "utterance_id": "utt_123",
  "source": "mic",
  "text": "hello wor",
  "start_ms": 1200,
  "end_ms": 1800,
  "created_at": "2026-03-17T00:00:01.200Z"
}
```

### `transcript.final`

Desired payload:

```json
{
  "event_id": "evt_124",
  "utterance_id": "utt_123",
  "source": "mic",
  "text": "hello world",
  "start_ms": 1200,
  "end_ms": 2400,
  "created_at": "2026-03-17T00:00:02.400Z"
}
```

### `session.stop`

No protocol change is required for this spec.

Payload remains:

```json
{
  "created_at": "2026-03-17T00:10:00.000Z",
  "reason": "user_interrupt"
}
```

## Field Decisions

### Keep

- Envelope `type`
- Envelope `sequence`
- `session.start.cli_version`
- `session.start.platform`
- `session.start.started_at`
- `session.start.mic_device_id`
- `session.start.system_device_id`
- `session.start.transcription_backend`
- `session.start.model`
- `transcript.*.event_id`
- `transcript.*.utterance_id`
- `transcript.*.source`
- `transcript.*.text`
- `transcript.*.start_ms`
- `transcript.*.end_ms`
- `transcript.*.created_at`
- `session.stop.created_at`
- `session.stop.reason`

### Remove From Transcript Events

- `speaker`
- `is_overlap`
- `device_id`
- `chunk_id`
- `confidence`
- `language`
- per-event `meta`

Rationale:

- `speaker` is derivable from `source` in current product behavior.
- `is_overlap` is currently unused and always absent in practice.
- `device_id`, `backend`, and `model` are session-level facts.
- `chunk_id` is an internal transport detail and is not required for the intended user-facing session event contract.
- `confidence`, `language`, and `meta` may be valuable later, but are not required for the minimal event payload described in this spec.
- This spec does not require retaining parser or UI compatibility for these removed fields.

### Explicitly Not Added

- `session_id` in websocket payloads

Rationale:

- The backend already binds each websocket connection to an authenticated session id from the bearer token.
- The server should remain authoritative for session identity.
- Repeating `session_id` in every message adds redundancy and potential mismatch handling without clear benefit for the current architecture.

## Backend Behavior

- The backend validates websocket auth first.
- The backend associates the connection with the token's `sid`.
- On `session.start`, the backend stores session-level metadata inside the session lifecycle event payload.
- The backend should send `session.ready` only when the session is actually ready for transcript traffic, with `status: "ok"`.
- On `transcript.partial`, the backend accepts the minimal transcript payload for live streaming but does not persist it as a stored session event.
- On `transcript.final`, the backend maps only the minimal transcript payload into a stored session event.
- The backend may continue to assign its own event record timestamp in addition to the client `created_at` sent in transcript payloads.
- The backend should remove legacy transcript fallbacks rather than supporting both old and new shapes in parallel.

## Affected Files

### CLI

- `cli/src/session/models.rs`
  - extend `SessionStartPayload`
  - remove trimmed transcript-only fields from `TranscriptEvent`
- `cli/src/session/manager.rs`
  - populate new `session.start` fields
  - stop serializing removed transcript fields
- `cli/src/commands/run.rs`
  - pass transcription backend and model information into `session.start`
- `cli/src/transcribe/whisper_cpp.rs`
  - provide a stable backend identifier
  - stop relying on per-event `meta` for backend/model transport
- `cli/src/transcribe/pipeline.rs`
  - stop passing removed transcript fields into message creation

### CLI tests

- `cli/tests/run_command.rs`
- `cli/tests/run_mock_backend.rs`
- `cli/tests/transcribe.rs`
- `cli/tests/websocket_client.rs`
- `cli/tests/run_live_session.rs`

### Web/backend

- `web/src/server/ws-protocol.ts`
  - validate the new `session.start` fields
  - accept the simplified transcript payload
  - stop mapping removed transcript fields
- `web/src/lib/contracts/event.ts`
  - simplify the transcript event payload contract
- `web/src/server/api/session-event-ingest.ts`
  - ensure ingest still validates the new transcript shape

### Web UI and downstream consumers

- `web/src/components/sessions/session-transcript.ts`
  - stop requiring `speaker` in transcript items
  - derive display labels from `source`
- `web/src/components/sessions/session-transcript-pane.tsx`
  - use derived speaker labels only
- `web/src/server/ai/session-solution-service.ts`
  - no functional change expected, but verify it only depends on `source` and `text`
- `web/src/server/ws-protocol.test.ts`
  - update fixtures and expectations

### Docs

- `README.md`
- `web/README.md`
- `cli/README.md`

## Execution Plan

### Phase 1: Finalize contract

- Confirm that transcript payload must keep `created_at`
- Confirm that `utterance_id` remains required on transcript events and is not backfilled from `chunk_id` or timing
- Confirm that transcript payload should drop `speaker`, `is_overlap`, `device_id`, `chunk_id`, `confidence`, `language`, and `meta`
- Confirm the exact names for session-level fields: `transcription_backend` and `model`
- Confirm that `session.ready.status` must be exactly `"ok"`, and any other status causes the CLI to log and shut down
- Confirm that the backend persists the reduced transcript payload shape as the stored event payload for new transcript events
- Confirm that implementation should replace, not preserve, legacy websocket payload handling

### Phase 2: CLI implementation

- Extend session-start payload generation with backend/model
- Remove eliminated transcript fields from serialization
- Keep `created_at` on partial and final transcript events
- Update reconnect path so repeated `session.start` sends the same contract
- Make `session.ready` handling reject any status other than `"ok"`
- Log a clear message and stop the run when a non-`"ok"` ready status is received

### Phase 3: Web/backend implementation

- Update websocket schema validation
- Update event mapping from websocket envelope to internal event payloads
- Make `utterance_id` required in websocket transcript validation and remove fallback derivation from `chunk_id` or timing
- Simplify the stored transcript payload contract to only `eventId`, `utteranceId`, `source`, `text`, timing, and `createdAt`
- Persist `session.start` backend/model metadata inside the existing session lifecycle payload for `session.started`
- Remove transcript-field mapping for `speaker`, `is_overlap`, `device_id`, `chunk_id`, `confidence`, `language`, and `meta`
- Ensure stored transcript events continue to power live transcript UI and solution generation
- Update UI transcript helpers to derive display labels from `source` instead of expecting `speaker` in transcript payloads
- Remove old schema branches, fallback derivation, and compatibility helpers rather than keeping dual-shape support

### Phase 4: Tests

- Update CLI unit and integration tests for message payload expectations
- Update backend protocol tests
- Update websocket envelope-to-internal-event mapping tests
- Add a regression test that `session.start` carries backend/model metadata
- Add a regression test that websocket transcript payloads require `utterance_id`
- Add a regression test that transcript events no longer require removed fields
- Add a regression test that stored transcript events remain consumable by transcript UI and solution generation without `speaker`
- Add a regression test that non-`"ok"` `session.ready` causes the CLI to fail fast

### Phase 5: Documentation

- Refresh docs and examples to show the new minimal payloads

## Cleanup Tasks

### Before or during implementation

- Update CLI and backend in the same change window so there is one authoritative websocket contract.
- Remove validation branches and payload mappers that accept legacy transcript fields.
- Remove `utterance_id` fallback derivation from `chunk_id` or timing.
- Update UI helpers and transcript rendering to derive labels from `source` only.
- Rewrite tests and fixtures to use only the new `session.start` and transcript payload shapes.
- Refresh docs and examples so no legacy payload examples remain.

### After implementation

- Delete dead code paths, types, helper functions, and test fixtures that existed only for the old payload shape.
- Audit logs, debug output, and developer docs for references to removed transcript fields.
- Decide whether historical stored events need one-off cleanup or can simply be ignored as unsupported legacy data.
- Optionally follow up with typed persistence for session-start metadata if the current unstructured storage becomes limiting.

## Validation Checklist

- CLI sends `session.start` with `cli_version`, `platform`, `started_at`, device ids, backend, and model
- Backend accepts `session.start` and replies with `session.ready` carrying `status: "ok"`
- CLI sends transcript events containing `event_id`, `utterance_id`, `source`, `text`, timing, and `created_at`
- Backend ingests transcript events without `speaker`, `device_id`, `chunk_id`, `confidence`, `language`, or `meta`
- Live transcript UI still renders correct labels using `source`
- Solution generation still formats transcript lines correctly
- Reconnect behavior still succeeds with the updated `session.start`
- CLI logs and shuts down if `session.ready.status` is anything other than `"ok"`
- No production code path still depends on removed transcript fields or fallback derivation

## Open Questions

- Should `language` remain session-level metadata in `session.start`, or remain omitted entirely for now?
- Should GPU-related settings be included in `session.start` for debugging and analytics, or left out of the protocol?
- Should the backend persist session-start metadata into a typed contract instead of unstructured `meta`?
