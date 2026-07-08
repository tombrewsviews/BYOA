# DS2′-D1 Brainstorm Standalone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Brainstorm Canvas into a self-contained standalone `.app` (spawned by the launcher), bundling its node canvas-server as a Tauri resource, and fix the DS2′-B regression so in-process apps install again.

**Architecture:** Task 1 fixes the dual-mode install regression in the shell (shippable alone, unblocks Pulse/Kinetic/Data). Tasks 2–11 scaffold `apps/brainstorm/` from the Remit template, copy the shared core + the full agent/terminal/pty/settings subsystem + Brainstorm's frontend, port `brainstorm_canvas.rs` with a `resource_dir()`-based server path, and bundle `mcp-excalidraw-server`. Tasks 12–13 strip Brainstorm from the shell and wire it into `bundle-apps.sh` + the catalog. Task 14 is the automated+manual E2E.

**Tech Stack:** Rust + Tauri 2 (`AppHandle`, `resource_dir()`, `std::process::Command` spawning `node`), React + TypeScript + Vite, Vitest, `tempfile` (Rust tests), macOS `open`, `mcp-excalidraw-server` (node).

## Global Constraints

Copied verbatim from the spec (`docs/superpowers/specs/2026-07-08-ds2d1-brainstorm-standalone-design.md`) and the launcher-pivot spec; every task implicitly includes these:

- **`apps/` is git-ignored.** Stage standalone files with `git add -f` (see `apps/remit/` — the whole tree is force-added). The `.gitignore` rules `apps/`, `editor/apps-private/`, and (new) `apps/brainstorm/src-tauri/resources/canvas-server/`.
- **Isolated data dirs:** `~/.brainstorm` + `~/Brainstorm Projects/`. Migration filter: project dirs containing `board.json`.
- **Bundle identity:** `productName` "Brainstorm Canvas" → `Brainstorm Canvas.app`; identifier `app.altramanera.brainstorm`.
- **Node canvas-server:** bundle `mcp-excalidraw-server` (dist + prod node_modules) under `resources/canvas-server/`; resolve via `resource_dir()`; spawn the user's `node` (external requirement). `bundle.resources` glob is `resources/canvas-server/**/*` (a bare `*` skips directories and fails the build — DS2′-B lesson).
- **Two hard-won invariants:** `capabilities/default.json` (`core:default` + `core:window:allow-start-dragging` + dialog/set-focus/close) AND a `data-tauri-drag-region` title bar left-padded ~84px, interactive buttons `data-tauri-drag-region={false}`, with an "Open DreamStore" button (`open -b app.altramanera.dreamstore`, fallback install path).
- **Dual-mode install:** launchable app → copy bundle (error if missing); non-launchable app → registry-only state-marker install. Frontend passes `launchable`; reconcile prunes only bundle-installs whose `.app` is gone.
- **Copy-don't-share:** copy shared code from the shell / `apps/remit/` verbatim (independence > DRY), same as Remit.
- **Green gates:** shell `tsc` + `npm test` + `cargo check`; standalone `tsc` + its tests + `cargo check`. Never run `cargo clean` (target cache is large/healthy; a move breaks it).
- **Bundle ids verified in repo:** DreamStore `app.altramanera.dreamstore`; Remit `app.altramanera.remit`.

---

## File Structure

**Shell — dual-mode install (Task 1)**
- `src-tauri/src/store.rs` — MODIFY. `InstalledEntry` gains `bundle: bool`; `app_install` takes `launchable: bool` and branches copy-vs-registry-only; `reconcile_in` prunes only `bundle`-installs whose `.app` is gone. Extend tests.
- `editor/platform/install.ts` — MODIFY. `startInstall`/`uninstall` pass `launchable: !!app.launchable`.
- `editor/platform/__tests__/install.test.ts` — MODIFY. Assert `launchable` in the payload; add a non-launchable install test.

**Standalone — `apps/brainstorm/` (Tasks 2–11), git-ignored**
- Scaffold: `package.json`, `index.html`, `vite.config`, `tsconfig*`, `src/main.tsx`, `src/index.css`, `src/runtime.ts`, `src/vite-env.d.ts`, `src-tauri/{Cargo.toml, build.rs, tauri.conf.json, capabilities/default.json, icons/, src/{main.rs, lib.rs}}` — from `apps/remit/` template.
- Shared core Rust (copy from `apps/remit/src-tauri/src/`): `paths.rs` (re-pointed), `doc.rs`/projects (from shell — Remit's are in `remit.rs`; see Task 4), `watch.rs`, `skill.rs`, `migrate.rs` (re-filtered).
- Agent stack (copy from shell): frontend `src/agent-chat/**`, `src/terminal.tsx`, `src/icons.ts`, shadcn `src/components/ui/**`; Rust `agent_chat.rs`, `pty.rs`, `agents.rs`, `settings.rs`, `prompt_mode.rs`, `selection.rs`.
- Brainstorm app: frontend `src/brainstorm/{BrainstormApp.tsx, index.tsx, persistence.ts, watch.ts}` (decoupled); Rust `brainstorm_canvas.rs` (ported `server_entry`).
- Canvas server: `src-tauri/resources/canvas-server/` (git-ignored, staged by a build script).

**Shell strip (Tasks 12–13)**
- `editor/platform/catalog.ts`, `editor/canvases/brainstorm/` (removed), `src-tauri/src/lib.rs`, `src-tauri/src/brainstorm_canvas.rs` (deleted), `store-catalog/brainstorm.json`, `scripts/bundle-apps.sh`.

---

## Task 1: Dual-mode install fix (shell) — fixes the regression

**Files:**
- Modify: `src-tauri/src/store.rs`
- Modify: `editor/platform/install.ts:95,117`
- Modify: `editor/platform/__tests__/install.test.ts`

**Interfaces:**
- Consumes: existing `copy_bundle_into`, `read_registry`, `write_registry`, `safe_name`, `install_root`, `registry_path`.
- Produces: `InstalledEntry { id, name, bundle: bool }`; `app_install(app: AppHandle, app_id, app_name, launchable: bool)`; `install.ts` sends `launchable`.

- [ ] **Step 1: Write the failing Rust tests**

In `src-tauri/src/store.rs`, add to the `#[cfg(test)] mod tests` block:

```rust
    #[test]
    fn install_non_launchable_is_registry_only_no_bundle() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        // No resources dir at all: a non-launchable install must not touch it.
        install_registry_only(&reg, "pulse", "Pulse").unwrap();
        assert!(fs::read_to_string(&reg).unwrap().contains("pulse"));
        // No bundle was created under base.
        assert!(!base.join("Pulse").exists());
        assert!(!base.join("Pulse.app").exists());
    }

    #[test]
    fn reconcile_keeps_registry_only_entry_but_prunes_missing_bundle() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        // A registry-only (non-bundle) entry: no .app on disk, must be KEPT.
        install_registry_only(&reg, "pulse", "Pulse").unwrap();
        // A bundle entry whose .app is gone: must be PRUNED.
        write_registry(&reg, &[
            InstalledEntry { id: "pulse".into(), name: "Pulse".into(), bundle: false },
            InstalledEntry { id: "remit".into(), name: "Remit.app".into(), bundle: true },
        ]).unwrap();
        reconcile_in(&base, &reg); // base/Remit.app does not exist
        let txt = fs::read_to_string(&reg).unwrap();
        assert!(txt.contains("pulse"), "registry-only entry kept");
        assert!(!txt.contains("remit"), "missing-bundle entry pruned");
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml store:: 2>&1 | tail -25`
Expected: FAIL — `install_registry_only` not found; `InstalledEntry` has no field `bundle`.

- [ ] **Step 3: Implement**

In `src-tauri/src/store.rs`:

**(a)** Add `bundle` to `InstalledEntry` (the struct near the top):

```rust
#[derive(Serialize, Deserialize, Clone)]
struct InstalledEntry {
    id: String,
    name: String,
    /// True if this install copied a `.app` bundle (launchable apps); false
    /// for registry-only state-marker installs (in-process apps with no
    /// bundle). Reconcile prunes only bundle installs whose `.app` vanished.
    #[serde(default)]
    bundle: bool,
}
```

(The `#[serde(default)]` keeps old `installed.json` files — written before this field — readable; they deserialize `bundle: false`.)

**(b)** Every existing `InstalledEntry { id, name }` literal now needs `bundle`. In `copy_bundle_into`'s registry upsert, set `bundle: true`:

```rust
    if let Some(e) = entries.iter_mut().find(|e| e.id == app_id) {
        e.name = app_name.to_string();
        e.bundle = true;
    } else {
        entries.push(InstalledEntry { id: app_id.to_string(), name: app_name.to_string(), bundle: true });
    }
```

**(c)** Add the registry-only installer (near `copy_bundle_into`):

```rust
/// Register an in-process app (no bundle to copy). State-marker install: the
/// registry entry is the only artifact; Open mounts the app's Root in-window.
fn install_registry_only(reg: &Path, app_id: &str, app_name: &str) -> Result<(), String> {
    let app_name = safe_name(app_name)?;
    let mut entries = read_registry(reg);
    if let Some(e) = entries.iter_mut().find(|e| e.id == app_id) {
        e.name = app_name.to_string();
        e.bundle = false;
    } else {
        entries.push(InstalledEntry { id: app_id.to_string(), name: app_name.to_string(), bundle: false });
    }
    write_registry(reg, &entries)
}
```

**(d)** Change `app_install` to branch on `launchable`:

```rust
#[tauri::command]
pub fn app_install(
    app: tauri::AppHandle,
    app_id: String,
    app_name: String,
    launchable: bool,
) -> Result<(), String> {
    if !launchable {
        return install_registry_only(&registry_path(), &app_id, &app_name);
    }
    use tauri::Manager;
    let resources_apps = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resolve resource dir: {}", e))?
        .join("resources/apps");
    copy_bundle_into(&install_root(), &registry_path(), &resources_apps, &app_id, &app_name)
}
```

**(e)** Change `reconcile_in` so it prunes only bundle installs whose `.app` is gone (registry-only entries are always kept):

```rust
fn reconcile_in(base: &Path, reg: &Path) {
    let kept: Vec<InstalledEntry> = read_registry(reg)
        .into_iter()
        .filter(|e| !e.bundle || base.join(&e.name).exists())
        .collect();
    let _ = write_registry(reg, &kept);
}
```

**(f)** Any test in this file constructing `InstalledEntry { id, name }` (the launch tests from DS2′-B) must add `bundle: true`. Update those literals.

- [ ] **Step 4: Run Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml store:: 2>&1 | tail -25`
Expected: PASS — all existing + 2 new.

- [ ] **Step 5: Update the frontend + its test**

In `editor/platform/install.ts`, line ~95 (`startInstall`):

```typescript
    await invoke("app_install", { appId, appName: app.name, launchable: !!app.launchable });
```

`editor/platform/install.ts` line ~117 (`uninstall`) is unchanged (uninstall doesn't need `launchable` — `app_uninstall` removes by name/registry either way). Leave it.

In `editor/platform/__tests__/install.test.ts`, update the install assertion and add a non-launchable test:

```typescript
  it("startInstall sends launchable flag (in-process app installs registry-only)", async () => {
    invoke.mockResolvedValue(undefined);
    await startInstall("kinetic"); // kinetic is in-process (not launchable)
    expect(invoke).toHaveBeenCalledWith("app_install", {
      appId: "kinetic",
      appName: "Kinetic Studio",
      launchable: false,
    });
    expect(getInstallState("kinetic").state).toBe("installed");
  });
```

Update the existing `startInstall ... { appId: "remit", appName: "Remit" }` assertion (from DS2′-B) to include `launchable: true` — but note: **Remit is a private overlay app; in a shared clone `findApp("remit")` returns undefined and the test can't rely on it.** Check whether the existing test uses "remit": if so, retarget it to a public launchable-less app or keep it only if the overlay is present. Simplest: change that assertion to use `expect.objectContaining({ appId: "kinetic", launchable: false })` semantics OR keep remit but add `launchable: expect.any(Boolean)`. Pick the public-app version above as the canonical test; adjust the remit one to `objectContaining({ appId: "remit" })` so it doesn't over-assert the flag for a maybe-absent app.

- [ ] **Step 6: Run frontend tests + tsc**

Run: `npx vitest run editor/platform/__tests__/install.test.ts 2>&1 | tail -20 && npx tsc --noEmit && echo tsc-ok`
Expected: PASS + `tsc-ok`.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/store.rs editor/platform/install.ts editor/platform/__tests__/install.test.ts
git commit -m "fix(launcher): dual-mode install — registry-only for in-process apps"
```

---

## Task 2: Scaffold `apps/brainstorm/` from the Remit template

**Files (all under `apps/brainstorm/`, force-added):**
- Copy the whole `apps/remit/` tree as the starting point, then re-identify.

**Interfaces:**
- Produces: a compiling, launchable-in-dev empty shell with Brainstorm identity, ready for the domain copies.

- [ ] **Step 1: Copy the template**

```bash
cp -R apps/remit apps/brainstorm
rm -rf apps/brainstorm/src-tauri/target apps/brainstorm/node_modules apps/brainstorm/dist
# Remove Remit-specific domain files (kept modules re-added in later tasks):
rm -f apps/brainstorm/src-tauri/src/remit.rs
rm -f apps/brainstorm/src/RemitApp.tsx apps/brainstorm/src/FormPanel.tsx apps/brainstorm/src/Preview.tsx \
      apps/brainstorm/src/schema.ts apps/brainstorm/src/fields.ts apps/brainstorm/src/layout.ts \
      apps/brainstorm/src/recipients.ts apps/brainstorm/src/export.ts
rm -rf apps/brainstorm/src/assets apps/brainstorm/src/__tests__
rm -f apps/brainstorm/scripts/install-local.sh
```

- [ ] **Step 2: Re-identify the app**

Edit `apps/brainstorm/src-tauri/tauri.conf.json`: `productName` → `"Brainstorm Canvas"`, `identifier` → `"app.altramanera.brainstorm"`, window `title` → `"Brainstorm Canvas"`. Keep `titleBarStyle: "Overlay"`, `hiddenTitle: true`.

Edit `apps/brainstorm/package.json`: `name` → `"brainstorm-app"`.

Edit `apps/brainstorm/src-tauri/Cargo.toml`: `name` → `"brainstorm-app"` (package + lib/bin as Remit does).

- [ ] **Step 3: Point paths.rs at Brainstorm dirs**

Edit `apps/brainstorm/src-tauri/src/paths.rs`: replace every `.remit` with `.brainstorm` and every `Remit Projects` with `Brainstorm Projects` (the Remit file uses those literals for `~/.remit` + `~/Remit Projects/`). Verify with `grep -n "remit\|Remit" apps/brainstorm/src-tauri/src/paths.rs` → no matches.

- [ ] **Step 4: Stub lib.rs to a minimal builder (domain wired later)**

Edit `apps/brainstorm/src-tauri/src/lib.rs`: strip the `remit`/`doc::remit_export`/`remit_*` module + handlers (they were removed in Step 1). Leave a minimal `run()` that builds with the shell plugins (`tauri_plugin_shell`, `tauri_plugin_dialog`), an empty-ish `AppState` (keep `active_project`), and only the projects/doc/watch commands that survive. This is a scaffolding stub; Tasks 4–10 add modules and handlers. It must `cargo check`.

- [ ] **Step 5: Verify scaffold builds**

Run: `(cd apps/brainstorm && npm install) && cargo check --manifest-path apps/brainstorm/src-tauri/Cargo.toml 2>&1 | tail -15`
Expected: `cargo check` passes (warnings ok). If `paths.rs`/`lib.rs` reference removed modules, fix until green.

- [ ] **Step 6: Commit (force-add)**

```bash
git add -f apps/brainstorm
git commit -m "feat(brainstorm-app): scaffold from Remit template (Brainstorm identity + isolated ~/.brainstorm)"
```

---

## Task 3: Shared-core Rust — projects + doc + watch + skill

**Files:**
- Create (copy from shell `src-tauri/src/`, decoupled): `apps/brainstorm/src-tauri/src/projects.rs`, `doc.rs`. (`watch.rs`, `skill.rs` already came from the Remit template in Task 2 — verify they're the isolated versions.)

**Interfaces:**
- Produces the project/doc command surface Brainstorm's frontend calls: `projects_list`, `projects_create`, `project_open`, `project_close`, `project_delete`, `active_project_path`, `load_doc`, `save_doc`.

Note: Remit collapsed projects/doc into `remit.rs`. Brainstorm keeps a real multi-project model (its frontend calls `projects_list`/`projects_create`/`project_open`/`project_delete`), so copy the SHELL's `projects.rs` + `doc.rs` (the generic versions), not Remit's collapsed one.

- [ ] **Step 1: Copy + decouple**

```bash
cp src-tauri/src/projects.rs apps/brainstorm/src-tauri/src/projects.rs
cp src-tauri/src/doc.rs apps/brainstorm/src-tauri/src/doc.rs
```

Decouple: in these files, `doc.rs` has a `#[cfg(private_remit)] remit_export` — DELETE that command and its cfg (Brainstorm has no PDF export). Ensure `projects.rs`/`doc.rs` reference only `crate::paths`, `crate::AppState`, `crate::watch` — the isolated versions. `board.json` is Brainstorm's doc filename; check `doc.rs`'s `DOC_FILENAME` usage — in the shell it's per-canvas; set/confirm the standalone uses `board.json` (grep for the filename constant and set it to `board.json`).

- [ ] **Step 2: Register + build**

Add `mod projects; mod doc;` to `apps/brainstorm/src-tauri/src/lib.rs` and their commands to `invoke_handler`. Add the AppState fields they need (`active_project: Mutex<Option<projects::ActiveProject>>` — already present from Task 2).

Run: `cargo check --manifest-path apps/brainstorm/src-tauri/Cargo.toml 2>&1 | tail -15`
Expected: PASS.

- [ ] **Step 3: Port projects/doc unit tests** (copy the shell's `#[cfg(test)]` blocks in these files if present; else a minimal test: create a temp project, open it, load/save a `board.json`, assert round-trip). Run:

Run: `cargo test --manifest-path apps/brainstorm/src-tauri/Cargo.toml 2>&1 | tail -15`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -f apps/brainstorm/src-tauri/src/projects.rs apps/brainstorm/src-tauri/src/doc.rs apps/brainstorm/src-tauri/src/lib.rs
git commit -m "feat(brainstorm-app): shared projects + doc core (board.json), tests green"
```

---

## Task 4: Agent-stack Rust — agent_chat + pty + agents + settings + prompt_mode + selection

**Files:**
- Create (copy from shell `src-tauri/src/`): `agent_chat.rs`, `pty.rs`, `agents.rs`, `settings.rs`, `prompt_mode.rs`, `selection.rs`.

**Interfaces:**
- Produces: `agent_chat_run_turn`, `agent_chat_cancel`, `detect_agents`, `pty_open/write/resize/close/paste_prompt`, `get_settings`, `set_default_agent`, `set_skip_permissions`, `set_agent_starting_command`, `get_prompt_mode`, `set_prompt_mode`, `set_selection`.
- Consumes: `AppState` fields `ptys: DashMap<String, pty::PtySession>`, `agent_chats: DashMap<String, agent_chat::AgentChatTurn>`.

- [ ] **Step 1: Copy the six modules**

```bash
for m in agent_chat pty agents settings prompt_mode selection; do
  cp "src-tauri/src/$m.rs" "apps/brainstorm/src-tauri/src/$m.rs"
done
```

- [ ] **Step 2: Add AppState fields + deps**

In `apps/brainstorm/src-tauri/src/lib.rs`, add to `AppState`:

```rust
    pub ptys: DashMap<String, pty::PtySession>,
    pub agent_chats: DashMap<String, agent_chat::AgentChatTurn>,
```

and initialize them (`DashMap::new()`) in `run()`. Add `mod agent_chat; mod pty; mod agents; mod settings; mod prompt_mode; mod selection;` and register all their commands in `invoke_handler`. Ensure `dashmap` is in `apps/brainstorm/src-tauri/Cargo.toml` (copy the dep line + version from the shell `Cargo.toml`); likewise any deps these modules use that Remit's Cargo.toml lacks (grep the modules' `use` for external crates: e.g. `portable-pty`, `serde_json` — add missing ones matching the shell's versions).

- [ ] **Step 3: Build**

Run: `cargo check --manifest-path apps/brainstorm/src-tauri/Cargo.toml 2>&1 | tail -20`
Expected: PASS. Fix missing deps until green (each missing-crate error names the crate; add it to Cargo.toml at the shell's pinned version).

- [ ] **Step 4: Port any unit tests in these modules** (copy their `#[cfg(test)]` blocks verbatim — they came with the files). Run:

Run: `cargo test --manifest-path apps/brainstorm/src-tauri/Cargo.toml 2>&1 | tail -15`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -f apps/brainstorm/src-tauri/src apps/brainstorm/src-tauri/Cargo.toml apps/brainstorm/src-tauri/Cargo.lock
git commit -m "feat(brainstorm-app): agent-chat + pty + agents + settings Rust subsystem"
```

---

## Task 5: Port brainstorm_canvas.rs with resource_dir() server path

**Files:**
- Create: `apps/brainstorm/src-tauri/src/brainstorm_canvas.rs` (copy from shell, change `server_entry`).

**Interfaces:**
- Consumes: `AppState` field `canvas_server: brainstorm_canvas::CanvasServer`.
- Produces: `brainstorm_canvas_start`, `brainstorm_canvas_open_window`, `brainstorm_canvas_close_window`, `shutdown(&AppState)`.

- [ ] **Step 1: Copy the module**

```bash
cp src-tauri/src/brainstorm_canvas.rs apps/brainstorm/src-tauri/src/brainstorm_canvas.rs
```

- [ ] **Step 2: Change `server_entry` to resolve from the bundled resource**

`server_entry()` currently uses `CARGO_MANIFEST_DIR/../node_modules`. Replace it so it takes the `AppHandle` and resolves the bundled server. Change the fn and its one call site in `brainstorm_canvas_start`:

```rust
/// Absolute path to the bundled canvas-server entrypoint. In the standalone
/// app the server ships inside the .app under
/// `resources/canvas-server/dist/server.js` (staged by scripts/stage-server.sh
/// and declared in tauri.conf.json bundle.resources). Resolved via Tauri's
/// resource dir, mirroring how video.rs resolves the bundled yt-dlp.
fn server_entry(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .resolve("resources/canvas-server/dist/server.js", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("resolve canvas server resource: {}", e))
}
```

`brainstorm_canvas_start` must now receive `app: AppHandle` to pass to `server_entry`. Update its signature and body:

```rust
#[tauri::command]
pub fn brainstorm_canvas_start(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    // ... (unchanged already-running check) ...
    let port = pick_port();
    let url = format!("http://127.0.0.1:{}", port);
    let entry = server_entry(&app)?;
    if !entry.exists() {
        return Err(format!(
            "canvas server not found at {} — the app bundle may be incomplete",
            entry.display()
        ));
    }
    // ... rest unchanged (spawn node, write_mcp_config, wait_until_listening) ...
}
```

Keep everything else verbatim (`pick_port`, `write_mcp_config`, `wait_until_listening`, `brainstorm_canvas_open_window`, `tile_windows`, `brainstorm_canvas_close_window`, `active_project_dir`, `shutdown`). The node spawn stays `Command::new("node")`.

- [ ] **Step 3: Wire into lib.rs (AppState + handlers + close-shutdown)**

In `apps/brainstorm/src-tauri/src/lib.rs`: add `mod brainstorm_canvas;`, add `pub canvas_server: brainstorm_canvas::CanvasServer` to `AppState` (init `Default::default()`), register `brainstorm_canvas_start/_open_window/_close_window` in `invoke_handler`, and in `setup()` add the main-window `CloseRequested → brainstorm_canvas::shutdown(&handle.state::<AppState>())` handler (copy the shell's lib.rs pattern from DS2′-B `lib.rs:66-75`).

- [ ] **Step 4: Add server_entry unit test**

In `brainstorm_canvas.rs` tests: `pick_port` prefers 3939 when free; `write_mcp_config` writes `.mcp.json` with the excalidraw MCP + given URL. (`server_entry` needs an `AppHandle` — not unit-testable without a Tauri app; covered by E2E. Assert the path string it builds by extracting the relative-path constant into a `const SERVER_REL: &str = "resources/canvas-server/dist/server.js";` and testing that constant is used — or skip and rely on E2E. Prefer testing `pick_port` + `write_mcp_config`.)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn write_mcp_config_points_excalidraw_at_url() {
        let dir = TempDir::new().unwrap();
        write_mcp_config(dir.path(), "http://127.0.0.1:3939").unwrap();
        let txt = std::fs::read_to_string(dir.path().join(".mcp.json")).unwrap();
        assert!(txt.contains("excalidraw"));
        assert!(txt.contains("http://127.0.0.1:3939"));
        assert!(txt.contains("EXPRESS_SERVER_URL"));
    }

    #[test]
    fn pick_port_returns_a_bindable_port() {
        let p = pick_port();
        // Either the preferred port or an OS-assigned one; must be > 0.
        assert!(p > 0);
    }
}
```

- [ ] **Step 5: Build + test**

Run: `cargo test --manifest-path apps/brainstorm/src-tauri/Cargo.toml 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -f apps/brainstorm/src-tauri/src/brainstorm_canvas.rs apps/brainstorm/src-tauri/src/lib.rs
git commit -m "feat(brainstorm-app): port canvas server (resource_dir path + shutdown-on-close)"
```

---

## Task 6: Stage + bundle the node canvas-server

**Files:**
- Create: `apps/brainstorm/scripts/stage-server.sh`
- Modify: `apps/brainstorm/src-tauri/tauri.conf.json` (bundle.resources)
- Modify: `apps/brainstorm/.gitignore` (ignore `src-tauri/resources/canvas-server/`)

**Interfaces:**
- Produces: `apps/brainstorm/src-tauri/resources/canvas-server/dist/server.js` + its prod node_modules, staged from the repo's `mcp-excalidraw-server`.

- [ ] **Step 1: Write the staging script**

Create `apps/brainstorm/scripts/stage-server.sh`:

```bash
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
echo "staged canvas-server -> $dest"
```

Make executable: `chmod +x apps/brainstorm/scripts/stage-server.sh`.

- [ ] **Step 2: Declare the resource + git-ignore it**

In `apps/brainstorm/src-tauri/tauri.conf.json`, add to `bundle.resources` (create the array if absent):

```json
    "resources": ["resources/canvas-server/**/*"],
```

Append to `apps/brainstorm/.gitignore`:

```
# Bundled node canvas-server (mcp-excalidraw-server dist + prod deps), staged
# by scripts/stage-server.sh before tauri:build. Build output, not source.
src-tauri/resources/canvas-server/
```

- [ ] **Step 3: Run the staging script + verify**

Run: `bash apps/brainstorm/scripts/stage-server.sh && ls apps/brainstorm/src-tauri/resources/canvas-server/dist/server.js && ls -d apps/brainstorm/src-tauri/resources/canvas-server/node_modules`
Expected: prints `staged canvas-server -> …`; `server.js` and a `node_modules/` exist.

- [ ] **Step 4: Commit (source only — staged output is git-ignored)**

```bash
git add -f apps/brainstorm/scripts/stage-server.sh apps/brainstorm/src-tauri/tauri.conf.json apps/brainstorm/.gitignore
git commit -m "build(brainstorm-app): stage + bundle mcp-excalidraw-server as a resource"
```

---

## Task 7: Agent-stack frontend — agent-chat + terminal + ui + icons + runtime

**Files:**
- Create (copy from shell `editor/`): `apps/brainstorm/src/agent-chat/**`, `apps/brainstorm/src/terminal.tsx`, `apps/brainstorm/src/icons.ts`, `apps/brainstorm/src/components/ui/**` (superset of what Remit copied). `runtime.ts` already present from Task 2.

**Interfaces:**
- Produces the React components `BrainstormApp.tsx` imports: `Chat`/`ChatHandle` (`agent-chat/Chat`), `Terminal` (`terminal`), `Button`/`Input` (`components/ui`), icons.

- [ ] **Step 1: Copy the agent-chat + terminal + icons trees**

```bash
mkdir -p apps/brainstorm/src/agent-chat
cp -R editor/agent-chat/. apps/brainstorm/src/agent-chat/
cp editor/terminal.tsx apps/brainstorm/src/terminal.tsx
cp editor/icons.ts apps/brainstorm/src/icons.ts
# UI components: copy the full shadcn set the shell has (superset of Remit's).
cp -R editor/components/ui/. apps/brainstorm/src/components/ui/
```

- [ ] **Step 2: Decouple imports**

The copied files import from shell-relative paths (`../runtime`, `@/components/ui/*`, `../icons`, `../selection`). In `apps/brainstorm/`, the standalone's `tsconfig` maps `@/*` and uses relative paths (verify against how Remit's copied `RemitApp` was decoupled — Task from DS2′-A). Fix imports so every `agent-chat/**`, `terminal.tsx`, `icons.ts` reference resolves within `apps/brainstorm/src/`:
- `@/components/ui/x` → keep if the standalone's `tsconfig` maps `@/*` to `src/*` (Remit does this — verify `apps/brainstorm/tsconfig*.json`); else relative.
- `../runtime` → `apps/brainstorm/src/runtime.ts` (present).
- Any `../selection` type import in agent-chat → point at a local `selection.ts` type (copy `editor/selection.ts` if referenced) OR inline the type. Grep the copied tree for cross-dir imports and resolve each.

- [ ] **Step 3: Typecheck**

Run: `(cd apps/brainstorm && npx tsc --noEmit) 2>&1 | tail -25`
Expected: PASS. Resolve each unresolved-import error by copying the referenced file into `apps/brainstorm/src/` or fixing the path. (Common: `agent-chat/adapters/*`, `ChatStore`, event types — all within the copied tree, so should resolve once paths are relative.)

- [ ] **Step 4: Port agent-chat tests** (the copied tree includes `__tests__` + `__fixtures__`). Run:

Run: `(cd apps/brainstorm && npx vitest run) 2>&1 | tail -20`
Expected: PASS (or the same set that passes in the shell).

- [ ] **Step 5: Commit**

```bash
git add -f apps/brainstorm/src/agent-chat apps/brainstorm/src/terminal.tsx apps/brainstorm/src/icons.ts apps/brainstorm/src/components
git commit -m "feat(brainstorm-app): agent-chat + terminal + ui frontend subsystem"
```

---

## Task 8: Brainstorm frontend — BrainstormApp + persistence + watch + canvas plugin

**Files:**
- Create (copy from `editor/canvases/brainstorm/`, decoupled): `apps/brainstorm/src/brainstorm/{BrainstormApp.tsx, index.tsx, persistence.ts, watch.ts, __tests__/**}`.

**Interfaces:**
- Consumes: the agent-stack frontend (Task 7), the isolated runtime.
- Produces: `BrainstormApp` (the app Root), mounted by `main.tsx` (Task 9).

- [ ] **Step 1: Copy**

```bash
mkdir -p apps/brainstorm/src/brainstorm
cp -R editor/canvases/brainstorm/. apps/brainstorm/src/brainstorm/
```

- [ ] **Step 2: Decouple imports**

In `apps/brainstorm/src/brainstorm/*`:
- `../../runtime` → `../runtime`.
- `../../agent-chat/Chat` → `../agent-chat/Chat`.
- `../../terminal` → `../terminal`.
- `@/components/ui/*` → keep (mapped) or relative per the tsconfig.
- `../../icons` → `../icons`.
- `../../canvas` and `../../selection` (in `index.tsx`) — the canvas plugin types. The standalone doesn't have the shell's substrate `canvas.ts`. `index.tsx` is the canvas-plugin registration for the SHELL's substrate; the standalone mounts `BrainstormApp` directly (like Remit mounts `RemitApp`), so `index.tsx` (the plugin) is NOT needed standalone. DELETE `apps/brainstorm/src/brainstorm/index.tsx` (it only exists to register into the shell's canvas glob). Confirm nothing in `BrainstormApp.tsx`/`persistence.ts`/`watch.ts` imports it.

- [ ] **Step 3: Typecheck**

Run: `(cd apps/brainstorm && npx tsc --noEmit) 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 4: Port brainstorm tests** (the copied `__tests__`). Run:

Run: `(cd apps/brainstorm && npx vitest run) 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -f apps/brainstorm/src/brainstorm
git commit -m "feat(brainstorm-app): BrainstormApp + persistence + watch (decoupled)"
```

---

## Task 9: App shell — main.tsx mount + draggable title bar + Open DreamStore

**Files:**
- Modify: `apps/brainstorm/src/main.tsx` (mount `BrainstormApp` + title bar)
- Modify: `apps/brainstorm/src-tauri/src/lib.rs` (add `open_dreamstore` command)

**Interfaces:**
- Consumes: `BrainstormApp` (Task 8), the `capabilities/default.json` (present from the Remit template — verify).
- Produces: a standalone window with a draggable bar and an Open-DreamStore button, per the two hard-won invariants.

- [ ] **Step 1: Verify capabilities**

Run: `cat apps/brainstorm/src-tauri/capabilities/default.json | grep -E "allow-start-dragging|core:default"`
Expected: both present (copied from Remit). If not, add them (Remit's file is the reference).

- [ ] **Step 2: Add the `open_dreamstore` Rust command**

Copy Remit's `open_dreamstore` (it was in `apps/remit/src-tauri/src/remit.rs`) into `apps/brainstorm/src-tauri/src/lib.rs` (or a small `dreamstore.rs`), register it. Verbatim — it `open -b app.altramanera.dreamstore` with the install-path fallback.

- [ ] **Step 3: Mount BrainstormApp with the title bar**

Edit `apps/brainstorm/src/main.tsx`: mount `<BrainstormApp />` under a `data-tauri-drag-region` title-bar strip (left-pad ~84px for the traffic lights; interactive buttons `data-tauri-drag-region={false}`), including an "Open DreamStore" button calling `invoke("open_dreamstore")`. Use Remit's `main.tsx` title-bar pattern as the reference (the DS2′-A "working window drag" commit). Note Brainstorm's UX tiles TWO windows (agent panel + board) — the title bar goes on the MAIN (agent-panel) window; the board window is the external Excalidraw URL (no bar needed).

- [ ] **Step 4: Typecheck + dev smoke**

Run: `(cd apps/brainstorm && npx tsc --noEmit) 2>&1 | tail -15`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -f apps/brainstorm/src/main.tsx apps/brainstorm/src-tauri/src
git commit -m "feat(brainstorm-app): mount BrainstormApp + draggable title bar + Open DreamStore"
```

---

## Task 10: Migration — board.json-filtered one-time copy

**Files:**
- Modify: `apps/brainstorm/src-tauri/src/migrate.rs` (re-filter for `board.json`)
- Modify: `apps/brainstorm/src-tauri/src/lib.rs` (call `migrate_once` in `run()`)

**Interfaces:**
- Produces: on first launch, non-destructive copy of Brainstorm projects (dirs with `board.json`) from `~/DreamStore Projects/` → `~/Brainstorm Projects/`, marker-gated at `~/.brainstorm/migrated.json`.

- [ ] **Step 1: Re-target the migration filter**

`apps/brainstorm/src-tauri/src/migrate.rs` came from Remit (filters `remit.json`, copies to `~/Remit Projects/`, reads `~/.dreamstore/remit-recipients.json`). Change:
- The doc-file filter: `remit.json` → `board.json`.
- Destination: `~/Remit Projects/` → `~/Brainstorm Projects/` (via paths.rs, already re-pointed).
- Marker: `~/.remit/migrated.json` → `~/.brainstorm/migrated.json` (via paths.rs).
- REMOVE the recipients-file copy (Remit-specific; Brainstorm has no equivalent). Keep only the project-dir copy.

- [ ] **Step 2: Update the migration tests**

`migrate.rs`'s tests reference `remit.json`/recipients. Update them: a temp `DreamStore Projects/` with a `board.json` project + a non-brainstorm project; assert only the `board.json` one is copied, the marker gates re-runs, source is untouched. Remove the recipients test.

- [ ] **Step 3: Wire into run()**

In `apps/brainstorm/src-tauri/src/lib.rs`, call `migrate::migrate_once()` at the top of `run()` (before the builder), matching Remit's placement.

- [ ] **Step 4: Test**

Run: `cargo test --manifest-path apps/brainstorm/src-tauri/Cargo.toml migrate 2>&1 | tail -15`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -f apps/brainstorm/src-tauri/src/migrate.rs apps/brainstorm/src-tauri/src/lib.rs
git commit -m "feat(brainstorm-app): one-time board.json migration from DreamStore Projects"
```

---

## Task 11: Build the standalone + verify it runs

**Files:** none (build/verify).

- [ ] **Step 1: Full standalone build**

Run: `bash apps/brainstorm/scripts/stage-server.sh && (cd apps/brainstorm && npm run tauri:build) 2>&1 | tail -25`
Expected: builds `Brainstorm Canvas.app` at `apps/brainstorm/src-tauri/target/release/bundle/macos/Brainstorm Canvas.app`.

- [ ] **Step 2: Verify the bundle carries the server + identity**

Run:
```bash
APP="apps/brainstorm/src-tauri/target/release/bundle/macos/Brainstorm Canvas.app"
ls "$APP/Contents/Resources/resources/canvas-server/dist/server.js"
/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP/Contents/Info.plist"
```
Expected: `server.js` exists; identifier `app.altramanera.brainstorm`.

- [ ] **Step 3: Commit (Cargo.lock if changed)**

```bash
git add -f apps/brainstorm/src-tauri/Cargo.lock
git commit -m "build(brainstorm-app): standalone Brainstorm Canvas.app builds with bundled server" --allow-empty
```

---

## Task 12: Strip Brainstorm from the shell

**Files:**
- Modify: `editor/platform/catalog.ts`, `src-tauri/src/lib.rs`
- Delete: `src-tauri/src/brainstorm_canvas.rs`, `editor/canvases/brainstorm/`
- Modify: `store-catalog/brainstorm.json`

**Interfaces:**
- Produces: a shell that no longer mounts Brainstorm in-process; `brainstorm` is a launchable catalog entry.

- [ ] **Step 1: Frontend strip**

`editor/platform/catalog.ts`: remove the `import { BrainstormApp } from "../canvases/brainstorm/BrainstormApp";` line and the `brainstorm: BrainstormApp,` entry in `ROOTS`.

`store-catalog/brainstorm.json`: add `"launchable": true,`.

```bash
rm -rf editor/canvases/brainstorm
```

- [ ] **Step 2: Rust strip**

`src-tauri/src/lib.rs`: remove `mod brainstorm_canvas;`, the three `brainstorm_canvas::brainstorm_canvas_*` handler lines, the `canvas_server: brainstorm_canvas::CanvasServer` field + its initializer, and the `CloseRequested → brainstorm_canvas::shutdown` handler (revert the setup() close handler to not reference brainstorm). If removing `canvas_server` leaves `setup()`'s close handler empty, drop the now-empty handler.

```bash
rm src-tauri/src/brainstorm_canvas.rs
```

- [ ] **Step 3: Drop orphaned deps**

Grep for crates only `brainstorm_canvas.rs` used (likely none unique — it used std + serde_json + tauri, all shared). Run `cargo check`; if a dep is now unused it only warns, not errors — leave Cargo.toml unless a dep is *exclusively* brainstorm's (verify with grep across `src-tauri/src`).

- [ ] **Step 4: Verify shell green**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -5 && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5`
Expected: all PASS. (Catalog test still lists brainstorm — now Root-less/launchable.)

- [ ] **Step 5: Commit**

```bash
git add editor/platform/catalog.ts src-tauri/src/lib.rs store-catalog/brainstorm.json
git rm src-tauri/src/brainstorm_canvas.rs
git add -A editor/canvases
git commit -m "feat(launcher): strip Brainstorm from the shell (now launchable)"
```

---

## Task 13: Wire Brainstorm into bundle-apps.sh

**Files:**
- Modify: `scripts/bundle-apps.sh`

- [ ] **Step 1: Add the stage line**

In `scripts/bundle-apps.sh`, after `stage "apps/remit" "Remit.app"`, add:

```bash
stage "apps/brainstorm" "Brainstorm Canvas.app"
```

- [ ] **Step 2: Verify it stages (Brainstorm.app built in Task 11)**

Run: `bash scripts/bundle-apps.sh && ls -d "src-tauri/resources/apps/Brainstorm Canvas.app"`
Expected: prints `staged Brainstorm Canvas.app …` and the dir exists.

- [ ] **Step 3: Commit**

```bash
git add scripts/bundle-apps.sh
git commit -m "build(launcher): bundle Brainstorm Canvas.app into DreamStore resources"
```

---

## Task 14: E2E verification (automated + manual)

**Files:** none.

- [ ] **Step 1: Automated — build DreamStore with both apps bundled**

Run:
```bash
bash scripts/bundle-apps.sh
npm run tauri:build 2>&1 | tail -15
DS="src-tauri/target/release/bundle/macos/DreamStore.app"
ls -d "$DS/Contents/Resources/resources/apps/Brainstorm Canvas.app"
ls "$DS/Contents/Resources/resources/apps/Brainstorm Canvas.app/Contents/Resources/resources/canvas-server/dist/server.js"
```
Expected: DreamStore builds; `Brainstorm Canvas.app` nests inside it, AND its bundled `server.js` is present (the nested-resource chain).

- [ ] **Step 2: Automated — shell + standalone green**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -3 && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -2 && cargo test --manifest-path apps/brainstorm/src-tauri/Cargo.toml 2>&1 | grep "test result" | tail -3`
Expected: all PASS.

- [ ] **Step 3: Manual GUI smoke (needs a human — controller documents, does not run)**

Launch the built DreamStore, then:
1. Search "Brainstorm" → the card shows **Install** (not "Retry install"). Click Install → reaches "Installed" (copies `Brainstorm Canvas.app` to `~/Applications/DreamStore/`). Verify `ls -d ~/Applications/DreamStore/"Brainstorm Canvas.app"`.
2. Click **Open** → Brainstorm launches as its **own window** (agent panel), the board window opens with the live Excalidraw canvas (node server booted on a port), DreamStore stays on The Square.
3. Draw on the board / confirm the agent MCP wiring works; close Brainstorm → confirm the node server process is gone (`pgrep -f mcp-excalidraw-server` empty).
4. Uninstall → `~/Applications/DreamStore/Brainstorm Canvas.app` removed.
5. **Regression check:** a still-in-process app (e.g. **Pulse**) also shows **Install**, installs (registry-only), and Opens **in-window** (mounted), proving the dual-mode fix.

- [ ] **Step 4: Final commit (only if a fix was needed)**

If E2E surfaced a fix, commit with `fix(brainstorm-app): …`. Otherwise no commit.

---

## Self-Review

**Spec coverage (against `2026-07-08-ds2d1-brainstorm-standalone-design.md`):**
- D1.1 scaffold + shared core + isolated dirs + migration + capabilities + drag bar + Open-DreamStore → Tasks 2, 3, 9, 10. ✓
- D1.2 node server: `server_entry` via `resource_dir()`, bundle `mcp-excalidraw-server` as `resources/canvas-server/**/*`, spawn user's `node` → Tasks 5, 6. ✓
- D1.3 dual-mode install (`launchable` discriminator, registry-only for in-process, reconcile prunes only bundle installs, `InstalledEntry.bundle`) → Task 1. ✓
- D1.4 strip Brainstorm (catalog ROOTS, lib.rs modules/handlers/AppState/close, delete module, bundle-apps.sh, `launchable` catalog, spaced bundle name) → Tasks 12, 13. ✓
- D1.5 error handling (bundle-missing error; node-missing error; non-launchable always installs) → Task 1 (registry-only) + Task 5 (`entry.exists()` error). ✓
- D1.6 tests (pick_port, write_mcp_config, migration board.json, dual-mode install, spaced name) + E2E → Tasks 1, 5, 10, 14. ✓
- Agent stack (discovered in brainstorming, approved "copy wholesale") → Tasks 4, 7. ✓

**Placeholder scan:** No TBD/TODO. A few tasks say "resolve each unresolved-import error by copying the referenced file" — that's the decoupling method, not a placeholder; the file list is bounded by the copied trees. The agent-stack copy (Tasks 4/7) is inherently "copy verbatim + fix paths," which is the approved approach.

**Type consistency:** `InstalledEntry.bundle` (Task 1) used consistently in copy_bundle_into/install_registry_only/reconcile_in. `app_install(app, app_id, app_name, launchable)` (Task 1 Rust) ↔ `invoke("app_install", { appId, appName, launchable })` (Task 1 TS). `server_entry(app: &AppHandle) -> Result<PathBuf, String>` (Task 5) ↔ its call in `brainstorm_canvas_start(app, state)`. `brainstorm_canvas_start` gains `app: AppHandle` consistently (Task 5 + lib.rs handler). Bundle name `Brainstorm Canvas.app` consistent across Tasks 11/13/14 and the `bundle_name` normalizer from DS2′-B (handles the space via basename).

**Known risk carried:** the agent-stack copy (Tasks 4, 7) is the largest, least-mechanical part — unresolved cross-dir imports are resolved by copying referenced files into `apps/brainstorm/src/`. If a copied module pulls a shell-only dependency not anticipated (e.g. a `canvas`/`substrate` type), the implementer copies or inlines that type; flagged so the reviewer expects import-resolution churn in these two tasks.
