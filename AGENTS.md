# Transcrivo Agent Guide

- Source of truth for coding agents in this repo.
- No `.cursorrules`, `.cursor/rules/`, or `.github/copilot-instructions.md` exist.
- Read `specs/` before changing product behavior or protocol semantics.

## Repo
- `cli/`: Rust CLI for audio capture, transcription, model management, and websocket transport.
- `web/`: Bun + Next.js 16 + React 19 + TypeScript + tRPC + Drizzle + Postgres.
- Cross-app changes must keep contracts aligned between `cli/` and `web/`.

## Commands
- Web install/dev/build: `cd web && bun install`, `bun dev`, `bun run build`, `bun start`
- Web checks: `cd web && bun run lint`, `bunx tsc --noEmit`, `bunx eslint src/app/page.tsx`
- Web db: `cd web && bun run db:generate`, `bun run db:migrate`, `bun run db:push`, `bun run db:studio`
- CLI build/checks: `cd cli && cargo build`, `cargo fmt --all`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test`
- CLI help/runtime: `cd cli && cargo run -- --help`, `cargo run -- devices`, `cargo run -- models list`, `cargo run -- run --backend-url ws://127.0.0.1:8080/ws --token test --whisper-model-name small.en`
- Single Rust test by name: `cd cli && cargo test backend_url_accepts_websocket_urls`
- Single integration file: `cd cli && cargo test --test websocket_client`
- Single test in file: `cd cli && cargo test --test websocket_client connect_send_and_receive_ready`
- Ignored smoke test: `cd cli && TRANSCRIVO_WHISPER_SMOKE_MODEL_PATH=/abs/path/to/ggml-small.en.bin cargo test real_whisper_backend_smoke_test --test transcribe -- --ignored`
- There is no dedicated web test runner yet; for web changes, usually run lint + type-check + build.

## Style
- Prefer small, focused changes; avoid broad formatting-only diffs.
- Follow existing local patterns over generic framework advice.
- TypeScript is `strict`; use explicit types when inference hides intent.
- Reuse shared Zod contracts from `web/src/lib/contracts/*`; validate unknown input at boundaries.
- Preserve tRPC `.input()` / `.output()` patterns and parse DB results back through schemas.
- Reuse Drizzle enums/value lists from shared contracts; use `.returning()` for inserted/updated rows.
- Use `@/*` imports in `web/`; keep imports grouped as external, blank line, app imports, then side-effect CSS.
- Use Server Components by default; add `"use client"` only when needed.
- This is not the old Next.js: check `node_modules/next/dist/docs/` before changing routing, metadata, config, or server behavior.
- Preserve existing shadcn/radix-nova UI patterns; avoid gratuitous reformatting in `web/src/components/ui/`.
- Rust: let `rustfmt` format, use `snake_case` for functions/tests, `CamelCase` for types, and explicit module exports.
- Rust errors: prefer `anyhow::{Result, Context, bail}` at boundaries and `thiserror::Error` for reusable domain errors.
- Rust logging: use `tracing`; reserve `println!`/`eprintln!` for intentional CLI output.
- Avoid `unwrap()` in production code; tests should use clear `expect(...)` messages.

## Notes
- `web/` uses Doppler and expects env like `DATABASE_URL`; AI code also reads OpenRouter env vars.
- `cli/` may require a local whisper model; Linux uses PipeWire and Windows capture is still incomplete.
- Keep protocol terms consistent: `session.start`, `session.ready`, `transcript.partial`, `transcript.final`, `session.stop`.
- When unsure, read the nearest contract, schema, or test first.
