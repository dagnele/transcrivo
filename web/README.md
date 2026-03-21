# Cheatcode Web

This directory contains the Bun-managed Next.js app for the Cheatcode web MVP.

## Current stack

- `Next.js`
- `React`
- `TypeScript`
- `shadcn/ui`
- `tRPC`
- `Drizzle`
- `Postgres`

## Getting started

Install dependencies:

```bash
bun install
```

Set up Doppler for this project:

```bash
doppler setup
```

Run the app:

```bash
bun dev
```

Build the app:

```bash
bun run build
```

Open [http://localhost:3000](http://localhost:3000).

## Database

The app expects `DATABASE_URL` to be set.

Example:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/cheatcode_web
```

Drizzle commands:

```bash
bun run db:generate
bun run db:migrate
bun run db:push
bun run db:studio
```

Current schema files:

- `src/server/db/schema.ts`
- `src/server/db/client.ts`
- `drizzle.config.ts`

## WebSocket ingest

The backend now exposes a CLI-compatible WebSocket ingest endpoint at:

```bash
ws://localhost:3000/ws
```

Expected producer flow:

- send `session.start`
- wait for `session.ready` or `session.error`
- stream `transcript.partial` / `transcript.final`
- send `session.stop`

The backend requires the session record to already exist before `session.start`.

## Doppler

The project loads environment variables from Doppler.

Expected secret names include:

- `DATABASE_URL`
- `BETTER_AUTH_URL`
- `AUTH_EMAIL_FROM`
- `RESEND_API_KEY` (optional in local dev, required for real email delivery)

Recommended local flow:

```bash
doppler setup
bun dev
```

When email verification is enabled, local development falls back to logging OTP codes to the server console if `RESEND_API_KEY` is not set.

## Current routes

- `/`
- `/sessions`
- `/sessions/new`
- `/sessions/[sessionId]`
