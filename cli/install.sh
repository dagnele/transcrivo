#!/bin/bash
set -e

BACKEND="cpu"
INSTALL_DIR="$HOME/.local/bin"

while [[ $# -gt 0 ]]; do
  case $1 in
    --backend)
      BACKEND="$2"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

case "$BACKEND" in
  cpu) ASSET_NAME="transcrivo-linux-x86_64-cpu" ;;
  vulkan) ASSET_NAME="transcrivo-linux-x86_64-vulkan" ;;
  cuda) ASSET_NAME="transcrivo-linux-x86_64-cuda" ;;
  *) echo "Unsupported backend: $BACKEND" && exit 1 ;;
esac

DOWNLOAD_URL="https://github.com/dagnele/transcrivo/releases/latest/download/$ASSET_NAME"
DEST_PATH="$INSTALL_DIR/transcrivo"

mkdir -p "$INSTALL_DIR"

echo "Downloading $ASSET_NAME..."
curl -fsSL "$DOWNLOAD_URL" -o "$DEST_PATH"
chmod +x "$DEST_PATH"

if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  echo "Added $INSTALL_DIR to your PATH. Add the following to your shell config:"
  echo "  export PATH=\"\$PATH:$INSTALL_DIR\""
else
  echo "$INSTALL_DIR is already in your PATH."
fi

echo "Installed Transcrivo to $DEST_PATH"
echo "Run 'transcrivo --help' to verify."
