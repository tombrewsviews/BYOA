#!/usr/bin/env bash
# Stage each standalone app's built .app into DreamStore's bundle resources.
# Run this BEFORE `npm run tauri:build` at the repo root so app_install can
# copy the bundle out at install time.
#
# For the DS2′-B launcher cycle this is just Remit. Each future D-cycle adds a
# line here for its app.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$repo_root/src-tauri/resources/apps"
mkdir -p "$dest"

stage() {
  local app_dir="$1" bundle_name="$2"
  local src="$repo_root/$app_dir/src-tauri/target/release/bundle/macos/$bundle_name"
  if [ ! -d "$src" ]; then
    echo "ERROR: $bundle_name not built at $src" >&2
    echo "Build it first: (cd $app_dir && npm run tauri:build)" >&2
    exit 1
  fi
  rm -rf "${dest:?}/$bundle_name"
  cp -R "$src" "$dest/$bundle_name"
  echo "staged $bundle_name -> $dest/$bundle_name"
}

stage "apps/remit" "Remit.app"
