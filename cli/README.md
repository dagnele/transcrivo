# Cheatcode CLI (Rust)

This directory contains the Rust implementation of the local `cheatcode` CLI.

Current status:

- `devices` discovers real audio devices on Linux and Windows
- `run` works against the mock/backend websocket flow
- Linux live audio capture is wired for mic and system audio
- Rust transcription is wired through `run` when a whisper model is configured
- Windows discovery is implemented, but Windows native capture is not wired yet

Common commands:

```bash
cargo run -- --help
cargo run -- devices --help
cargo run -- models --help
cargo run -- run --help
```

## Platform status

- Linux:
  - `devices` works
  - `run` works with live mic + system capture
- Windows:
  - `devices` works
  - `run` is not ready yet because Windows native audio capture is still placeholder-backed

## Start the mock backend

The local mock backend lives in `cli/scripts/mock_backend.py`.

From the repository root:

```bash
cd cli
uv run python scripts/mock_backend.py --host 127.0.0.1 --port 8080 --path /ws --pretty
```

There is also a Rust version with the same default address:

```bash
cd cli-rs
cargo run --bin mock_backend
```

Optional arguments:

```bash
cargo run --bin mock_backend -- --host 127.0.0.1 --port 8080
```

The mock backend accepts the websocket connection, sends `session.ready`, and prints `session.start`, transcript events, and `session.stop` messages.

## Start the Rust CLI against the mock backend

On Linux, from `cli-rs/`:

```bash
# list devices first if you want explicit IDs
cargo run -- devices

# run against the mock backend
cargo run -- run \
  --backend-url ws://127.0.0.1:8080/ws \
  --token test \
  --whisper-model-name small.en
```

Notes:

- `run` now requires a backend URL and token even when using the mock backend
- `run` also requires a usable whisper model configuration
- if you want specific devices, add `--mic-device <id>` and `--system-device <id>`

On Windows:

- you can use `cargo run -- devices` today
- do not expect `cargo run -- run ...` to work yet until Windows capture is implemented

## Whisper model configuration

The Rust CLI expects a local ggml whisper model file when you use `run` for live transcription.

You can list available models with:

```bash
cargo run -- models list
cargo run -- models status
```

By default, models are stored in the standard Cheatcode app data directory:

- Linux: `$XDG_DATA_HOME/cheatcode/models` or `~/.local/share/cheatcode/models`
- Windows: `%LOCALAPPDATA%\Cheatcode\models`

Download a model with:

```bash
cargo run -- models download small.en
```

You can configure model lookup in these ways:

```bash
# model name lookup
cargo run -- run \
  --backend-url ws://127.0.0.1:8080/ws \
  --token test \
  --whisper-model-name small.en

# explicit environment-based lookup
export CHEATCODE_WHISPER_MODEL_DIR=/absolute/path/to/models
export CHEATCODE_WHISPER_MODEL_PATH=/absolute/path/to/ggml-small.en.bin
```

Lookup order:

- `CHEATCODE_WHISPER_MODEL_PATH`
- `CHEATCODE_WHISPER_MODEL_DIR/ggml-<model>.bin`
- standard Cheatcode models directory
- `./ggml-<model>.bin`

## Build or run with Vulkan

The Rust CLI exposes Vulkan-backed whisper support through the `whisper-gpu-vulkan` feature.

Build:

```bash
cargo build --features whisper-gpu-vulkan
```

Run:

```bash
cargo run --features whisper-gpu-vulkan -- run \
  --backend-url ws://127.0.0.1:8080/ws \
  --token test \
  --whisper-model-name small.en
```

Notes:

- `whisper-gpu-vulkan` enables `whisper-rs` Vulkan support
- you still need working Vulkan drivers/runtime on the host system
- if Vulkan is unavailable or misconfigured, build or runtime initialization may fail

## Real model smoke test

There is also an opt-in integration-style smoke test for the real whisper backend:

```bash
export CHEATCODE_WHISPER_SMOKE_MODEL_PATH=/absolute/path/to/ggml-small.en.bin
cargo test real_whisper_backend_smoke_test --test transcribe -- --ignored
```

The smoke test uses generated mono 16 kHz audio and only verifies that the real backend loads the model and completes inference successfully.

## Linux capture note

On Linux, audio capture uses native PipeWire-backed capture plus PipeWire discovery tooling.

This project is intentionally built in parallel with the existing Python CLI under `cli/` until the Rust version reaches parity.
