# Solution Generation

How the AI solution (suggestion) pipeline works end-to-end, from transcript
ingestion through real-time delivery to the client.

---

## Overview

When a live session is running and `solutionEnabled` is `true`, each finalized
transcript chunk triggers a debounced AI generation cycle. The result is a
markdown document streamed to the client through server-sent events (SSE) via a
tRPC subscription.

---

## Trigger points

Generation is scheduled by calling `scheduleSessionSolutionGeneration()`:

| Trigger | File | Line | Condition |
|---|---|---|---|
| New `transcript.final` event ingested | `web/src/server/api/session-event-ingest.ts` | 302 | `session.solutionEnabled !== false` |
| User toggles AI switch ON mid-session | `web/src/server/api/routers/session.ts` | 419 | A finalized transcript event already exists |

---

## Server-side debounce & generation

All scheduling and execution lives in:

**`web/src/server/ai/session-solution-worker.ts`**

### Constants

| Name | Value | Line |
|---|---|---|
| `DEBOUNCE_MS` | `4000` (4 seconds) | 24 |

### In-memory state (per session)

```
type SessionGenerationState = {
  timer: ReturnType<typeof setTimeout> | null;  // debounce timer
  latestRequestedSequence: number;               // highest transcript sequence seen
  running: boolean;                              // generation in progress
};
```

Defined at line 26. Stored in a `Map<string, SessionGenerationState>` on
`globalThis` (line 32–41) to survive hot-reloads in development.

### `scheduleSessionSolutionGeneration()` — line 213

1. Updates `latestRequestedSequence` to `max(current, sourceEventSequence)`.
2. If a generation is already `running` → returns immediately (the running
   generation will re-schedule itself when it finishes — see step 6 below).
3. Clears any existing debounce timer.
4. Sets a new `setTimeout` of `DEBOUNCE_MS` (4 s).
5. When the timer fires → calls `runGeneration(sessionId, latestRequestedSequence)`.

**Effect:** the debounce resets every time a new `transcript.final` arrives. If
the user keeps talking continuously, generation is deferred until 4 seconds of
silence (no new finalized transcript).

### `runGeneration()` — line 63

1. Sets `running = true`.
2. Fetches the session row and the latest existing solution from the DB.
3. Fetches all `sessionEvents` up to `requestedSequence`.
4. Emits a `solution.generating` event (status `"draft"`) via
   `publishSessionSolutionEvent()` — line 106.
5. Calls `generateSessionSolution()` (see AI service below).
   - **On success:** inserts a `"ready"` solution row, emits `solution.ready`.
   - **On failure:** inserts an `"error"` solution row (preserving the previous
     solution's content), emits `solution.failed`.
6. In the `finally` block (line 204): sets `running = false`, then checks if
   `latestRequestedSequence > requestedSequence`. If so, **re-schedules** to
   pick up transcript that arrived during generation.

---

## AI service

**`web/src/server/ai/session-solution-service.ts`**

`generateSessionSolution()` (line 94) orchestrates the actual AI call:

1. Prepares a transcript summary from the raw events
   (`web/src/server/ai/session-solution/transcript.ts`).
2. Builds the prompt via `buildSolutionPrompt()`
   (`web/src/server/ai/session-solution/prompt.ts`), which varies by session
   type:
   - **coding / system_design** → technical prompt with required sections
     (Understanding, Approach, Solution, Notes).
   - **writing** → writing-focused prompt.
   - **meeting_summary** → structured meeting summary (uses `generateObject()`).
3. Calls the OpenRouter API via Vercel AI SDK (`generateText` or
   `generateObject`).
4. Validates the response (`web/src/server/ai/session-solution/validate.ts`) —
   checks for required sections and rejects raw HTML.
5. Returns a `GeneratedSolution` object.

### Key types (`web/src/server/ai/session-solution/schemas.ts`)

| Type | Line | Description |
|---|---|---|
| `GeneratedSolution` | 22 | AI output: `content`, `format`, `provider`, `model`, `promptVersion`, `meta` |
| `SolutionPrompt` | 31 | Final prompt payload: `system`, `prompt`, `outputMode` |
| `SessionConstraintInstructions` | 37 | Per-session-type system/prompt instruction arrays |
| `solutionPromptVersion` | 3 | Current prompt version (`"v3"`) |

For `meeting_summary`, structured output is stored in `meta.structured` after the
object response is rendered into markdown.

---

## Real-time event delivery

### Server-side event bus

**`web/src/server/api/session-events.ts`** (line 5)

Provides `publishSessionSolutionEvent()` and
`subscribeToSessionSolutionEvents()` — an in-process pub/sub used by the
worker to push events and the tRPC subscription to consume them.

### tRPC procedures (`web/src/server/api/routers/session.ts`)

| Procedure | Line | Type | Description |
|---|---|---|---|
| `solution` | 189 | Query | Fetches the latest solution for a session |
| `solutionHistory` | 209 | Query | Fetches all solution versions (optionally after a version) |
| `solutionSubscribe` | 237 | Subscription | Replays missed events, then yields live `SessionSolutionEvent`s |
| `toggleSolution` | 391 | Mutation | Toggles `solutionEnabled`; if enabling mid-session, triggers generation |

---

## Shared contract

**`web/src/lib/contracts/solution.ts`** (108 lines)

### Solution statuses

`"draft"` | `"ready"` | `"error"` — line 5.

### Event types (discriminated union)

| Event type | Payload schema | When emitted |
|---|---|---|
| `solution.generating` | `solutionGeneratingPayloadSchema` (line 56) | Generation starts |
| `solution.updated` | `solutionUpdatedPayloadSchema` (line 61) | Draft content update; not emitted by the current worker, but part of the shared contract and replay path |
| `solution.ready` | `solutionReadyPayloadSchema` (line 66) | Generation completed successfully |
| `solution.failed` | `solutionFailedPayloadSchema` (line 71) | Generation failed |

### Core schema fields (`sessionSolutionSchema` — line 26)

`id`, `sessionId`, `status`, `format`, `content`, `version`,
`sourceEventSequence`, `errorMessage`, `provider`, `model`, `promptVersion`,
`meta`, `createdAt`, `updatedAt`.

---

## Client-side state machine

**`web/src/components/sessions/session-live-view.tsx`**

### `SolutionState` (line 45)

```
type SolutionState = {
  status: "idle" | "generating" | "draft" | "ready" | "error";
  lastVersion: number;
  solution: SessionSolution | null;
};
```

### State transitions — `applySolutionEvent()` (line 116)

| Current | Event | Next status |
|---|---|---|
| any | `solution.generating` (new version) | `generating` |
| any | `solution.updated` | `draft` |
| any | `solution.ready` | `ready` |
| any | `solution.failed` | `error` |
| any | `solution.generating` (same version) | no change (skip) |
| any | event with version < lastVersion | no change (skip) |

### "Catching up" detection (line 289)

```ts
const isCatchingUp =
  solutionState.solution !== null &&
  transcriptLatestSequence > solutionState.solution.sourceEventSequence;
```

This is `true` when the client has received newer transcript than the current
solution covers — meaning a new generation cycle is expected.

---

## UI rendering

### Panel header (`session-live-view.tsx` — line 330)

The right pane header shows:
- Panel title (currently "Solution") — line 332
- Connection status label — line 337
- AI toggle switch — line 342

### `SolutionPane` (`web/src/components/sessions/session-solution-pane.tsx`)

Receives a `SolutionViewState` and renders based on `status`:

| Status | Render |
|---|---|
| `idle` | Empty state: "Waiting for transcript" or "AI generation is off" |
| `generating` (no content) | Full-panel loading dots |
| `generating` (has content) | Compact loading dots above existing content |
| `draft` | Content with "Draft" badge |
| `ready` | Content only |
| `error` (has content) | Content with error banner |
| `error` (no content) | Full-panel error message |

When `isCatchingUp` is `true`, shows "Catching up to transcript..." above the
content.

Content is rendered by `SolutionMarkdown`
(`web/src/components/sessions/solution-markdown.tsx`) which uses
`react-markdown` with custom heading, code (Shiki), and diagram (Mermaid)
renderers.

---

## Timing summary

```
transcript.final arrives
        │
        ▼
  ┌─────────────┐     resets on each
  │  Debounce    │◄─── new transcript.final
  │  4 seconds   │
  └──────┬───────┘
         │ timer fires
         ▼
  ┌─────────────┐
  │  Generation  │     emits solution.generating
  │  ~5–15s      │     (duration depends on model + transcript length)
  └──────┬───────┘
         │
         ▼
  solution.ready  OR  solution.failed
         │
         ▼
  if more transcript arrived during generation
  → re-schedule (another 4s debounce)
```

---

## Known limitations

The current single-instance implementation is functional, but a few product and
engineering limitations are worth tracking explicitly.

### 1. Disabling AI does not cancel an in-flight run

If the user turns AI generation off while a model request is already running,
the current worker still persists and emits the completed result because
`solutionEnabled` is checked only before the generation starts.

### 2. Each run rebuilds from the full finalized transcript

Every generation fetches all session events up to `requestedSequence` and
rebuilds the transcript context from scratch, so latency, token usage, and
failure risk grow with session length.

### 3. Error rows can inherit stale solution metadata

When generation fails, the worker currently persists an `"error"` solution row
that keeps the previous solution's content and also copies prior provider,
model, prompt-version, and metadata fields, which can make the failed version
look tied to older content.

### 4. Continuous speaking can postpone updates indefinitely

The debounce resets on every new `transcript.final`, so during long uninterrupted
conversation the next generation can be delayed until the speaker pauses.

### 5. In-progress generation state is not durable across refresh/reconnect

The current `solution.generating` state is only published as a live event and is
not persisted, so if the client refreshes or reconnects mid-run it can lose the
fact that a generation is underway and fall back to the last persisted solution.

## Execution decisions

This section replaces the earlier directional notes. The items below are the
intended implementation contract for the execution plan.

### 1. Drop results generated after AI is turned off

If AI is disabled while a generation is already running, let the model request
finish, but re-read `session.solutionEnabled` before persisting or publishing
the result.

If the session was disabled mid-run:
- discard the generated output
- do not insert a new `sessionSolutions` row
- do not publish `solution.ready` or `solution.failed`
- reset persisted generation state on the session back to `"idle"`

Disabling AI must also cancel any pending debounce timer immediately.

### 2. Move to incremental generation

The next implementation should update from the latest successful solution rather
than rebuilding from the full transcript every time.

Rules:
- use the latest `"ready"` solution as the incremental base
- fetch only `transcript.final` events with `sequence > latestReady.sourceEventSequence`
  and `sequence <= requestedSequence`
- if no `"ready"` solution exists yet, fall back to the current full-generation
  behavior from the start of the session
- `sourceEventSequence` remains the only cursor that determines transcript
  coverage; timestamps are not a resume cursor

No-op conditions:
- if `requestedSequence <= latestReady.sourceEventSequence`, do not create a new
  solution version
- if the fetched incremental event range produces no usable finalized transcript
  text, do not create a new solution version

Prompting rules for incremental runs:
- include the latest ready solution content as prior context
- include only the new finalized transcript delta as fresh evidence
- instruct the model to revise the existing solution instead of regenerating
  from scratch
- keep the existing output contract by session type

Versioning rules:
- `sessionSolutions.version` continues to increment from the latest persisted
  solution row of any status
- the new row's `sourceEventSequence` is always the requested end sequence for
  that run

### 3. Store error metadata for the attempted run

When generation fails, the worker should still create an `"error"` row, but the
metadata must describe the failed attempt rather than the previous success.

Rules:
- fallback content may be reused for UI display, but only from the latest
  persisted useful solution content
- provider, model, and promptVersion must reflect the attempted run
- `meta` must be `null` on the error row
- do not copy structured or content-derived metadata from a prior successful row

For fallback content, prefer the latest `"ready"` solution's content. If no
ready solution exists, use an empty string.

### 4. Keep debounce, add a max-wait threshold

Keep the silence-based debounce, but make both timings explicit configuration
constants in the worker.

Default values:
- `DEBOUNCE_MS = 5000`
- `MAX_WAIT_MS = 10000`

Scheduling algorithm:
1. On the first schedule request for an idle session, record `firstScheduledAt = now`.
2. On every schedule request, update `latestRequestedSequence` to the highest
   seen finalized transcript sequence.
3. If a generation is already running, do not change the current run; just keep
   `latestRequestedSequence` updated for the follow-up run.
4. If the worker is debouncing, compute the next fire time as:
   `min(now + DEBOUNCE_MS, firstScheduledAt + MAX_WAIT_MS)`.
5. Clear the prior timer and arm a new timer for that computed fire time.
6. When the timer fires, clear debounce state and start generation.

Effect:
- short pauses still wait for the debounce window
- continuous speaking can delay updates only until `MAX_WAIT_MS`, not forever

### 5. Persist generation state on the session

Persist in-progress state on the `sessions` row instead of trying to represent
it as a draft solution version.

Required new session fields:
- `solutionGenerationStatus`: `"idle" | "debouncing" | "generating"`
- `solutionGenerationStartedAt`: nullable timestamp
- `solutionGenerationDebounceUntil`: nullable timestamp
- `solutionGenerationMaxWaitUntil`: nullable timestamp
- `solutionGenerationSourceEventSequence`: nullable integer

Why `solutionGenerationMaxWaitUntil` is required:
- the earlier field set was not enough to reconstruct or display the max-wait
  deadline after refresh/reconnect
- the execution plan should treat this field as required, not optional

Persistence rules:
- when a debounce window is armed, set status to `"debouncing"`
- while debouncing, set:
  - `solutionGenerationStartedAt = null`
  - `solutionGenerationDebounceUntil = computed fire time`
  - `solutionGenerationMaxWaitUntil = firstScheduledAt + MAX_WAIT_MS`
  - `solutionGenerationSourceEventSequence = latestRequestedSequence`
- when the model call starts, set status to `"generating"`
- while generating, set:
  - `solutionGenerationStartedAt = now`
  - `solutionGenerationDebounceUntil = null`
  - `solutionGenerationMaxWaitUntil = null`
  - `solutionGenerationSourceEventSequence = requestedSequence`
- when generation succeeds, fails, is discarded, or becomes a no-op, reset the
  session back to `"idle"` and clear all timing/source fields

Disable behavior:
- when the user toggles AI off, cancel any pending debounce timer
- immediately persist `solutionGenerationStatus = "idle"`
- clear all generation timing/source fields even if an in-flight model request
  is still finishing in the background

### 6. Contract and API changes

The session contract must expose persisted generation state so the client can
restore state after refresh/reconnect.

Required contract changes:
- add the five generation-state fields above to `web/src/lib/contracts/session.ts`
- add matching columns to `web/src/server/db/schema.ts`
- ensure `session.create`, `session.update`, `session.byId`, and
  `session.toggleSolution` return the expanded session contract

Defaults for newly created sessions:
- `solutionGenerationStatus = "idle"`
- all other generation-state fields = `null`

No new solution event type is required for this scope. Existing
`solution.generating`, `solution.ready`, and `solution.failed` events remain the
live transport for solution-version updates.

### 7. Client behavior

The client should use both persisted session state and live solution events.

Rules:
- on initial page load or reconnect, seed the UI from the session contract's
  generation-state fields
- while connected live, continue using `solution.generating` / `ready` /
  `failed` events for version transitions
- if the page reloads during `"debouncing"` or `"generating"`, restore the
  in-progress state from the session row instead of falling back to the last
  persisted solution only
- `isCatchingUp` remains valid and should continue to compare transcript
  sequence with `solution.sourceEventSequence`

For this scope, the client does not need a new server push channel for
`"debouncing"` state changes. It is acceptable for the live UI to continue using
the existing local catch-up indicator while persisted session state mainly
improves refresh/reconnect recovery.

### 8. Worker edge cases

These behaviors should be explicit in the execution plan:

- If AI is toggled on and no finalized transcript exists yet, do not schedule a
  run and leave generation state as `"idle"`.
- If a run starts and the session row no longer exists, abort silently.
- If a run starts and AI is already disabled before the model call begins, abort
  silently and reset session state to `"idle"`.
- If transcript arrives during a running generation, do not interrupt the
  current run; schedule a follow-up run after completion using the latest seen
  sequence.
- If a run ends in discard because AI was disabled mid-flight, do not schedule a
  follow-up run.

### 9. Acceptance criteria for the execution plan

The execution plan should consider this work complete only when all of the
following are covered:

- a schema migration adds the session generation-state columns
- the session Zod contract and tRPC outputs include the new fields
- the worker persists `idle` / `debouncing` / `generating` transitions correctly
- disabling AI cancels pending debounce work and discards in-flight results
- continuous transcript input triggers generation no later than `MAX_WAIT_MS`
- incremental generation uses the latest ready solution plus only new finalized
  transcript events
- no-op incremental runs do not create empty or duplicate solution versions
- error rows record attempted-run provider/model/promptVersion and `meta = null`
- page refresh during debounce or generation restores the correct visible state
- tests cover debounce/max-wait behavior, discard-on-disable behavior,
  incremental fetch boundaries, and error-row metadata

---

## Execution plan

Implement this work in the phases below, in order.

### Phase 1. Database and shared contract

Goal: make generation state durable and available everywhere before changing
worker behavior.

Tasks:
1. Add new session columns in `web/src/server/db/schema.ts`:
   - `solutionGenerationStatus`
   - `solutionGenerationStartedAt`
   - `solutionGenerationDebounceUntil`
   - `solutionGenerationMaxWaitUntil`
   - `solutionGenerationSourceEventSequence`
2. Generate the matching Drizzle migration with `cd web && bun run db:generate`.
3. Review the generated migration to confirm it adds the expected columns and defaults.
4. Add the new fields to `web/src/lib/contracts/session.ts`.
5. Ensure all session router outputs parse and return the expanded session
   contract.
6. Set defaults for newly created sessions:
   - status = `"idle"`
   - all other fields = `null`

Definition of done:
- the DB schema, migration, and session contract compile together
- `session.create`, `session.byId`, and `session.toggleSolution` return the new
  fields

### Phase 2. Worker state model refactor

Goal: extend the in-memory scheduler so it can support max-wait and persisted
state transitions cleanly.

Tasks:
1. Update `SessionGenerationState` in
   `web/src/server/ai/session-solution-worker.ts` to track the first schedule
   timestamp used for max-wait.
2. Add worker constants:
   - `DEBOUNCE_MS = 5000`
   - `MAX_WAIT_MS = 10000`
3. Introduce small internal helpers for session generation-state persistence,
   for example:
   - persist debouncing state
   - persist generating state
   - reset to idle state
4. Keep the global in-memory map for local scheduling only; persisted state on
   `sessions` becomes the source of truth for recovery.

Definition of done:
- the worker can compute debounce and max-wait deadlines deterministically
- the worker has one clear path for writing `idle`, `debouncing`, and
  `generating` session states

### Phase 3. Scheduling and disable semantics

Goal: implement the new debounce/max-wait rules and disable behavior.

Tasks:
1. Update `scheduleSessionSolutionGeneration()` to:
   - maintain `latestRequestedSequence`
   - initialize `firstScheduledAt` on the first schedule of a debounce cycle
   - compute `debounceUntil = min(now + DEBOUNCE_MS, firstScheduledAt + MAX_WAIT_MS)`
   - clear and replace the timer on each new finalized transcript event
   - persist `"debouncing"` session state on every schedule update
2. When the timer fires:
   - clear the in-memory debounce timer
   - clear the in-memory first-scheduled marker
   - transition persisted session state to `"generating"`
3. Update `toggleSolution` so disabling AI:
   - cancels any pending debounce timer
   - clears in-memory schedule bookkeeping for that session
   - persists session generation state back to `"idle"`
4. Keep the existing enable behavior: if enabling mid-session and finalized
   transcript already exists, schedule generation.

Definition of done:
- continuous transcript input triggers a run by max-wait instead of waiting for
  silence forever
- disabling AI immediately removes any pending debounce work

### Phase 4. Incremental generation path

Goal: stop rebuilding from the full transcript for every run.

Tasks:
1. In `runGeneration()`, load the latest persisted `"ready"` solution for the
   session.
2. Fetch only finalized transcript delta events where:
   - `sequence > latestReady.sourceEventSequence`
   - `sequence <= requestedSequence`
3. If no ready solution exists, keep the current full-transcript bootstrap path.
4. Add no-op handling:
   - if `requestedSequence <= latestReady.sourceEventSequence`, skip the run
   - if the delta contains no usable finalized transcript text, skip the run
5. Extend the AI generation input and prompting flow so incremental runs receive:
   - previous ready solution content
   - only the new transcript delta
   - explicit instructions to revise the prior solution

Suggested implementation shape:
- extend `GenerateSessionSolutionInput` with optional prior-solution context
- extend transcript/prompt helpers only as much as needed to support incremental
  prompts without changing session-type output contracts

Definition of done:
- follow-up runs use only new finalized transcript events after the latest ready
  cursor
- no-op runs do not create new solution rows

### Phase 5. Result persistence and discard rules

Goal: ensure persisted rows and published events reflect the attempted run
correctly.

Tasks:
1. Before persisting a success result, re-read the session row and confirm
   `solutionEnabled` is still true.
2. If AI was disabled mid-run:
   - discard the result
   - publish nothing
   - insert no solution row
   - reset persisted session state to `"idle"`
3. On success, persist a `"ready"` row using:
   - generated content
   - attempted provider/model/promptVersion
   - `sourceEventSequence = requestedSequence`
4. On failure, persist an `"error"` row using:
   - fallback content from the latest ready solution, else empty string
   - attempted provider/model/promptVersion
   - `meta = null`
   - the failure message
5. Keep event publication behavior the same for successful and failed persisted
   runs.

Definition of done:
- error rows no longer inherit stale provider/model/prompt metadata
- disabled mid-flight runs leave no new solution version behind

### Phase 6. Session state lifecycle cleanup

Goal: guarantee that persisted generation state is reset correctly in every
terminal path.

Tasks:
1. Audit all exits from `runGeneration()`:
   - session missing
   - AI disabled before model call
   - no-op incremental run
   - success
   - failure
   - discard after mid-flight disable
2. Ensure every terminal path resets the session generation fields to `"idle"`
   and clears timestamps/source sequence.
3. Preserve the existing follow-up reschedule behavior only when:
   - the current run actually completed or failed while AI remained enabled
   - newer transcript arrived during the run
4. Do not schedule a follow-up run after a discard caused by AI being disabled.

Definition of done:
- session generation state never gets stuck in `"debouncing"` or `"generating"`
  after a completed worker cycle

### Phase 7. Client recovery and UI state

Goal: restore in-progress generation state after refresh/reconnect without
overhauling the live event model.

Tasks:
1. Extend the `Session` type usage in
   `web/src/components/sessions/session-live-view.tsx` to read the new session
   generation-state fields.
2. Seed the initial solution UI state from the session row when:
   - `solutionGenerationStatus === "debouncing"`
   - `solutionGenerationStatus === "generating"`
3. Preserve the existing live event reducer for `solution.generating`,
   `solution.ready`, and `solution.failed`.
4. Keep the existing `isCatchingUp` logic based on transcript sequence vs.
   `solution.sourceEventSequence`.
5. Update `SolutionPane` only as much as needed to show restored in-progress
   states cleanly after refresh.

Implementation note:
- this scope does not require a new subscription or SSE event for debouncing
  state; initial session data is enough for recovery

Definition of done:
- refreshing during debounce or generation no longer collapses the UI back to a
  stale ready/error snapshot with no in-progress indicator

### Phase 8. Tests and verification

Goal: cover the new worker semantics and contract changes before rollout.

Tasks:
1. Add or extend worker tests for:
   - debounce reset behavior
   - max-wait forced execution
   - reschedule after transcript arrives mid-run
   - cancel-on-disable while debouncing
   - discard-on-disable while generating
2. Add service/prompt tests for incremental input behavior if prompt structure
   changes materially.
3. Add router or contract tests for expanded session fields if the repo already
   has a suitable pattern; otherwise keep coverage focused on parsing and worker
   behavior.
4. Verify existing session-solution tests still pass after the incremental-path
   changes.
5. Run the standard web checks for this repo:
   - `bun run lint`
   - `bunx tsc --noEmit`
   - `bun run build`

Definition of done:
- automated coverage exists for the new edge cases called out in this spec
- lint, type-check, and build pass

### Phase 9. Rollout notes

Goal: reduce risk while shipping the behavior change.

Tasks:
1. Implement Phases 1-6 before changing client rendering, so backend semantics
   are stable first.
2. Land Phase 7 only after backend fields and worker persistence are working.
3. Verify that no existing code depends on `solution.generating` being the only
   in-progress signal.
4. Confirm that older sessions with `null` generation fields still parse safely
   as `"idle"` semantics if encountered during rollout.

Recommended implementation order inside a single branch:
1. migration + schema + contracts
2. worker state helpers
3. scheduling/disable behavior
4. incremental generation
5. persistence/discard cleanup
6. client recovery
7. tests + lint/type-check/build

---

## File reference

| File | Role |
|---|---|
| `web/src/lib/contracts/solution.ts` | Shared Zod schemas and types |
| `web/src/lib/contracts/session.ts:75` | `solutionEnabled` field on session schema |
| `web/src/server/ai/session-solution-worker.ts` | Debounce + orchestration |
| `web/src/server/ai/session-solution-service.ts` | AI call orchestration + re-exports |
| `web/src/server/ai/session-solution/prompt.ts` | Prompt construction per session type |
| `web/src/server/ai/session-solution/schemas.ts` | AI-layer types (`GeneratedSolution`, `SolutionPrompt`) |
| `web/src/server/ai/session-solution/types.ts` | `GenerateSessionSolutionInput` |
| `web/src/server/ai/session-solution/validate.ts` | Output validation (required sections, no raw HTML) |
| `web/src/server/ai/session-solution/render.ts` | Meeting summary markdown renderer |
| `web/src/server/ai/session-solution/transcript.ts` | Transcript summarization for prompts |
| `web/src/server/api/session-events.ts` | In-process pub/sub for solution events |
| `web/src/server/api/session-event-ingest.ts:295–303` | Trigger on `transcript.final` |
| `web/src/server/api/routers/session.ts:189–419` | tRPC procedures (query, subscription, mutation) |
| `web/src/server/db/schema.ts:177–178` | Drizzle types (`SessionSolution`, `NewSessionSolution`) |
| `web/src/components/sessions/session-live-view.tsx` | Client state machine + layout |
| `web/src/components/sessions/session-solution-pane.tsx` | Solution pane UI |
| `web/src/components/sessions/session-pane-states.tsx` | Shared empty/loading states |
| `web/src/components/sessions/solution-markdown.tsx` | Markdown renderer (headings, code, mermaid) |
| `web/src/server/ai/session-solution-service.test.ts` | Tests for prompt building and validation |
