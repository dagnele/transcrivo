# Polar session purchases

## Overview

Integrate Polar so users can buy session credits for Transcrivo.

- One successful purchase grants exactly one paid session credit.
- A paid session has a fixed price configured in Polar.
- Users with no remaining paid session credits may still create one free trial session capped at 5 minutes.
- The free trial is a one-time onboarding benefit per user lifetime.

This spec covers the first version of checkout, entitlement tracking, webhook reconciliation, and session access enforcement.

## Goals

- Let authenticated users purchase session credits through Polar checkout.
- Unlock session usage based on owned credits.
- Allow each user to create one free 5-minute trial session before they need to buy a session.
- Keep billing state authoritative on our side after Polar confirms payment.
- Prevent users from starting unlimited sessions without payment.

## Non-goals

- Subscriptions or recurring billing.
- Variable pricing by session type.
- Seat-based billing.
- Refund automation.
- Team/shared credit pools.

## Product decisions

### Billing model

- The sellable unit is `1 purchased session credit`.
- The price is fixed and managed as a Polar one-time product.
- Purchased credits do not expire in v1.
- A credit is consumed when a session actually starts, not when a draft session is created.

### Trial model

- Each user may create at most one free trial session in their lifetime.
- The free trial is only available when the user has no remaining purchased credits.
- The free trial allows a live session for up to 5 minutes of session runtime.
- After 5 minutes, the session is stopped and the UI explains that a paid session is required to continue.

### Session access rules

- Users may create at most one trial session without a purchased credit.
- Trial eligibility is consumed when the trial session is created.
- Starting a live session requires either:
  - at least one unused purchased session credit, or
  - a previously created trial session with remaining free-trial entitlement.
- When a paid session starts, one purchased credit is reserved immediately and marked consumed.
- When a trial session starts, it runs in free-trial mode for up to 5 minutes.
- If session start fails before the session reaches `live`, the reserved entitlement should be released.

## User stories

- As a new user, I can try one short session for free before paying.
- As a returning user, I can buy a session credit with Polar and use it later.
- As a paying user, I can clearly see how many session credits I have left.
- As the system, I can trust webhooks to confirm purchases and update credits safely.

## UX flow

### Purchase

- The app shows a `Buy session` CTA in the sessions area.
- Clicking it opens a Polar embedded checkout or redirects to Polar checkout.
- On successful purchase, the app refreshes entitlement state and shows the new balance.

### Session start

- If the user has a purchased credit, session start proceeds normally.
- If the user has already created a trial session and still has free trial time available, session start proceeds in `trial` mode.
- If the user has neither, the UI blocks session start and prompts purchase.

### Session dialog

- The session creation dialog should show the user's current session availability.
- It should clearly display the number of available purchased sessions.
- It should indicate whether the one trial session is still available or already used.
- If no paid sessions are available and the trial is still unused, the dialog should explain that the next created session will be a `Free trial (5 min)` session.
- If neither paid sessions nor trial availability remain, the dialog should show a purchase CTA before the user can proceed.

### Trial countdown

- Trial sessions show remaining free time in the live session UI.
- At 1 minute remaining, the UI warns the user that the trial is ending.
- At 0 remaining, the backend ends the session and emits the normal session stop lifecycle.

## Polar integration

### Polar objects

- Create one Polar product for `Single Session`.
- Configure it as a one-time purchase with a fixed amount.
- Store the Polar product ID in env for server-side checkout creation.

### Checkout creation

- The web app creates checkout sessions server-side using Polar API.
- Checkout metadata must include at minimum:
  - `userId`
  - `grantType=session_credit`
  - optional `source=web`
- The checkout should include success and return URLs back into the app.

### Webhook confirmation

- Polar webhooks are the source of truth for granting credits.
- We only grant a credit after receiving a successful checkout/order event from Polar.
- Webhook handling must verify signatures.
- Webhook handling must be idempotent.

## Data model

### New tables

Do not add billing or trial columns to the existing `user` table. All Polar, entitlement, and free-trial state must live in external tables linked by `user_id`.

#### `billing_orders`

Tracks Polar checkout/order lifecycle for reconciliation.

- `id`
- `user_id`
- `polar_checkout_id` unique
- `polar_order_id` unique nullable
- `polar_product_id`
- `status` enum: `created | paid | failed | refunded`
- `amount`
- `currency`
- `metadata` jsonb nullable
- `created_at`
- `updated_at`

#### `session_entitlements`

Tracks both paid credits and the free trial.

- `id`
- `user_id`
- `kind` enum: `purchased | free_trial`
- `source_order_id` nullable
- `status` enum: `available | reserved | consumed | released | expired`
- `session_id` nullable
- `granted_at`
- `reserved_at` nullable
- `consumed_at` nullable
- `released_at` nullable
- `expires_at` nullable
- `meta` jsonb nullable

#### `user_billing_profiles`

Stores user-level billing identity without modifying the auth `user` table.

- `id`
- `user_id` unique
- `polar_customer_id` unique nullable
- `trial_session_id` nullable
- `trial_session_created_at` nullable
- `trial_started_at` nullable
- `trial_ended_at` nullable
- `created_at`
- `updated_at`

This table is the external source for one-per-user billing state such as whether the user already created their single allowed trial session and, later, any Polar customer linkage.

### Derived user state

The app should derive these values efficiently:

- `availablePurchasedSessions`
- `trialSessionCreationAvailable`
- `freeTrialAvailable`
- `canStartSession`
- `nextRequiredAction` = `start_trial | buy_session | start_paid_session`

## Backend changes

### Contracts

Add a billing/session-credit contract layer in `web/src/lib/contracts/` for:

- entitlement summary
- checkout creation input/output
- webhook event normalization

### API

Add protected procedures for:

- `billing.entitlements` - return current session credit summary
- `billing.createCheckout` - create a Polar checkout session for one session credit

Add an unauthenticated webhook route for Polar that:

- reads raw request body
- verifies Polar webhook signature
- persists webhook/order state idempotently
- grants one purchased entitlement when payment succeeds

### Session enforcement

Before creating a CLI token or before transitioning a session into `live`, enforce entitlement rules.

Recommended v1 rule:

- Block `session.createToken` if the user lacks an available entitlement.
- Reserve the entitlement during token creation.
- Finalize consumption on `session.started`.
- Release the reservation if the session never starts or fails early.

This keeps billing tied to actual live usage while fitting the current server flow.

## Frontend changes

- Show entitlement balance in the sessions shell/sidebar.
- Add a `Buy session` button near the empty state and live-session entry points.
- Update the session creation dialog to surface available purchased sessions and trial availability.
- Show whether the user can still create `Free trial (5 min)` or must start a `Paid session`.
- For blocked users, replace the normal start action with purchase messaging.
- In live trial sessions, show countdown and upgrade CTA.

## Webhook events

The implementation should subscribe to the Polar events needed to safely grant one-time purchases. Exact event names should be verified against the Polar account configuration during implementation, but v1 should support:

- checkout/order success
- checkout/order failure or expiration
- refund, if enabled later

Webhook processing rules:

- Ignore duplicate deliveries.
- Ignore unsupported product IDs.
- Reject invalid signatures.
- Log every event with Polar IDs for auditability.

## Failure and edge cases

- If checkout succeeds client-side but webhook is delayed, show `Payment processing` and poll entitlement status.
- If webhook is delivered twice, do not grant two credits.
- If a reserved paid entitlement is tied to a session that never starts, release it via timeout or failure handling job.
- If a user buys a credit during an active free trial, the current trial still ends at 5 minutes in v1; the purchased credit applies to the next session.

## Metrics

Track at minimum:

- checkout created
- checkout succeeded
- entitlement granted
- free trial started
- free trial exhausted
- paid session started
- paid entitlement release rate

## Environment variables

Expected new env vars in `web/`:

- `POLAR_ACCESS_TOKEN`
- `POLAR_WEBHOOK_SECRET`
- `POLAR_SESSION_PRODUCT_ID`
- `POLAR_ENVIRONMENT` = `sandbox | production`
- `APP_BASE_URL` if not already available centrally

## Rollout plan

1. Add schema and contracts for billing orders and entitlements.
2. Implement Polar checkout creation.
3. Implement webhook verification and entitlement granting.
4. Enforce entitlement checks in session start flow.
5. Add UI for balance, purchase, and trial messaging.
6. Test sandbox purchase, duplicate webhook delivery, and trial cutoff.

## Detailed execution plan

### Phase 1 - Contracts and database

Add the shared billing contracts and persistence model first so API and UI can build on stable shapes.

- Update `web/src/server/db/schema.ts` to add:
  - `billing_orders`
  - `session_entitlements`
  - `user_billing_profiles`
  - exported enum value lists and inferred select/insert types
- Add a new contract file at `web/src/lib/contracts/billing.ts` for:
  - entitlement summary schema
  - checkout creation input/output schema
  - billing order status and entitlement status enums
  - optional Polar webhook normalization schema used internally
- Keep `web/src/server/db/auth-schema.ts` unchanged; billing state must stay external to the auth `user` table.
- Generate a migration after schema changes using the existing Drizzle flow.

### Phase 2 - Billing service layer

Create a focused server-side billing module so the router and webhook route do not embed business logic inline.

- Add a new service file at `web/src/server/billing.ts` or split into:
  - `web/src/server/billing/entitlements.ts`
  - `web/src/server/billing/polar.ts`
  - `web/src/server/billing/webhooks.ts`
- Implement helpers for:
  - loading the user's entitlement summary
  - creating or finding `user_billing_profiles`
  - creating a Polar checkout session for the configured session product
  - recording `billing_orders`
  - granting one purchased entitlement idempotently
  - reserving, consuming, and releasing entitlements
  - creating and tracking the single trial session
- Reuse `web/src/server/db/client.ts` for database access and `web/src/server/logger.ts` for structured webhook and billing logs.

### Phase 3 - API surface

Expose billing state to the UI and checkout creation through tRPC.

- Add a new router file `web/src/server/api/routers/billing.ts`.
- Register it in `web/src/server/api/root.ts` as `billing`.
- Add protected procedures in `web/src/server/api/routers/billing.ts`:
  - `billing.entitlements`
  - `billing.createCheckout`
- Use `web/src/server/api/trpc.ts` protected procedures so checkout creation always has an authenticated user context.
- Return data validated through `web/src/lib/contracts/billing.ts`.

### Phase 4 - Polar webhook endpoint

Add a public route that validates Polar signatures and reconciles payment state.

- Add a new route handler at `web/src/app/api/polar/webhooks/route.ts`.
- The route should:
  - read the raw request body
  - validate the webhook signature with `POLAR_WEBHOOK_SECRET`
  - normalize the event payload
  - upsert `billing_orders`
  - grant one purchased entitlement on successful payment events
  - be idempotent for duplicate deliveries
- Keep the webhook logic in the billing service layer rather than in the route file itself.
- Add focused tests for webhook idempotency and entitlement granting; likely new test files under `web/src/server/` next to the billing services.

### Phase 5 - Session creation and trial rules

Enforce the updated rule that a user may create exactly one trial session when they have no paid sessions available.

- Update `web/src/server/api/routers/session.ts` `create` mutation so it:
  - loads the entitlement summary before creating the session
  - allows creation if the user has available purchased sessions, or if they can still create their one trial session
  - marks the created session as trial-backed when it is the user's single free trial session
  - blocks creation and returns a clear error when neither paid sessions nor trial availability remain
- Extend `web/src/lib/contracts/session.ts` only as needed to expose session-level billing flags to the UI, for example whether a session is a trial session.
- If needed, add trial-related columns to `sessions` in `web/src/server/db/schema.ts`, such as:
  - `access_kind` enum: `paid | trial`
  - `trial_ends_at` nullable
  These are session attributes, not user billing state, so they still fit the constraint of keeping user billing data external.

### Phase 6 - Session start enforcement and lifecycle reconciliation

Tie actual usage to billing state once the CLI token is created and the session starts.

- Update `web/src/server/api/routers/session.ts` `createToken` mutation to:
  - verify that the session is allowed to start
  - reserve one purchased entitlement for paid sessions before returning a CLI token
  - skip paid reservation for a valid trial session
- Update `web/src/server/api/session-event-ingest.ts` so `session.started`, `session.ended`, and `session.failed` events reconcile entitlement state:
  - consume the reserved paid entitlement on `session.started`
  - release the reservation if the session fails before becoming live
  - end trial sessions automatically at the configured 5-minute limit
- Update `web/src/server/session-lifecycle.ts` so trial sessions use a 5-minute expiration window instead of the normal session duration.
- If a separate reconciliation helper is needed, add it under `web/src/server/` near `web/src/server/session-reconciliation.ts`.

### Phase 7 - Server-rendered data wiring

Load entitlement state in the sessions layout so the dialog and sidebar can render immediately.

- Update `web/src/app/sessions/layout.tsx` to fetch `billing.entitlements` alongside the session list.
- Pass the entitlement summary into `web/src/components/sessions/sessions-shell.tsx`.
- Optionally update `web/src/app/sessions/page.tsx` to improve the empty state copy when the user has no session availability.
- Optionally update `web/src/app/sessions/[sessionId]/page.tsx` if the detail page needs trial-specific server data on first render.

### Phase 8 - Session dialog and purchase UX

Surface the new billing state directly in the session creation flow.

- Update `web/src/components/sessions/sessions-shell.tsx` create-session dialog to show:
  - number of available purchased sessions
  - whether the one trial session is still available
  - whether the next session creation will consume the free trial
  - a disabled or replaced create action when the user must buy a session first
- Add a `Buy session` action in `web/src/components/sessions/sessions-shell.tsx` that uses `billing.createCheckout`.
- If embedded Polar checkout is used, add the client integration in the same component or extract a dedicated component such as `web/src/components/billing/buy-session-button.tsx`.
- Update `web/src/components/sessions/cli-setup-dialog.tsx` to explain whether the selected session is trial-backed or paid-backed, especially if token generation is blocked.

### Phase 9 - Live session trial UX

Make trial runtime and cutoff visible while the session is active.

- Update `web/src/components/sessions/session-live-view.tsx` to:
  - detect trial sessions
  - render remaining free time
  - show warning state near the last minute
  - refresh relevant billing/session queries when the session state changes
- Update `web/src/components/sessions/session-live-header.tsx` if needed to display a trial badge or countdown summary.
- Keep the UI messaging aligned with the server-enforced 5-minute stop rule.

### Phase 10 - Env, dependencies, and verification

Finish the integration by wiring Polar configuration and validating the full flow.

- Update `web/package.json` if a Polar SDK package is added.
- Document required env vars where appropriate and wire:
  - `POLAR_ACCESS_TOKEN`
  - `POLAR_WEBHOOK_SECRET`
  - `POLAR_SESSION_PRODUCT_ID`
  - `POLAR_ENVIRONMENT`
  - `APP_BASE_URL`
- Run the normal web checks after implementation:
  - `bun run lint`
  - `bunx tsc --noEmit`
  - `bun run build`
- Verify manually in Polar sandbox:
  - create checkout
  - complete payment
  - receive webhook
  - see purchased session balance update
  - create the single trial session for a fresh user
  - confirm second unpaid session creation is blocked
  - confirm trial session ends after 5 minutes

## Open questions

- Should refunded orders revoke an unused purchased entitlement automatically?
- Should users be allowed to upgrade an active free trial into a paid session without ending the current session?
- Should admins have a manual way to grant or restore session credits?
