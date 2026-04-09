# Features To Work On

## Solution Browsing History

## Summary

Add solution history browsing to the session detail view so users can inspect older AI solution snapshots instead of only seeing the latest version.

This makes the app more compelling because it turns AI output into an auditable progression: users can see how the solution improved as more transcript context arrived.

## Current State

- The backend already stores multiple solution versions in `session_solutions`.
- The API already exposes `session.solutionHistory` and `session.solutionSubscribe`.
- The session UI currently renders only the latest solution in `SolutionPane`.
- Users cannot review older versions, compare freshness, or understand how the solution evolved.

## Problem

The current experience makes solution generation feel opaque.

Users can see that the AI is updating, but once a new version arrives, the previous one is effectively gone from the UI. This reduces trust and removes a useful learning surface for interview prep and system design practice.

## Goals

- Let users browse older solution versions within a session.
- Keep the current live-updating experience intact for the latest solution.
- Make it clear which version is the latest and which version the user is viewing.
- Show enough metadata to explain why one version is newer or better.

## Non-Goals

- Full side-by-side diff view in the first iteration.
- Restoring an older version as the active version.
- Exporting a specific historical version separately from the existing session export.
- Public sharing or read-only history links.

## User Stories

- As a user, I can open a session and review previous AI solution versions.
- As a user, I can tell which version is the latest live output.
- As a user, I can inspect when a version was created and what transcript sequence it was based on.
- As a user, I can return to the latest version after browsing older ones.

## Proposed UX

### Entry point

Add a compact history control in the solution pane header.

- When there is only one version, the control stays hidden.
- When there are multiple versions, show a button such as `Version 4 of 6`.
- Clicking it opens a lightweight selector or popover with the available versions.

### Version list

Each version entry should show:

- version number
- status (`draft`, `ready`, `error`)
- timestamp
- transcript source sequence
- optional model/provider metadata when available

The latest version should be labeled clearly, for example `Latest`.

### Browsing behavior

- Selecting a historical version swaps the rendered markdown content in the solution pane.
- While viewing history, live updates continue in the background but do not forcibly kick the user away from the selected version.
- If a newer version arrives while the user is viewing history, show a subtle badge or banner such as `Newer version available` with an action to jump back to latest.
- If the user is already viewing the latest version, new updates replace the content as they do today.

### Empty and loading states

- If there is no solution history yet, keep the current empty/loading states.
- If history is loading but the latest solution is already available, keep the latest solution visible and load history progressively.

## Functional Requirements

### Data loading

- Load the latest solution exactly as today for fast initial render.
- Fetch full solution history after the initial page render using `session.solutionHistory`.
- Merge subsequent `session.solutionSubscribe` events into the in-memory version list.
- Keep versions ordered by ascending version number internally.

### Selection model

- Default selection is the latest available version.
- The UI must track `selectedVersion` separately from `latestVersion`.
- If the selected version is not the latest, do not overwrite the viewed content when new versions arrive.
- Provide a one-click action to jump back to the latest version.

### Metadata display

For the selected version, show at least:

- version number
- status
- creation time
- source transcript sequence

Optional metadata to show when present:

- provider
- model
- prompt version

### Status handling

- `draft` versions can be browsed like ready versions.
- `error` versions should remain visible in history and show their error state.
- The latest-version badge and the selected-version badge must not conflict.

## API / Contract Impact

No new backend contract is required for the first iteration.

Existing APIs appear sufficient:

- `session.solution`
- `session.solutionHistory`
- `session.solutionSubscribe`

## UI Components Likely Affected

- `web/src/components/sessions/session-live-view.tsx`
- `web/src/components/sessions/session-solution-pane.tsx`
- `web/src/lib/contracts/solution.ts`

Potentially add a small dedicated component for the version selector if it keeps `SolutionPane` simpler.

## State Model

Introduce client state roughly like:

- `solutionsByVersion: SessionSolution[]`
- `selectedVersion: number | null`
- derived `latestVersion`
- derived `selectedSolution`
- derived `hasUnseenLatest`

The current `solutionState` can remain the source for latest live status, but the rendered content should come from `selectedSolution`.

## Acceptance Criteria

- A session with multiple solution versions exposes a visible history control.
- Users can choose and view any stored solution version.
- The latest version is clearly labeled.
- New incoming solution versions do not interrupt a user who is browsing an older version.
- Users can jump back to the latest version in one action.
- Current loading, draft, ready, and error states still render correctly.

## Implementation Notes

- Start with a simple list or popover, not a complex diff UI.
- Preserve the current fast first paint by continuing to server-render only the latest solution.
- Avoid changing backend persistence or solution generation semantics in this iteration.
- Reuse the existing markdown renderer for historical versions.

## Future Extensions

- Side-by-side diff between two versions.
- Highlight added or changed sections between versions.
- Pin a version for export.
- Auto-generated change summaries such as `What changed since v3`.

## Shareable Read-Only Recaps

## Summary

Add private share links for session recaps so users can send a polished, read-only view of a session without giving access to their account or edit controls.

This makes the product more attractive because it turns each session into something collaborative and portable: meeting notes can be sent to teammates, writing drafts to editors, and technical sessions to peers or mentors.

## Current State

- Sessions are visible only to the signed-in owner.
- The session detail page already has strong content surfaces: transcript, generated output, metadata, and export.
- There is no way to share a session recap with someone outside the account.

## Problem

Users can generate useful session output, but they cannot easily distribute it.

This creates friction for common workflows such as sharing meeting summaries, asking for feedback on writing, or sending a polished recap to someone who does not use the app.

## Goals

- Let users generate a private read-only share link for a session.
- Make the shared page useful without requiring authentication.
- Keep the shared experience safe, simple, and clearly non-editable.
- Support all session types with the same core recap model.

## Non-Goals

- Real-time collaborative editing.
- Public indexing or discoverable public profiles.
- Fine-grained per-section sharing in the first iteration.
- Anonymous commenting on shared recaps.

## User Stories

- As a user, I can create a share link for a session.
- As a user, I can revoke a share link later.
- As a viewer, I can open the link without signing in.
- As a viewer, I can read the recap but cannot change anything.

## Proposed UX

### Owner flow

Add a `Share` action in the session detail header.

- If no share link exists, the dialog offers `Create link`.
- If a share link exists, the dialog shows the link, `Copy link`, and `Revoke link`.
- The dialog should make it clear that the page is read-only.

### Shared recap page

The shared page should show:

- session title
- session type
- generated output or latest solution
- transcript or a transcript summary/highlights
- created date

The shared page must not show:

- owner-only navigation
- billing controls
- edit actions
- token generation or CLI actions

## Functional Requirements

### Link model

- A session can have zero or one active share link in the MVP.
- Share links must be unguessable.
- Revoking a link immediately disables access.

### Access rules

- Session owners can create, view, copy, and revoke the link.
- Anyone with the active link can view the read-only recap.
- No authentication is required for viewers.

### Shared content

The first iteration should include:

- session metadata
- latest generated output if available
- transcript content or a bounded transcript recap

If a session has no generated output yet, the shared page should still render a useful transcript-first recap.

### Safety and clarity

- The shared page should visibly indicate that it is read-only.
- Sensitive owner actions must be absent from the shared route.
- Revoked or invalid links should render a clear unavailable state.

## API / Data Impact

This feature will likely need new persistence for share links.

Expected additions:

- a table for shared recap links or session share tokens
- owner-side API methods to create, fetch, and revoke the active share link
- a public route or server loader for resolving a share token to recap data

## UI Components Likely Affected

- `web/src/components/sessions/session-live-header.tsx`
- `web/src/app/sessions/[sessionId]/page.tsx`
- new share dialog component
- new public recap page route

## Acceptance Criteria

- An owner can create a share link from a session.
- The link opens a read-only recap without sign-in.
- The shared page does not expose owner-only actions.
- The owner can revoke the link.
- A revoked link no longer works.

## Implementation Notes

- Start with the latest output only; avoid version selection in the shared page MVP.
- Prefer one active link per session for simpler UX and data rules.
- Reuse existing rendering components where possible, but keep the shared page visually distinct from the owner workspace.

## Future Extensions

- link expiration dates
- password-protected shares
- multiple share links per session
- viewer analytics
- branded recap layouts by session type
