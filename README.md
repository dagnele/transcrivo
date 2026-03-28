# Transcrivo

Transcrivo is a live transcript companion with AI assistance.

Unless otherwise noted, the original code in this repository is source-available
under the Business Source License 1.1 in `LICENSE`.

It captures a conversation in real time, streams transcript events to a web app, and turns those events into a structured session history plus AI-generated assistance grounded in the transcript. The project is split into a local CLI and a web application that share the same session protocol.

## Use Case

- Start a session in the web app
- Run the local CLI during a live conversation
- Capture microphone and system/interviewer audio
- Stream transcript events to the backend over WebSocket
- Review the live transcript, session timeline, and AI output in the browser

This is useful when you want a grounded, real-time companion that can follow what was said and help turn it into something more useful, such as structured notes, evolving solutions, or other transcript-aware assistance.

## How It Works

- The `web/` app manages sessions, persists events, exposes a CLI-compatible websocket ingest endpoint, and renders the live UI.
- The `cli/` app handles local device discovery, audio capture, transcription, model management, and websocket transport.
- Transcript and lifecycle events flow between both apps using shared protocol terms such as `session.start`, `session.ready`, `transcript.partial`, `transcript.final`, and `session.stop`.
- AI output is derived from stored session events, so behavior changes that touch contracts or semantics should be checked against `specs/`.

## Structure

- `cli/` - Rust CLI for audio capture, transcription, model management, and websocket transport
- `web/` - Bun + Next.js app for sessions, storage, ingest, and generated solutions
- `specs/` - product and protocol notes
- `AGENTS.md` - concise instructions for coding agents

## Where To Look

- Read `web/README.md` for web setup, database, routes, and websocket ingest details.
- Read `cli/README.md` for CLI runtime flows, whisper model setup, and platform-specific notes.
- Read `AGENTS.md` for build/test commands and repo conventions used by coding agents.

## License

See `LICENSE` for details. Trademarks are covered in `TRADEMARKS.md`.
