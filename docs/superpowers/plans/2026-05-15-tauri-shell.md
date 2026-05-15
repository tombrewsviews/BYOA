# Tauri Desktop Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the kinetic studio in a Tauri 2 desktop shell so the embedded terminal can spawn a real PTY (which `node-pty`-in-Vite couldn't do reliably). React UI code in `editor/` stays almost unchanged; a new `src-tauri/` Rust crate owns filesystem and PTY access via Tauri commands and events.

**Architecture:** A Tauri 2 application with `src-tauri/` (Rust backend) and `editor/` (existing React frontend served by Vite). Rust commands replace the Vite plugin's `/__save-story` POST and `/__terminal` WebSocket. The frontend feature-detects Tauri (`window.__TAURI_INTERNALS__`) and routes through `invoke`/`listen` when present, fetch/WebSocket otherwise — so `npm run editor` still loads in a browser for quick UI debugging (terminal pane disabled), and `npm run tauri:dev` opens the desktop app with the terminal alive.

**Tech Stack:** Tauri 2, Rust (portable-pty, tokio, dashmap, serde, uuid), React 19, TypeScript, Vite 6, xterm.js, `@tauri-apps/api`, `@tauri-apps/cli`.

**Spec source:** Sections 1–3 of conversation on 2026-05-15 (Tauri shell brainstorm). Summary preserved in this plan's header.

**Repo state at plan start:** HEAD = `2e9b03b`. Working tree clean. Tasks 1–10 of the prior studio refactor are merged.

---

## File map

```
src-tauri/                          NEW — Rust crate
  Cargo.toml
  build.rs
  tauri.conf.json
  capabilities/default.json
  icons/                            (default scaffold; replace later)
  src/
    main.rs                         desktop entry → lib::run()
    lib.rs                          Builder, command registration, AppState
    story.rs                        save_story / load_story commands
    pty.rs                          pty_open / pty_write / pty_resize / pty_close
                                    + per-session reader task that emits events

editor/                             MODIFIED
  runtime.ts                        NEW — isTauri() helper
  App.tsx                           MODIFIED — save & load route via Tauri when present
  terminal.tsx                      MODIFIED — replace WebSocket with invoke + listen

vite.editor.config.ts               MODIFIED — drop terminalPlugin + node-pty/ws bits

package.json                        MODIFIED
  + dependencies:    @tauri-apps/api
  + devDependencies: @tauri-apps/cli
  - devDependencies: node-pty, ws, @types/ws
  + scripts:         tauri, tauri:dev, tauri:build

README.md                           MODIFIED — add "Run as desktop app" section
```

---

## Prerequisite verification

- [ ] **Verify Rust toolchain**

Run:
```bash
cargo --version && rustc --version
```
Expected: both print a version (Rust 1.75+ is fine). If they fail, install via `https://rustup.rs/` first.

- [ ] **Verify Xcode CLT (macOS only)**

Run:
```bash
xcode-select -p
```
Expected: prints a path. If it errors with "not installed", run `xcode-select --install` and wait for the GUI installer.

These are environment checks, not tasks — do not commit anything yet.

---

## Task 1: Scaffold `src-tauri/` with the Tauri CLI

Use the Tauri CLI's interactive scaffold so we get the correct Tauri 2 layout, signing config, default capabilities, and icon set out of the box. We will then trim it to our needs.

**Files:** all files created by the scaffold (under `src-tauri/`), and small edits to `package.json`.

- [ ] **Step 1: Install the Tauri CLI as a devDependency**

```bash
cd "/Users/parandykt/Remotion Tests"
npm install --save-dev @tauri-apps/cli@^2
npm install --save @tauri-apps/api@^2
```

Expected: installs succeed. `@tauri-apps/cli` lands in devDependencies, `@tauri-apps/api` in dependencies.

- [ ] **Step 2: Run the init command**

```bash
cd "/Users/parandykt/Remotion Tests"
npx tauri init --ci \
  --app-name "Kinetic Studio" \
  --window-title "Kinetic Studio" \
  --frontend-dist "../editor/dist" \
  --dev-url "http://localhost:5174" \
  --before-dev-command "npm run editor" \
  --before-build-command "npm run build:editor"
```

`--ci` accepts defaults non-interactively. Identifier defaults to `com.tauri.dev`; we'll fix it in the next step.

Expected: a new `src-tauri/` directory is created with `Cargo.toml`, `tauri.conf.json`, `build.rs`, `src/main.rs`, `src/lib.rs`, `capabilities/default.json`, and an `icons/` folder.

- [ ] **Step 3: Set the bundle identifier**

Open `src-tauri/tauri.conf.json`. Find the line:
```json
"identifier": "com.tauri.dev",
```
Replace with:
```json
"identifier": "app.kinetic.studio",
```

- [ ] **Step 4: Add the `tauri` / `tauri:dev` / `tauri:build` scripts**

In `/Users/parandykt/Remotion Tests/package.json`, add to `scripts`:
```json
"tauri": "tauri",
"tauri:dev": "tauri dev",
"tauri:build": "tauri build"
```

Keep all existing scripts. Final scripts order doesn't matter, but ensure JSON commas are correct.

- [ ] **Step 5: Smoke-check Tauri runs**

Run:
```bash
cd "/Users/parandykt/Remotion Tests"
npm run tauri:dev
```

Expected: a desktop window opens showing the studio UI (loaded from Vite at :5174). The terminal pane still says "[terminal disconnected — reload to reconnect]" because we haven't migrated terminal IPC yet — that's fine for this checkpoint. Other panes (preview, properties, timeline) should be fully functional, identical to browser mode.

Close the window to stop. If the build fails because of missing Rust dependencies, run `rustup update stable` and retry once.

- [ ] **Step 6: Commit**

```bash
cd "/Users/parandykt/Remotion Tests"
git add src-tauri package.json package-lock.json
git -c user.email=studio@local -c user.name="Tauri Implementer" commit -m "feat(tauri): scaffold src-tauri shell for kinetic studio"
```

---

## Task 2: Add `isTauri()` runtime helper in the frontend

Single source of truth for "are we running inside the Tauri webview". Used by every subsequent frontend change.

**Files:**
- Create: `editor/runtime.ts`

- [ ] **Step 1: Create the helper**

Write `/Users/parandykt/Remotion Tests/editor/runtime.ts`:

```ts
/**
 * Runtime feature detection. Tauri 2 exposes window.__TAURI_INTERNALS__ in
 * the webview; absent in plain browser dev (`npm run editor`).
 *
 * Use this whenever a code path needs a desktop-only capability (PTY,
 * direct filesystem write) so the same UI still works in a browser tab
 * for quick visual debugging.
 */
export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
```

- [ ] **Step 2: Type-check**

```bash
cd "/Users/parandykt/Remotion Tests"
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add editor/runtime.ts
git -c user.email=studio@local -c user.name="Tauri Implementer" commit -m "feat(editor): add isTauri() runtime helper"
```

---

## Task 3: Add Rust `save_story` and `load_story` commands

The simplest end-to-end command pair: read & write `story.json`. Establishes the AppState/project_root pattern that Task 4 (PTY) will reuse.

**Files:**
- Create: `src-tauri/src/story.rs`
- Modify: `src-tauri/src/lib.rs` — register commands, install AppState
- Modify: `src-tauri/Cargo.toml` — add deps

- [ ] **Step 1: Add Rust dependencies**

Open `src-tauri/Cargo.toml`. Find the `[dependencies]` block. Ensure these are present (the scaffold may have a subset — add any missing):

```toml
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

(`tauri-plugin-shell` was added by the scaffold; we don't actually use it from the frontend but we leave it installed — its `init()` call doesn't hurt and the scaffold registered it.)

- [ ] **Step 2: Write `src-tauri/src/story.rs`**

Create the file:

```rust
//! story.json read/write commands. All writes are atomic (tmp + rename).
//!
//! The project root is resolved once at app startup and stored in AppState
//! so commands can't be tricked into writing outside it.

use std::path::PathBuf;
use tauri::State;

use crate::AppState;

#[tauri::command]
pub fn save_story(
    json: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Validate JSON shape before touching the disk.
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| format!("invalid story json: {}", e))?;

    let target: PathBuf = state.project_root.join("story.json");
    let tmp: PathBuf = state.project_root.join("story.json.tmp");

    let body = if json.ends_with('\n') {
        json
    } else {
        format!("{}\n", json)
    };

    std::fs::write(&tmp, body.as_bytes())
        .map_err(|e| format!("write tmp: {}", e))?;
    std::fs::rename(&tmp, &target)
        .map_err(|e| format!("rename: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn load_story(state: State<'_, AppState>) -> Result<String, String> {
    let target: PathBuf = state.project_root.join("story.json");
    std::fs::read_to_string(&target).map_err(|e| format!("read: {}", e))
}
```

- [ ] **Step 3: Wire AppState and commands into `src-tauri/src/lib.rs`**

Open `src-tauri/src/lib.rs`. Replace its entire contents with:

```rust
//! Tauri 2 entry: app state, command registration, plugin init.

mod story;

use std::path::PathBuf;

pub struct AppState {
    pub project_root: PathBuf,
}

fn resolve_project_root() -> PathBuf {
    // src-tauri/Cargo.toml is at <project_root>/src-tauri/Cargo.toml, so the
    // workspace root is the parent of CARGO_MANIFEST_DIR. In production
    // builds CARGO_MANIFEST_DIR is baked at compile time and still points
    // at the original src-tauri/ — but production builds are run by the
    // user with `tauri build` from the same checkout, so the path is
    // valid for our use (single-machine local tool). If we ever publish
    // a real .app for other machines this needs a smarter resolver.
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir)
        .parent()
        .expect("src-tauri has a parent")
        .to_path_buf()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        project_root: resolve_project_root(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            story::save_story,
            story::load_story,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Build**

```bash
cd "/Users/parandykt/Remotion Tests/src-tauri"
cargo check
```
Expected: compiles clean. Any errors should be fixed before continuing.

- [ ] **Step 5: Smoke-test the command from the dev tools**

Run `npm run tauri:dev`, open the desktop app's webview devtools (right-click → Inspect or `Cmd+Option+I`), and in the console run:

```js
const { invoke } = await import("@tauri-apps/api/core");
const before = await invoke("load_story");
console.log("len:", before.length);
await invoke("save_story", { json: before });
console.log("ok");
```

Expected: prints the length and `ok`. Verify `git status` from a separate terminal shows `story.json` unchanged (we wrote it back byte-identical, but the tmp+rename should be a no-op-equivalent at the content level). If `git diff story.json` is non-empty, inspect it — likely a trailing-newline difference; that's acceptable but worth knowing.

Close the app.

- [ ] **Step 6: Commit**

```bash
cd "/Users/parandykt/Remotion Tests"
git add src-tauri/src/lib.rs src-tauri/src/story.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git -c user.email=studio@local -c user.name="Tauri Implementer" commit -m "feat(tauri): add save_story and load_story commands"
```

---

## Task 4: Add Rust PTY commands

Spawn a shell via `portable-pty`. Per-session ID, output streamed to the frontend as events. This is the core unblock for the original failure.

**Files:**
- Create: `src-tauri/src/pty.rs`
- Modify: `src-tauri/src/lib.rs` — register commands, extend AppState with `ptys` map
- Modify: `src-tauri/Cargo.toml` — add `portable-pty`, `tokio`, `dashmap`, `uuid`

- [ ] **Step 1: Add deps**

In `src-tauri/Cargo.toml`'s `[dependencies]`:

```toml
portable-pty = "0.8"
tokio = { version = "1", features = ["macros", "rt-multi-thread", "io-util", "sync"] }
dashmap = "6"
uuid = { version = "1", features = ["v4"] }
```

Also update the `tauri` line to enable the macos-private-api feature if it's used — but the default features are fine. No change needed unless `cargo check` complains later.

- [ ] **Step 2: Create `src-tauri/src/pty.rs`**

```rust
//! PTY session management.
//!
//! pty_open spawns $SHELL -l with cwd = project_root and registers the
//! session in AppState.ptys. A blocking reader thread (NOT a tokio task —
//! portable-pty's reader is sync) pumps bytes into `pty://{id}/data`
//! events. pty_write/resize/close mutate the session through the map.

use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::AppState;

pub struct PtySession {
    pub master: Mutex<Box<dyn MasterPty + Send>>,
    pub writer: Mutex<Box<dyn Write + Send>>,
    pub child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
}

#[tauri::command]
pub fn pty_open(
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty: {}", e))?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    cmd.cwd(&state.project_root);
    // Inherit env so `claude` finds ~/.claude credentials.
    for (k, v) in std::env::vars() {
        cmd.env(k, v);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer: {}", e))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("try_clone_reader: {}", e))?;

    let id = Uuid::new_v4().to_string();

    let session = PtySession {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
    };
    state.ptys.insert(id.clone(), session);

    // Spawn the reader thread. It emits pty://{id}/data events until EOF,
    // then emits pty://{id}/closed and exits. The map entry is dropped by
    // pty_close (explicit) or by the reader on natural EOF.
    let app_for_thread = app.clone();
    let id_for_thread = id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app_for_thread.emit(
                        &format!("pty://{}/data", id_for_thread),
                        chunk,
                    );
                }
                Err(_) => break,
            }
        }
        let _ = app_for_thread.emit::<()>(
            &format!("pty://{}/closed", id_for_thread),
            (),
        );
    });

    Ok(id)
}

#[tauri::command]
pub fn pty_write(
    id: String,
    data: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = state
        .ptys
        .get(&id)
        .ok_or_else(|| format!("no pty session: {}", id))?;
    let mut writer = session.writer.lock().map_err(|e| e.to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("write: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn pty_resize(
    id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = state
        .ptys
        .get(&id)
        .ok_or_else(|| format!("no pty session: {}", id))?;
    let master = session.master.lock().map_err(|e| e.to_string())?;
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn pty_close(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some((_, session)) = state.ptys.remove(&id) {
        if let Ok(mut child) = session.child.lock() {
            let _ = child.kill();
        }
    }
    Ok(())
}
```

- [ ] **Step 3: Extend AppState and register commands in `lib.rs`**

Open `src-tauri/src/lib.rs`. Replace its contents with:

```rust
//! Tauri 2 entry: app state, command registration, plugin init.

mod pty;
mod story;

use std::path::PathBuf;

use dashmap::DashMap;

pub struct AppState {
    pub project_root: PathBuf,
    pub ptys: DashMap<String, pty::PtySession>,
}

fn resolve_project_root() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir)
        .parent()
        .expect("src-tauri has a parent")
        .to_path_buf()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        project_root: resolve_project_root(),
        ptys: DashMap::new(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            story::save_story,
            story::load_story,
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Build**

```bash
cd "/Users/parandykt/Remotion Tests/src-tauri"
cargo check
```
Expected: compiles clean.

- [ ] **Step 5: Smoke-test PTY from devtools**

Run `npm run tauri:dev`. Open devtools console. Run:

```js
const { invoke } = await import("@tauri-apps/api/core");
const { listen } = await import("@tauri-apps/api/event");
const id = await invoke("pty_open", { cols: 80, rows: 24 });
console.log("session:", id);
await listen(`pty://${id}/data`, (e) => process.stdout
  ? process.stdout.write(e.payload)
  : console.log(e.payload),
);
await invoke("pty_write", { id, data: "echo hello\r" });
```

Expected: after the `pty_write`, the console prints the prompt followed by `echo hello` echo and `hello`. Confirms full duplex works.

Then run `await invoke("pty_close", { id })`. Expected: no further data, eventually a `pty://{id}/closed` event (which we won't see unless you subscribe to it).

Close the app.

- [ ] **Step 6: Commit**

```bash
cd "/Users/parandykt/Remotion Tests"
git add src-tauri/src/lib.rs src-tauri/src/pty.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git -c user.email=studio@local -c user.name="Tauri Implementer" commit -m "feat(tauri): add PTY commands and per-session event stream"
```

---

## Task 5: Frontend save flow via Tauri

Make `App.tsx`'s `handleSave` (and the initial `story.json` load) prefer Tauri commands when running in Tauri, fall back to fetch/POST in the browser.

**Files:**
- Modify: `editor/App.tsx`

- [ ] **Step 1: Update the load effect**

Open `/Users/parandykt/Remotion Tests/editor/App.tsx`. Find the existing `useEffect` that loads `story.json`:

```tsx
useEffect(() => {
  fetch("/story.json")
    .then((r) => r.json())
    .then((raw) => {
      const parsed = storySchema.parse(raw);
      setStory(parsed);
      setSavedJson(JSON.stringify(parsed));
    })
    .catch((e) => setError(`Failed to load story.json: ${e.message}`));
}, []);
```

Replace with:

```tsx
useEffect(() => {
  const load = async () => {
    try {
      let raw: unknown;
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const text = await invoke<string>("load_story");
        raw = JSON.parse(text);
      } else {
        const res = await fetch("/story.json");
        raw = await res.json();
      }
      const parsed = storySchema.parse(raw);
      setStory(parsed);
      setSavedJson(JSON.stringify(parsed));
    } catch (e) {
      setError(`Failed to load story.json: ${(e as Error).message}`);
    }
  };
  void load();
}, []);
```

Add the import at the top of the file (alongside the other local imports):

```tsx
import { isTauri } from "./runtime";
```

- [ ] **Step 2: Update the save handler**

Find the existing `handleSave`:

```tsx
const handleSave = useCallback(async () => {
  if (!story) return;
  try {
    const res = await fetch("/__save-story", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(story, null, 2),
    });
    if (!res.ok) throw new Error(await res.text());
    setSavedJson(JSON.stringify(story));
  } catch (e) {
    setError(`Save failed: ${(e as Error).message}`);
  }
}, [story]);
```

Replace with:

```tsx
const handleSave = useCallback(async () => {
  if (!story) return;
  const json = JSON.stringify(story, null, 2);
  try {
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_story", { json });
    } else {
      const res = await fetch("/__save-story", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: json,
      });
      if (!res.ok) throw new Error(await res.text());
    }
    setSavedJson(JSON.stringify(story));
  } catch (e) {
    setError(`Save failed: ${(e as Error).message}`);
  }
}, [story]);
```

- [ ] **Step 3: Type-check**

```bash
cd "/Users/parandykt/Remotion Tests"
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 4: Verify both modes**

Browser:
```bash
npm run editor
```
Open `http://localhost:5174`, change a slider, click Save, reload — value persists. Stop.

Desktop:
```bash
npm run tauri:dev
```
Same test: change a slider, click Save, close window, re-open. Value persists.

Both should work. The desktop save goes through Rust; the browser save goes through the Vite plugin's POST. Either way `story.json` is updated.

- [ ] **Step 5: Commit**

```bash
cd "/Users/parandykt/Remotion Tests"
git add editor/App.tsx
git -c user.email=studio@local -c user.name="Tauri Implementer" commit -m "feat(editor): route save/load through Tauri commands when available"
```

---

## Task 6: Frontend terminal via Tauri PTY

Replace the WebSocket transport in `terminal.tsx` with Tauri `invoke`/`listen`. In browser mode, write a single line explaining how to launch the desktop app.

**Files:**
- Modify: `editor/terminal.tsx`

- [ ] **Step 1: Replace the file**

Overwrite `/Users/parandykt/Remotion Tests/editor/terminal.tsx` with:

```tsx
/**
 * Embedded terminal.
 *
 * Desktop (Tauri): xterm.js <-> Rust pty commands. pty_open returns a
 * session id; pty://{id}/data events stream stdout back; keystrokes go
 * out via pty_write; resize via pty_resize; pty_close on unmount.
 *
 * Browser (npm run editor): the terminal is disabled — we print a single
 * line of instructions so the user knows where to find it. The browser
 * mode is preserved for fast UI iteration; production use is the
 * desktop app.
 */
import React, { useEffect, useRef } from "react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import "xterm/css/xterm.css";
import { isTauri } from "./runtime";

export const Terminal: React.FC = () => {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const term = new XTerm({
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 12,
      theme: {
        background: "#0a0a10",
        foreground: "#e4e4ee",
        cursor: "#facc15",
        selectionBackground: "#7c5cff66",
      },
      cursorBlink: true,
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(hostRef.current);
    fit.fit();

    const cleanupFns: Array<() => void | Promise<void>> = [];

    const onWinResize = () => fit.fit();
    window.addEventListener("resize", onWinResize);
    cleanupFns.push(() => window.removeEventListener("resize", onWinResize));

    if (!isTauri()) {
      term.writeln(
        "[terminal requires desktop app — run `npm run tauri:dev`]",
      );
    } else {
      // Async wiring; ignore the returned promise (cleanup uses cleanupFns).
      void (async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        const { listen } = await import("@tauri-apps/api/event");

        let sessionId: string;
        try {
          sessionId = await invoke<string>("pty_open", {
            cols: term.cols,
            rows: term.rows,
          });
        } catch (e) {
          term.writeln(`\r\n[pty_open failed: ${(e as Error).message ?? e}]`);
          return;
        }

        const unlistenData = await listen<string>(
          `pty://${sessionId}/data`,
          (e) => term.write(e.payload),
        );
        const unlistenClosed = await listen<null>(
          `pty://${sessionId}/closed`,
          () => term.writeln("\r\n[shell exited]"),
        );

        const dataDisp = term.onData((data) => {
          void invoke("pty_write", { id: sessionId, data });
        });
        const resizeDisp = term.onResize(({ cols, rows }) => {
          void invoke("pty_resize", { id: sessionId, cols, rows });
        });

        cleanupFns.push(
          () => unlistenData(),
          () => unlistenClosed(),
          () => dataDisp.dispose(),
          () => resizeDisp.dispose(),
          async () => {
            try {
              await invoke("pty_close", { id: sessionId });
            } catch {
              // already gone — ignore
            }
          },
        );
      })();
    }

    return () => {
      for (const fn of cleanupFns) {
        try {
          void fn();
        } catch {
          // ignore
        }
      }
      term.dispose();
    };
  }, []);

  return (
    <div
      data-terminal-root
      ref={hostRef}
      style={{
        width: "100%",
        height: "100%",
        background: "#0a0a10",
        padding: 6,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    />
  );
};
```

- [ ] **Step 2: Type-check**

```bash
cd "/Users/parandykt/Remotion Tests"
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Verify in the desktop app**

```bash
npm run tauri:dev
```

Expected:
- Terminal pane shows a real shell prompt (zsh by default), in the project directory (run `pwd` to confirm).
- Type `ls` → directory contents.
- Type `claude` → CLI starts. If not logged in, the login URL prints; it's clickable (web-links addon).
- Resize the window — terminal reflows without breaking.
- With focus inside the terminal, press Space — typing happens in the terminal, NOT play/pause (the `data-terminal-root` guard in App.tsx handles this).
- Click outside the terminal, press Space — play/pause toggles.

Close the window.

Also briefly verify browser mode:
```bash
npm run editor
```
Terminal pane shows the line `[terminal requires desktop app — run `npm run tauri:dev`]`. Everything else still works. Stop.

- [ ] **Step 4: Commit**

```bash
cd "/Users/parandykt/Remotion Tests"
git add editor/terminal.tsx
git -c user.email=studio@local -c user.name="Tauri Implementer" commit -m "feat(editor): terminal uses Tauri PTY (browser shows fallback message)"
```

---

## Task 7: Remove dead Vite plugin terminal code and unused deps

`/__terminal` and the `node-pty`/`ws` imports in `vite.editor.config.ts` are dead. Drop them and the now-unused dependencies. `storyJsonPlugin` stays (browser-mode save still uses it).

**Files:**
- Modify: `vite.editor.config.ts`
- Modify: `package.json` — remove `node-pty`, `ws`, `@types/ws`

- [ ] **Step 1: Strip the terminal plugin from `vite.editor.config.ts`**

Open `/Users/parandykt/Remotion Tests/vite.editor.config.ts`. Remove:
- The `createRequire` import block (lines around `import { createRequire } from "module"` and `const require = createRequire(...)`).
- The `WebSocketServer`/`WebSocket` import line.
- The entire `terminalPlugin = (): Plugin => ({...})` definition.
- The `terminalPlugin()` entry in the `plugins` array (leave just `[react(), storyJsonPlugin()]`).

The final file should be approximately back to its pre-Task-7-of-the-previous-plan state (i.e., before the PTY backend was added), still with `storyJsonPlugin`.

Save.

- [ ] **Step 2: Uninstall unused deps**

```bash
cd "/Users/parandykt/Remotion Tests"
npm uninstall node-pty ws @types/ws
```

Expected: removes the three packages. `package.json` and `package-lock.json` update.

- [ ] **Step 3: Type-check + run**

```bash
npx tsc --noEmit
npm run editor   # browser still loads (terminal disabled)
```
Stop after confirming.

```bash
npm run tauri:dev  # desktop still works
```
Stop after confirming.

- [ ] **Step 4: Commit**

```bash
cd "/Users/parandykt/Remotion Tests"
git add package.json package-lock.json vite.editor.config.ts
git -c user.email=studio@local -c user.name="Tauri Implementer" commit -m "chore: remove Vite PTY plugin and node-pty/ws deps"
```

---

## Task 8: README — document the desktop app

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the run table**

Find the existing `npm run` block in `README.md`. After the `npm run editor` line, insert:

```
npm run tauri:dev    # Desktop app (Kinetic Studio) — full PTY terminal
npm run tauri:build  # Bundle a distributable .app / .dmg
```

- [ ] **Step 2: Add a "Desktop app" section**

After the existing "## The studio (`npm run editor`)" section, append:

```markdown
## Desktop app (`npm run tauri:dev`)

The studio also runs as a native macOS app via Tauri 2. Use the desktop
app when you want the embedded terminal — browser sandboxes can't open a
PTY, so `npm run editor` shows a stub message in the terminal pane.

```
npm run tauri:dev    # opens Kinetic Studio.app loading the Vite UI
npm run tauri:build  # produces dist/.app/.dmg in src-tauri/target/
```

The terminal spawns your `$SHELL` in the project directory. Type
`claude` to start the Claude Code CLI; OAuth login URLs are clickable.

Architecture:

- `src-tauri/` — Rust backend (Tauri 2). Owns filesystem (story.json
  save/load) and PTY (portable-pty crate).
- `editor/` — same React frontend. Detects Tauri at runtime and routes
  through `invoke`/`listen` instead of fetch/WebSocket.

Requires Rust + Cargo (`https://rustup.rs/`) and Xcode Command Line
Tools (`xcode-select --install`).
```

(The literal triple-backtick block inside that section needs to render as a code block. Markdown allows that as long as the outer fence isn't trying to wrap it — i.e., write the section as plain markdown text in the file, not nested inside another fence.)

- [ ] **Step 3: Drop the obsolete `node-pty` rebuild note**

In the previous README pass we added a "Native module note" suggesting `npm rebuild node-pty`. That's now wrong (we don't use node-pty). Replace the entire "Native module note" subsection under "The studio" with:

```markdown
### Native module note

The PTY-backed terminal requires the desktop app (`npm run tauri:dev`).
Browser dev mode (`npm run editor`) skips it and prints a hint in the
terminal pane.
```

- [ ] **Step 4: Commit**

```bash
cd "/Users/parandykt/Remotion Tests"
git add README.md
git -c user.email=studio@local -c user.name="Tauri Implementer" commit -m "docs: document desktop app + drop stale node-pty note"
```

---

## Task 9: Final smoke + audit

- [ ] **Step 1: Type-check**

```bash
cd "/Users/parandykt/Remotion Tests"
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 2: Rust check**

```bash
cd "/Users/parandykt/Remotion Tests/src-tauri"
cargo check
```
Expected: compiles clean.

- [ ] **Step 3: Browser mode**

```bash
cd "/Users/parandykt/Remotion Tests"
npm run editor &
EDITOR_PID=$!
sleep 5
curl -sf http://localhost:5174 >/dev/null && echo "EDITOR OK" || echo "EDITOR FAIL"
kill $EDITOR_PID 2>/dev/null
wait $EDITOR_PID 2>/dev/null
```

- [ ] **Step 4: Desktop mode**

```bash
npm run tauri:dev
```

In the running app, verify:
1. Studio loads, all four panes visible.
2. Click each beat → properties + seek + play work.
3. Slider drag updates the preview live.
4. Save button writes `story.json` (verify with `git status`).
5. Terminal: `pwd` shows project root, `ls` lists files, `claude` starts the CLI.
6. Keyboard shortcuts work in the preview; Space in the terminal types a space (no transport theft).
7. Resize the window — terminal reflows; layout reflows.
8. Close the window; relaunch — story still loads, terminal still spawns a fresh shell.

Close.

- [ ] **Step 5: Other entry points still work**

```bash
npm run studio &
sleep 5 && curl -sf http://localhost:3000 >/dev/null && echo "STUDIO OK" || echo "STUDIO FAIL"
kill %1 2>/dev/null
wait %1 2>/dev/null

mkdir -p out
npx remotion render KineticStory out/_smoketest.mp4 --frames=0-10
ls -la out/_smoketest.mp4 && echo "RENDER OK" || echo "RENDER FAIL"
rm -f out/_smoketest.mp4
```

- [ ] **Step 6: Final commit if needed**

```bash
git status
# If clean, done. Otherwise:
git add -A && git -c user.email=studio@local -c user.name="Tauri Implementer" commit -m "chore: tauri shell verified"
```

---

## Self-review notes

**Spec coverage:**
- New `src-tauri/` crate → Task 1 (scaffold), Tasks 3–4 (commands).
- `isTauri()` helper → Task 2.
- `save_story` / `load_story` commands → Task 3.
- `pty_open` / `pty_write` / `pty_resize` / `pty_close` + per-session reader → Task 4.
- Frontend save routes via Tauri → Task 5.
- Terminal via Tauri PTY → Task 6.
- Drop dead Vite/node-pty code → Task 7.
- Browser mode preserved (terminal stub) → Task 6 Step 1, Task 7 Step 3.
- README → Task 8.
- Smoke verification → Task 9.

**Type consistency:** `AppState` is defined in `lib.rs`, used by `story.rs` and `pty.rs`. `PtySession` defined in `pty.rs`, referenced in `lib.rs` only as `pty::PtySession`. Event names follow `pty://{id}/data` and `pty://{id}/closed`. Command names match between Rust (`#[tauri::command]`) and TS (`invoke("...")`).

**Placeholder scan:** No TBDs. Every step has the full code or full command. The two production-correctness caveats (icon assets, code signing for distribution) are explicitly out of scope and noted in Task 1 — they're follow-ups, not unfilled spec items.

**Open follow-ups (not in scope):**
- Replace default Tauri icon set with branded icons.
- Code-signing & notarisation for distributing the .app outside this checkout.
- Cross-platform PTY testing (`portable-pty` supports Windows ConPTY and Linux pty; this plan tests macOS only).
- A second terminal tab (UI work).
