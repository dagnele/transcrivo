# Transcrivo CLI (Rust)

This directory contains the Rust implementation of the local `transcrivo` CLI for Transcrivo.

## Current status

- `devices` works on Linux and Windows
- `run` works against the websocket backend flow
- Linux live capture supports microphone and system audio
- Windows live capture supports microphone and system audio through WASAPI
- local Whisper transcription is used by `run` when a model is configured

## Common commands

```bash
cargo run -- --help
cargo run -- devices --help
cargo run -- models --help
cargo run -- run --help
```

## Logging

The CLI always writes tracing logs to a rotating file.

- Linux: `$XDG_DATA_HOME/transcrivo/logs` or `~/.local/share/transcrivo/logs`
- Windows: `%LOCALAPPDATA%\Transcrivo\logs`
- Rotation: daily
- Retention: 7 log files

Use `--log-level` to control verbosity:

```bash
cargo run -- --log-level debug devices
cargo run -- --log-level trace run --backend-url ws://127.0.0.1:8080/ws --token test --whisper-model-name small.en
```

## Mock backend

Start the mock websocket backend from `cli/`:

```bash
cargo run --bin mock_backend
```

Use a custom host or port:

```bash
cargo run --bin mock_backend -- --host 127.0.0.1 --port 8080
```

The mock backend accepts the websocket connection, sends `session.ready`, and prints
`session.start`, transcript events, and `session.stop` messages.

## Linux

### Build dependencies

Install these before building on Linux:

- Rust toolchain with `cargo`
- `clang` / `libclang` for `bindgen` used by `whisper-rs-sys`
- `cmake` for bundled `whisper.cpp` sources
- `pkg-config`
- PipeWire development packages for the native capture path

Typical Debian/Ubuntu packages:

```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  clang \
  cmake \
  pkg-config \
  libpipewire-0.3-dev \
  libspa-0.2-dev
```

If you plan to build with `--features whisper-gpu-vulkan`, install the Vulkan development tools too:

```bash
sudo apt-get install -y \
  libvulkan-dev \
  glslc
```

`whisper-rs-sys` configures `whisper.cpp` through CMake, and CMake's Vulkan detection expects `glslc`
to be available on `PATH`.

If `libclang` is not already discoverable, set:

```bash
export LIBCLANG_PATH=/usr/lib/llvm-<version>/lib
```

### Build and checks

From `cli/`:

```bash
cargo check
cargo clippy --all-targets -- -D warnings
cargo test
```

### Run the mock backend and CLI

Terminal 1:

```bash
cargo run --bin mock_backend
```

Terminal 2:

```bash
# list devices first if you want explicit ids
cargo run -- devices

# run against the mock backend
cargo run -- run \
  --backend-url ws://127.0.0.1:8080/ws \
  --token test \
  --whisper-model-name small.en
```

Optional device selection:

```bash
cargo run -- run \
  --backend-url ws://127.0.0.1:8080/ws \
  --token test \
  --whisper-model-name small.en \
  --mic-device <mic-id> \
  --system-device <system-id>
```

### Linux notes

- Linux capture uses the native PipeWire-backed capture path
- `run` requires a backend URL, token, and usable Whisper model configuration
- `whisper-gpu-vulkan` needs Vulkan headers/libraries plus `glslc` on `PATH`

## Windows

### Quick start

Open PowerShell and install the build tools:

```powershell
winget install --id LLVM.LLVM --exact --accept-source-agreements --accept-package-agreements
winget install --id Kitware.CMake --exact --accept-source-agreements --accept-package-agreements
winget install --id KhronosGroup.VulkanSDK --exact --accept-source-agreements --accept-package-agreements
```

You also need Visual Studio 2022 Build Tools or Visual Studio 2022 with the C++ toolchain.

Then start a new PowerShell session and set a short Cargo target directory:

```powershell
$env:CARGO_TARGET_DIR = 'C:\t'
```

Verify Vulkan before trying the Vulkan build:

```powershell
vulkaninfo
```

If `vulkaninfo` reports `Found no drivers!` or cannot create a Vulkan instance, `whisper-gpu-vulkan`
will not work on that machine.

### Build the Vulkan CLI

From `cli/`:

```powershell
cargo build --release --features whisper-gpu-vulkan
```

The short `CARGO_TARGET_DIR` is recommended on Windows for the Vulkan build because it avoids very
long nested paths under `target\`.

### Run the Vulkan CLI

From `cli/`:

```powershell
cargo run --release --features whisper-gpu-vulkan -- run --backend-url ws://127.0.0.1:8080/ws --token test --whisper-model-name small.en
```

### Build and checks

For non-Vulkan checks from `cli/`:

```powershell
cargo check
cargo clippy --all-targets -- -D warnings
cargo test
```

### Run the mock backend and CLI

PowerShell window 1:

```powershell
cargo run --bin mock_backend
```

PowerShell window 2:

```powershell
# list devices first if you want explicit ids
cargo run -- devices

# run against the mock backend
cargo run -- run --backend-url ws://127.0.0.1:8080/ws --token test --whisper-model-name small.en
```

Optional device selection:

```powershell
cargo run -- run --backend-url ws://127.0.0.1:8080/ws --token test --whisper-model-name small.en --mic-device <mic-id> --system-device <system-id>
```

### Windows notes

- Windows capture uses WASAPI for microphone capture and loopback system capture
- `run` requires a backend URL, token, and usable Whisper model configuration
- `whisper-gpu-vulkan` requires both the Vulkan SDK and a working Vulkan-capable driver
- `CARGO_TARGET_DIR='C:\t'` is a practical default for Windows Vulkan builds

## Whisper model configuration

The CLI expects a local ggml Whisper model file when you use `run` for live transcription.

List available models:

```bash
cargo run -- models list
cargo run -- models status
```

By default, models are stored in the standard Transcrivo app data directory:

- Linux: `$XDG_DATA_HOME/transcrivo/models` or `~/.local/share/transcrivo/models`
- Windows: `%LOCALAPPDATA%\Transcrivo\models`

Download a model:

```bash
cargo run -- models download small.en
```

Model lookup options:

```bash
# model name lookup
cargo run -- run \
  --backend-url ws://127.0.0.1:8080/ws \
  --token test \
  --whisper-model-name small.en
```

Linux/macOS shell:

```bash
export TRANSCRIVO_WHISPER_MODEL_DIR=/absolute/path/to/models
export TRANSCRIVO_WHISPER_MODEL_PATH=/absolute/path/to/ggml-small.en.bin
```

PowerShell:

```powershell
$env:TRANSCRIVO_WHISPER_MODEL_DIR = 'C:\path\to\models'
$env:TRANSCRIVO_WHISPER_MODEL_PATH = 'C:\path\to\ggml-small.en.bin'
```

Lookup order:

- `TRANSCRIVO_WHISPER_MODEL_PATH`
- `TRANSCRIVO_WHISPER_MODEL_DIR/ggml-<model>.bin`
- standard Transcrivo models directory
- `./ggml-<model>.bin`

## Optional GPU build

The Rust CLI exposes Vulkan-backed Whisper support through the `whisper-gpu-vulkan` feature.

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

Windows PowerShell example:

```powershell
$env:CARGO_TARGET_DIR = 'C:\t'
cargo run --features whisper-gpu-vulkan -- run --backend-url ws://127.0.0.1:8080/ws --token test --whisper-model-name small.en
```

Notes:

- `whisper-gpu-vulkan` enables `whisper-rs` Vulkan support
- you still need working Vulkan drivers/runtime on the host system
- if Vulkan is unavailable or misconfigured, build or runtime initialization may fail
- verify Vulkan availability with `vulkaninfo` before expecting the feature to work

## Real model smoke test

There is also an opt-in integration-style smoke test for the real Whisper backend:

```bash
export TRANSCRIVO_WHISPER_SMOKE_MODEL_PATH=/absolute/path/to/ggml-small.en.bin
cargo test real_whisper_backend_smoke_test --test transcribe -- --ignored
```

The smoke test uses generated mono 16 kHz audio and only verifies that the real backend loads the
model and completes inference successfully.

This project is intentionally built in parallel with the existing Python CLI under `cli/` until the
Rust version reaches parity.
