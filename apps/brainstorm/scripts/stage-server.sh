#!/usr/bin/env bash
# Stage mcp-excalidraw-server (its dist/ + production node_modules) into the
# standalone app's bundle resources, so the packaged .app can spawn it via
# resource_dir(). Run before `npm run tauri:build` in apps/brainstorm/.
set -euo pipefail

app_root="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$app_root/../.." && pwd)"
src_pkg="$repo_root/node_modules/mcp-excalidraw-server"
dest="$app_root/src-tauri/resources/canvas-server"

if [ ! -d "$src_pkg/dist" ]; then
  echo "ERROR: mcp-excalidraw-server not built at $src_pkg/dist" >&2
  echo "Run \`npm install\` at the repo root first." >&2
  exit 1
fi

rm -rf "$dest"
mkdir -p "$dest"
# Copy the package (dist + package.json), then install its prod deps in place.
cp -R "$src_pkg/dist" "$dest/dist"
cp "$src_pkg/package.json" "$dest/package.json"
(cd "$dest" && npm install --omit=dev --no-package-lock --silent)
# Upstream has no notion of the user's current selection, which the embedded
# agent needs. Re-apply our selection patches to the freshly-copied dist —
# this MUST run after every stage or the feature silently disappears.
node "$app_root/scripts/patch-canvas-server.mjs" "$dest"
echo "staged canvas-server -> $dest"
