#!/bin/sh

set -eu

backend="cpu"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --backend)
      if [ "$#" -lt 2 ]; then
        printf '%s\n' "error: --backend requires a value (cpu, vulkan, or cuda)" >&2
        exit 1
      fi
      backend="$2"
      shift 2
      ;;
    *)
      printf '%s\n' "error: unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

case "$backend" in
  cpu) asset_name="transcrivo-linux-x86_64-cpu" ;;
  vulkan) asset_name="transcrivo-linux-x86_64-vulkan" ;;
  cuda) asset_name="transcrivo-linux-x86_64-cuda" ;;
  *)
    printf '%s\n' "error: unsupported backend '$backend' (expected cpu, vulkan, or cuda)" >&2
    exit 1
    ;;
esac

if [ "$(uname -s)" != "Linux" ]; then
  printf '%s\n' "error: this installer is for Linux. Use install.ps1 on Windows." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  printf '%s\n' "error: curl is required to install Transcrivo" >&2
  exit 1
fi

install_dir="${TRANSCRIVO_INSTALL_DIR:-$HOME/.local/bin}"
install_path="$install_dir/transcrivo"
download_url="https://github.com/dagnele/transcrivo/releases/latest/download/$asset_name"
tmp_path="$(mktemp "${TMPDIR:-/tmp}/transcrivo.XXXXXX")"

cleanup() {
  rm -f "$tmp_path"
}

trap cleanup EXIT INT TERM

mkdir -p "$install_dir"

printf '%s\n' "Downloading $asset_name..."
curl -fsSL "$download_url" -o "$tmp_path"

chmod 0755 "$tmp_path"
mv "$tmp_path" "$install_path"

printf '\nInstalled Transcrivo to %s\n' "$install_path"
case ":$PATH:" in
  *":$install_dir:"*)
    printf '%s\n' "The install directory is already on your PATH."
    ;;
  *)
    printf '%s\n' "Add this to your shell profile if you want to run 'transcrivo' directly:"
    printf '  export PATH="%s:$PATH"\n' "$install_dir"
    ;;
esac

printf '%s\n' "Run 'transcrivo --help' to verify the installation."
