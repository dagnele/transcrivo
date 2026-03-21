# Writing and Meeting Summary Session Types

## Status

- Proposed.

## Context

The product currently supports two session types:

- `coding`
- `system_design`

Those types already affect multiple parts of the web app:

- shared validation and API contracts
- database enum usage
- session creation and edit UI
- transcript/live session labels
- AI prompt construction and output shape

We want to add two new broadly useful session types that work well with spoken input:

- `writing`
- `meeting_summary`

These are not interview-specific modes. They should let a user speak naturally while the AI produces either polished written output or structured meeting notes.

## Goals

- Add `writing` as a first-class session type.
- Add `meeting_summary` as a first-class session type.
- Keep `coding` as the only session type that requires a coding language.
- Make the AI output materially different for each new type.
- Keep session creation, editing, listing, and live views consistent with the new types.
- Document all web files that need to change.

## Non-Goals

- Changing the CLI websocket protocol.
- Adding a separate concept such as `focus`, `tag`, or `template` in this change.
- Redesigning the live session layout.
- Introducing custom output templates per user.
- Renaming existing session types.

## Product Definitions

### `writing`

`writing` is a general drafting mode.

The user speaks rough thoughts, partial sentences, or loosely structured ideas. The AI infers the likely writing intent and turns the transcript into clear written output.

Typical use cases:

- drafting documentation
- writing a spec or proposal
- drafting an email or announcement
- turning bullet thoughts into paragraphs
- cleaning up stream-of-consciousness notes

Default behavior:

- do not require a coding language
- infer the likely purpose and audience from the transcript when possible
- produce a polished draft, not just a summary
- preserve user intent and tone when reasonably clear
- briefly note assumptions when the transcript is ambiguous

Suggested default output shape:

1. `## Intent`
2. `## Draft`
3. `## Notes`

### `meeting_summary`

`meeting_summary` is a transcript-to-notes mode.

The user speaks during or after a conversation, and the AI turns the transcript into structured notes instead of a solution or draft.

Typical use cases:

- team standups
- project syncs
- stakeholder meetings
- discovery calls
- personal voice notes after a conversation

Default behavior:

- do not require a coding language
- focus on extracting structure from the transcript
- identify decisions, actions, blockers, and open questions when present
- avoid inventing attendees, deadlines, or commitments that are not supported by the transcript
- say briefly when details are inferred or incomplete

Suggested default output shape:

1. `## Summary`
2. `## Decisions`
3. `## Action Items`
4. `## Risks / Blockers`
5. `## Open Questions`

## Session Type Rules

The valid session types become:

- `coding`
- `system_design`
- `writing`
- `meeting_summary`

Language rules become:

- `coding` requires a non-null `language`
- `system_design` requires `language = null`
- `writing` requires `language = null`
- `meeting_summary` requires `language = null`

## UX Requirements

### Session creation and editing

The session type picker must include:

- Coding
- System design
- Writing
- Meeting summary

The coding language picker must behave as follows:

- enabled only when type is `coding`
- disabled for `system_design`
- disabled for `writing`
- disabled for `meeting_summary`

If a user switches from `coding` to a non-coding type, the submitted value must be normalized to `language = null`.

If a user switches from a non-coding type back to `coding`, the UI may restore the previously selected language or the default coding language.

### Session list and live header

Anywhere the UI currently shows `type / language`, it must continue to show the language only for `coding` sessions.

This already matches the intended behavior in the current UI and should remain true after the new types are added.

### Live output pane

No layout change is required for this change.

The existing right-hand pane may continue using the current component structure, but its generated content must be tailored by session type.

Optional follow-up:

- rename the pane heading from `Solution` to a more generic label such as `Output`

## AI Behavior Requirements

## General

The prompt builder in `web/src/server/ai/session-solution-service.ts` must branch by session type and provide different instructions for each type.

All session types should continue to:

- return Markdown only
- avoid raw HTML
- remain concise and practical
- acknowledge transcript ambiguity briefly when needed

### `coding`

No product behavior change beyond ensuring the new enum values do not break existing logic.

### `system_design`

No product behavior change beyond ensuring the new enum values do not break existing logic.

### `writing`

Prompt requirements:

- describe the session as a writing session
- instruct the model to infer the likely writing goal from the transcript
- ask for polished written output, not just a recap of what was said
- preserve tone and intent when possible
- mention assumptions briefly if key context is missing

Default output shape:

1. `## Intent`
2. `## Draft`
3. `## Notes`

### `meeting_summary`

Prompt requirements:

- describe the session as a meeting summary session
- instruct the model to extract structure from the transcript
- prefer explicit facts over inferred details
- identify decisions and action items only when supported by the transcript
- keep notes scannable and operational

Default output shape:

1. `## Summary`
2. `## Decisions`
3. `## Action Items`
4. `## Risks / Blockers`
5. `## Open Questions`

## Data Model Changes

### Shared contracts

Update the shared session type enum and validation rules in:

- `web/src/lib/contracts/session.ts`

Changes required:

- add `writing` and `meeting_summary` to `sessionTypeValues`
- update refinement so only `coding` permits and requires a language
- ensure all other session types require `language = null`

### Database schema

Update enum-backed session type usage in:

- `web/src/server/db/schema.ts`

Changes required:

- ensure the Drizzle table type enum includes the two new values through the shared contract export

### Drizzle SQL and metadata

Add a new migration and snapshot updates in:

- `web/drizzle/*.sql`
- `web/drizzle/meta/*.json`

Changes required:

- generate a migration that updates the session type enum usage in Postgres
- update the latest Drizzle snapshot metadata
- update `web/drizzle/meta/_journal.json`

Note:

- use the actual generated migration filenames rather than manually inventing final names unless necessary

## Web Files To Touch

### Contracts and shared config

- `web/src/lib/contracts/session.ts`
  - add the two new session types
  - tighten language validation so only `coding` has a language

- `web/src/lib/session-config.ts`
  - add labels for `Writing` and `Meeting summary`

### Database

- `web/src/server/db/schema.ts`
  - pick up the expanded session type enum from shared contracts

- `web/drizzle/<new_migration>.sql`
  - apply the database change for the new session type values

- `web/drizzle/meta/0001_snapshot.json` or newer generated snapshot
  - reflect the updated schema state

- `web/drizzle/meta/_journal.json`
  - register the new migration entry

### Session UI

- `web/src/components/sessions/sessions-shell.tsx`
  - expose the new type options in create/edit flows
  - keep language normalization correct when changing type
  - disable language selection for all non-coding types using `type !== "coding"`

- `web/src/components/sessions/session-live-view.tsx`
  - keep the language badge/header display limited to `coding`
  - verify labels render correctly for the new types

### AI generation

- `web/src/server/ai/session-solution-service.ts`
  - add session-specific prompt instructions for `writing`
  - add session-specific prompt instructions for `meeting_summary`
  - keep existing `coding` and `system_design` behavior intact
  - update the expected Markdown output shape by session type

## Files Reviewed For This Spec

The current behavior referenced by this spec was inspected in:

- `web/src/lib/contracts/session.ts`
- `web/src/lib/session-config.ts`
- `web/src/components/sessions/sessions-shell.tsx`
- `web/src/components/sessions/session-live-view.tsx`
- `web/src/server/ai/session-solution-service.ts`
- `web/src/server/db/schema.ts`
- `web/src/server/api/routers/session.ts`

## Implementation Plan

### Phase 1: Contract and schema updates

1. Extend the session type enum with `writing` and `meeting_summary`.
2. Update session language refinement so only `coding` requires a language.
3. Regenerate or add the Drizzle migration for the new enum values.
4. Update schema snapshots and migration journal.

### Phase 2: UI updates

1. Add the new types to the session type option list.
2. Update create/edit session forms so the language select is enabled only for `coding`.
3. Verify session list and live view labels remain correct.

### Phase 3: AI prompt updates

1. Add `writing` prompt constraints and output shape.
2. Add `meeting_summary` prompt constraints and output shape.
3. Keep type-specific instructions explicit and easy to extend later.

### Phase 4: Verification

1. Create one `writing` session and confirm `language = null`.
2. Create one `meeting_summary` session and confirm `language = null`.
3. Confirm `coding` still requires a language.
4. Confirm the new types appear correctly in list and live views.
5. Confirm generated Markdown shape differs by type.

Suggested commands:

- `cd web && bun run lint`
- `cd web && bunx tsc --noEmit`
- `cd web && bun run build`

## Open Questions

- Should the right-hand pane title remain `Solution` for non-coding sessions, or should that become a generic label in a follow-up?
- Should `writing` eventually support optional sub-modes such as `email`, `spec`, or `announcement`, or remain fully generic for now?
