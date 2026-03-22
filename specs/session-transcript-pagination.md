# Live Transcript Pagination and Infinite Scroll

## Status

- Proposed.

## Workflow Requirement

- Implementation progress must be recorded directly in this spec as work proceeds.
- The `## Progress Tracker` section must be updated whenever a phase or major task is completed.
- If scope changes during implementation, update this spec before or alongside the code change so the tracker remains accurate.

## Context

The live session transcript currently accumulates transcript entries in client memory and renders the entire transcript list inside `web/src/components/sessions/session-live-view.tsx`.

This works for short sessions, but it does not scale well for long-running sessions because:

- browser memory grows with every transcript event
- render cost grows with transcript length
- the transcript pane becomes harder to navigate
- the client stores data that already exists in the database
- auto-scroll to the bottom fires unconditionally on every new transcript entry, yanking the user away from older content they may be reading

We want the transcript pane to load only a limited recent window by default, fetch older transcript messages from the database on demand, and provide a better long-session navigation experience.

The existing right-hand solution pane already uses explicit scroll affordances. The transcript pane should adopt a similarly deliberate scrolling experience while keeping live updates responsive.

## Goals

- Load only the latest transcript messages by default.
- Stop keeping the full transcript history in client memory.
- Fetch older transcript messages from the database as needed.
- Use the shadcn `ScrollArea` component for the transcript UI container.
- Support upward infinite scroll for older transcript pages.
- Preserve live transcript updates from the existing subscription flow.
- Keep scroll position stable when older messages are prepended.
- Provide transcript navigation affordances similar in spirit to the solution pane.

## Non-Goals

- Changing transcript event protocol semantics.
- Changing how transcript events are ingested or stored.
- Replacing the existing session event subscription mechanism.
- Virtualizing the transcript list in this change.
- Reworking the overall live session layout.

## Product Requirements

### Initial transcript window

When the live session view loads:

- the transcript pane must fetch only transcript events from the database
- the initial page size must be `50` transcript items
- the transcript must render those items in chronological order within the visible list
- the newest transcript content must remain the default visible position

### Older transcript loading

When the user scrolls upward toward the start of the loaded list:

- the UI must fetch the next older transcript page from the database
- each older page should load `50` additional transcript items
- older items must be prepended without causing a visible jump in scroll position
- loading should stop once there are no older transcript items left

### Live updates

New transcript events received via subscription must still appear live:

- if the user is near the bottom of the transcript pane, the view should remain pinned to the latest content
- if the user is reading older transcript content, new messages must not forcibly scroll the pane to the bottom
- partial and final transcript events must continue to reconcile correctly within the loaded transcript window

### Transcript navigation controls

The transcript pane should expose lightweight floating controls inspired by the solution pane's visual pattern:

- an upward control for reaching older transcript content
- a downward control for returning to the latest transcript content
- optional status text indicating whether older messages remain available

These controls are supplemental to scrolling, not a replacement for it.

Note: the solution pane's controls navigate between discrete markdown heading sections (showing a "2/5" style section counter). The transcript pane should use simpler scroll-position-based controls (scroll toward older content / jump to latest) since the transcript is a continuous stream rather than a sectioned document. The visual appearance and floating positioning should be similar, but the interaction model is different.

## Technical Design

### Data loading model

Transcript data should be separated from lifecycle state.

The live session screen should separate responsibilities into focused components.

Recommended structure:

- `web/src/components/sessions/session-live-view.tsx`
  - layout/composition shell for the live session screen
- `web/src/components/sessions/session-transcript-pane.tsx`
  - transcript-specific loading, paging, live merge, and scroll behavior
- `web/src/components/sessions/session-live-header.tsx`
  - session title, status, metadata popover, and CLI trigger

State responsibilities should be split so the overall feature still covers two concerns:

- session lifecycle state derived from the `Session` record on load, then kept current via subscription events
- transcript page state derived from paginated database queries plus live transcript subscription updates

This means the transcript pane should no longer be built from the entire `initialHistory` array.

### Backend API

Add a dedicated paginated transcript query to the session router in `web/src/server/api/routers/session.ts`.

Recommended contract:

- procedure name: `transcriptPage`
- input:
  - `sessionId: string`
  - `cursor?: number`
  - `limit?: number`
- output:
  - `items: SessionEvent[]`
  - `nextCursor: number | null`

Behavior:

- verify the session belongs to the current user
- query only `transcript.partial` and `transcript.final` events
- when `cursor` is absent, fetch the newest transcript events
- when `cursor` is present, fetch transcript events with `sequence < cursor`
- order database results by `sequence desc` for efficient newest-first pagination
- return `nextCursor` based on the oldest returned sequence when more results exist

The UI should reverse each page before merging it into the rendered transcript so the visible list remains chronological.

### Shared contracts

Add explicit pagination schemas to `web/src/lib/contracts/event.ts`.

Recommended additions:

- `sessionTranscriptPageInputSchema`
- `paginatedSessionTranscriptSchema`

The response contract should preserve reuse of `sessionEventSchema` for transcript items.

### Client transcript state

The transcript UI should keep only the currently loaded pages in memory.

Recommended client state shape:

- `transcriptItems: TranscriptItem[]`
- `hasOlderTranscript: boolean`
- `oldestLoadedSequence: number | null`
- `isFetchingOlderTranscript: boolean`
- `isNearBottom: boolean`

This state should contain only the loaded window, not the full database history.

### Partial and final reconciliation

The current transcript normalization logic in `web/src/components/sessions/session-live-view.tsx` should be adapted so it works against the loaded transcript window.

Rules:

- a new partial should replace an overlapping partial for the same utterance or source window when present in loaded state
- a final should replace matching loaded partial state when present
- if a final arrives for an utterance whose partial is not currently loaded, the final should still be inserted normally
- older unloaded transcript pages do not need to be fetched just to reconcile a new live event

The current reconciliation logic uses a dual matching strategy that must be preserved:

1. **utteranceId matching** — two items match if they share the same `utteranceId`
2. **source + time overlap matching** — two items match if they share the same `source` and their `[startMs, endMs]` ranges overlap

When a **final** event arrives, all loaded partials that overlap the same source are removed. When a **partial** event arrives, all loaded partials that either share the same utteranceId or overlap the same source are removed (but finals are kept). After filtering, if any remaining partial matches by either strategy, it is replaced in-place; otherwise the new item is appended. The transcript is then re-sorted by `sequence`.

### Subscription afterSequence source

The existing subscription uses `afterSequence` derived from replaying the entire `initialHistory` array through `buildInitialState`. Once the full history is no longer loaded, this derivation path breaks.

The subscription must still start from the correct sequence to avoid missed or duplicate events. Recommended approach:

- The initial transcript page query returns the newest transcript events. The highest `sequence` value among those results is known.
- However, the subscription delivers **all** event types (lifecycle + transcript), not just transcript events. A non-transcript event could have a higher sequence than any transcript event.
- Therefore, the subscription's `afterSequence` should come from the `session` record itself, not the transcript page. The `session.history` query (or a new lightweight query) should provide the latest known sequence, or the `Session` model should expose a `lastSequence` field.
- Alternatively, on mount the composition shell can issue a single narrow query for the session's maximum event sequence and use that as the subscription starting point.

This is a correctness requirement: getting it wrong causes missed events or duplicate processing.

### Lifecycle state without full history

Currently `buildInitialState` replays all events to derive `status`, `startedAt`, and `expiresAt`. Once the full history is no longer server-loaded, lifecycle state must come from another source.

The `Session` record returned by `session.byId` already contains `status`, `startedAt`, and `expiresAt` fields. The composition shell should use these directly for initial lifecycle state instead of replaying events. The subscription will still apply lifecycle event updates going forward via `applyEvent`.

The `lastSequence` value needed for the subscription (see above) could either be added to the `Session` model or fetched as a separate lightweight query (e.g., `SELECT MAX(sequence) FROM session_events WHERE session_id = ?`).

### Scroll container

Replace the transcript pane's raw `overflow-y-auto` implementation with shadcn `ScrollArea` from `web/src/components/ui/scroll-area.tsx`.

The transcript pane should:

- use a top sentinel element inside the scrollable viewport
- use `IntersectionObserver` to trigger loading older transcript pages when the sentinel becomes visible
- keep a bottom anchor element for optional jump-to-latest behavior

### Scroll anchoring

When older messages are prepended:

- measure the transcript scroll height before the fetch result is applied
- apply the older items
- adjust scroll position by the height delta after render
- preserve the user’s current viewport so the loaded content does not jump

### Auto-scroll behavior

Auto-scroll to bottom should happen only when the user is already near the bottom of the transcript viewport.

Recommended threshold:

- treat the user as near the bottom when the remaining scroll distance is less than about `80px`

If the user is not near the bottom:

- append live transcript changes without forcing scroll position
- surface the downward navigation control so the user can jump back to the latest content

## Files To Change

### Contracts

- `web/src/lib/contracts/event.ts`
  - add transcript pagination input/output schemas

### API router

- `web/src/server/api/routers/session.ts`
  - add `transcriptPage` query for transcript-only pagination
  - remove or narrow `history` once the live session screen no longer depends on full event history

### Session page loader

- `web/src/app/sessions/[sessionId]/page.tsx`
  - stop server-loading the full session history for transcript rendering
  - keep loading only the session data needed for initial page render
  - update `SessionLiveView` props if `initialHistory` is narrowed to lifecycle-only data or removed
  - ensure the `Session` record provides enough data for initial lifecycle state (`status`, `startedAt`, `expiresAt`) and subscription `afterSequence` (either via a `lastSequence` field or a separate lightweight query)

### Live session UI

- `web/src/components/sessions/session-live-view.tsx`
  - reduce responsibilities so it becomes the live session layout/composition shell
  - remove transcript-specific rendering and pagination logic
  - keep solution state, solution subscription wiring, and overall panel layout

- `web/src/components/sessions/session-transcript-pane.tsx`
  - new component for transcript-specific state and rendering
  - fetch the initial transcript page from the database
  - fetch older pages on upward scroll
  - merge live subscription transcript events into loaded transcript state
  - switch transcript pane to `ScrollArea`
  - add floating transcript navigation controls

- `web/src/components/sessions/session-live-header.tsx`
  - new component for the live session header metadata and CLI entry point
  - render session title, type/language label, status badge, timing popover, and CLI button

### UI helpers

- `web/src/components/ui/scroll-area.tsx`
  - extend `ScrollArea` to expose a ref to the inner `ScrollAreaPrimitive.Viewport` element
  - the current implementation wraps the viewport internally with no ref forwarding
  - the transcript pane requires viewport ref access for `IntersectionObserver` setup, `scrollHeight` measurement before and after prepending, and `scrollTop` restoration for scroll anchoring
  - recommended approach: accept an optional `viewportRef` callback prop or forward a ref through to the viewport element

- `web/src/components/ui/skeleton.tsx`
  - optional use for older-transcript loading placeholders

- `web/src/components/ui/separator.tsx`
  - optional use for transcript navigation or visual grouping if needed

## Files Reviewed

- `web/src/components/sessions/session-live-view.tsx`
  - current transcript rendering, lifecycle state handling, and live subscription merge behavior

- `web/src/server/api/routers/session.ts`
  - current session history query and subscription procedures

- `web/src/app/sessions/[sessionId]/page.tsx`
  - current server-side loading of `session`, `history`, and `solution`

- `web/src/components/sessions/solution-pane.tsx`
  - existing floating scroll/navigation controls used as the reference visual pattern
  - note: the solution pane navigates between discrete markdown heading sections, not scroll positions; the transcript pane needs simpler scroll-position-based controls

- `web/src/components/ui/scroll-area.tsx`
  - existing shadcn scroll container available for transcript UI migration

- `web/src/lib/contracts/event.ts`
  - current transcript event and session history contracts

## Cleanup

- Remove transcript rendering dependence on `initialHistory` in `web/src/components/sessions/session-live-view.tsx`.
- Remove any client state that accumulates the full transcript history by default.
- Split `web/src/components/sessions/session-live-view.tsx` so transcript concerns move into `web/src/components/sessions/session-transcript-pane.tsx` and header concerns move into `web/src/components/sessions/session-live-header.tsx`.
- Remove transcript state from lifecycle-oriented state containers so session lifecycle and transcript pagination are clearly separate responsibilities.
- Extract or consolidate transcript normalization helpers if lifecycle and paginated transcript logic currently share mixed responsibilities.
- Remove the raw transcript `overflow-y-auto` container once `ScrollArea` is in place.
- Remove `session.history` from `web/src/server/api/routers/session.ts` if no remaining callers need broad event history after transcript pagination lands.
- If initial lifecycle backfill is still needed, replace broad history loading with a smaller lifecycle-focused query rather than keeping an all-events API by default.
- Delete any temporary compatibility code added during the refactor once paginated transcript loading fully owns transcript rendering.
- Keep lifecycle event handling intact, but separate it clearly from transcript page loading so future maintenance is simpler.

## Implementation Plan

### Phase 1: Contracts and backend query

1. Add transcript pagination schemas in `web/src/lib/contracts/event.ts`.
2. Add `session.transcriptPage` to `web/src/server/api/routers/session.ts`.
3. Ensure the query filters only transcript events and paginates by `sequence`.
4. Return `nextCursor` for older-page fetching.
5. Identify whether `session.history` still has any callers after the live session refactor and remove or narrow it accordingly.

### Phase 2: Transcript client state refactor

1. Keep session lifecycle state separate from transcript page state.
2. Stop using `initialHistory` as the rendered transcript source.
3. Derive initial lifecycle state (`status`, `startedAt`, `expiresAt`) from the `Session` record instead of replaying events.
4. Determine the subscription `afterSequence` without requiring the full event history (see Subscription afterSequence source section). Either add a `lastSequence` field to the `Session` model or fetch `MAX(sequence)` on mount.
5. Extract a dedicated `SessionTranscriptPane` component to own transcript fetching, paging, scroll state, and transcript rendering.
6. Extract a dedicated `SessionLiveHeader` component so metadata and transcript concerns are no longer mixed in the same file.
7. Fetch the latest transcript page on mount.
8. Normalize fetched transcript events into `TranscriptItem[]`.

### Phase 3: Infinite scroll behavior

1. Extend `ScrollArea` in `web/src/components/ui/scroll-area.tsx` to expose a viewport ref (required for `IntersectionObserver`, scroll height measurement, and scroll position restoration).
2. Replace the transcript container with the extended shadcn `ScrollArea`.
3. Add a top sentinel and `IntersectionObserver` for older-page loading.
4. Prepend older transcript pages while preserving scroll position.
5. Prevent duplicate loads while a fetch is already in flight.

### Phase 4: Live merge and navigation controls

1. Keep the existing transcript subscription.
2. Merge new partial and final events into the loaded transcript window.
3. Track whether the user is near the bottom.
4. Auto-scroll only when the user is near the bottom.
5. Add transcript controls for jumping upward and returning to the latest content.

### Phase 5: Verification

1. Confirm the initial transcript load contains at most `50` items.
2. Confirm scrolling upward loads older transcript pages from the database.
3. Confirm client memory does not accumulate the full transcript unless the user explicitly scrolls through all pages.
4. Confirm scroll position remains stable when older pages are prepended.
5. Confirm live transcript updates still appear immediately.
6. Confirm new live updates do not yank the user away from older transcript content.
7. Confirm transcript labels still behave correctly across session types.

## Suggested Commands

- `cd web && bun run lint`
- `cd web && bunx tsc --noEmit`
- `cd web && bun run build`

## Progress Tracker

- Keep this section updated during implementation; do not wait until the end of the work.
- [x] Spec written
- [x] Transcript pagination contracts added
- [x] `session.transcriptPage` API added
- [x] Subscription `afterSequence` source updated (no longer depends on full history)
- [x] Lifecycle state derived from `Session` record instead of event replay
- [x] `ScrollArea` extended with viewport ref access
- [x] Broad `session.history` usage removed or narrowed
- [x] Session detail page loader updated
- [x] `SessionLiveView` split into focused components
- [x] Transcript pane uses DB-backed paging
- [x] Transcript pane uses `ScrollArea`
- [x] Upward infinite scroll implemented
- [x] Live transcript merge behavior updated
- [x] Transcript navigation controls added
- [ ] Cleanup completed
- [x] Verification completed

## Acceptance Criteria

- The transcript pane renders only the latest `50` messages on first load.
- The client does not pre-load the full transcript history.
- Older transcript pages are fetched from the database on demand.
- Transcript scrolling uses shadcn `ScrollArea`.
- Older pages load smoothly when scrolling upward.
- The user can return quickly to the newest transcript content.
- Live transcript updates still reconcile partial and final events correctly.
- The subscription does not miss events or produce duplicates after the refactor (the `afterSequence` source is correct without full history).
- Lifecycle state (`status`, `startedAt`, `expiresAt`) renders correctly from the `Session` record without replaying all events.

## Open Questions

- Should transcript pagination be available only for live sessions, or also reused for ended session history views in a follow-up?
- Should the transcript controls expose an unread/new-message indicator when the user is away from the bottom?
