#!/usr/bin/env bash
# Copy the built Remit.app into the DreamStore install root so it's launchable
# standalone (double-click) from the same place the store installs apps.
# Run after `npm run tauri:build`.
set -euo pipefail

APP="src-tauri/target/release/bundle/macos/Remit.app"
DEST_DIR="$HOME/Applications/DreamStore"

if [ ! -d "$APP" ]; then
  echo "Remit.app not found at $APP — run 'npm run tauri:build' first." >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
rm -rf "$DEST_DIR/Remit.app"
cp -R "$APP" "$DEST_DIR/Remit.app"
echo "Installed → $DEST_DIR/Remit.app"
