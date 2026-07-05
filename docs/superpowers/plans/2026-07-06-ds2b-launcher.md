# DS2′-B Launcher Cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn DreamStore from an in-process app-mounter into a pure launcher that install-copies a bundled `.app` out of its own Resources and spawns it as an independent macOS process, wired end-to-end to the already-extracted standalone Remit.

**Architecture:** The Rust `store.rs` gains an `app_launch` command (`open`s the installed bundle) and `app_install` is rewritten to copy `DreamStore.app/Contents/Resources/apps/<App>.app` → `~/Applications/DreamStore/<App>.app` (atomic temp+rename) instead of writing frontend-supplied bytes. The React "Open" CTA calls `invoke("app_launch")` for `launchable` apps instead of flipping `currentId`; non-launchable apps keep the in-process mount path during the D1–D4 transition. Remit becomes the one `launchable` app: its in-process overlay `Root` wiring is removed and its built `Remit.app` is bundled into DreamStore's Resources via a documented pre-build script.

**Tech Stack:** Rust + Tauri 2 (`tauri::AppHandle`, `app.path().resource_dir()`, `std::process::Command`), React + TypeScript (`@tauri-apps/api/core` `invoke`), Vitest, `tempfile` for Rust tests, macOS `open`.

## Global Constraints

Copied verbatim from the spec (`docs/superpowers/specs/2026-07-06-dreamstore-launcher-pivot-design.md`); every task's requirements implicitly include these:

- **Spawn model:** launcher runs `open ~/Applications/DreamStore/<App>.app` (fallback `open -b <bundle-id>`). Each app is a fully independent macOS `.app`. Not Tauri child-windows.
- **Bundle source:** each app's built `.app` ships inside `DreamStore.app` at `Contents/Resources/apps/<App>.app`. "Install" copies it out to `~/Applications/DreamStore/<App>.app`. Offline, self-contained.
- **Keep in `store.rs`:** the registry write, the `safe_name` traversal guard, and `reconcile`.
- **Resolve the resource dir via Tauri's `app.path().resource_dir()`** (mirror `video.rs`'s `BaseDirectory::Resource` pattern).
- **macOS only.** No Windows/Linux paths.
- **`resources/apps/` is git-ignored** (holds built `.app`s; same posture as other build output).
- **Transition dual-mode:** while D1–D4 are not done, `launchable` apps take the spawn path and every other app keeps the `setCurrentId` mount path. Both must keep working so every intermediate build ships.
- **Shell stays green:** `tsc` + `npm test` + `cargo check` must all pass.
- **Bundle identifiers (verified in repo):** DreamStore = `app.altramanera.dreamstore`; Remit = `app.altramanera.remit`, `productName` "Remit" → built bundle `Remit.app`.

---

## File Structure

**Backend (`src-tauri/`)**
- `src/store.rs` — MODIFY. Add `app_launch`; rewrite `app_install` to copy a bundled `.app` from a resources dir into the install root; keep `app_uninstall`/`app_install_states`/`reconcile`/`safe_name`/registry. Reconcile predicate changes from `…/manifest.json` to `…<App>.app` existence. Extend the test module.
- `src/lib.rs` — MODIFY. Register `store::app_launch` in the `invoke_handler`.
- `tauri.conf.json` — MODIFY. Add `resources/apps/*` to `bundle.resources`.
- `.gitignore` — MODIFY. Ignore `src-tauri/resources/apps/`.
- `scripts/bundle-apps.sh` — CREATE. Copies each standalone app's built `.app` into `src-tauri/resources/apps/` before the repo-root `npm run tauri:build`.

**Frontend (`editor/`)**
- `platform/apps.ts` — MODIFY. Add `launchable?: boolean` to `AppManifest`.
- `platform/install.ts` — MODIFY. `startInstall` stops sending `manifestJson`/`assets` for launchable apps (the copy needs neither); add `launchApp(appId)` calling `invoke("app_launch", { appId })`.
- `platform/AppRow.tsx` / `platform/AppDrawer.tsx` — MODIFY. "Open" CTA routes through the parent `onOpen(id)` which now decides launch-vs-mount (no direct change needed if `onOpen` owns the decision — see Task 6).
- `App.tsx` — MODIFY. `Square`'s `onOpen` handler: if the app is `launchable`, call `launchApp(id)`; else keep the `setCurrentId(id)` mount path.
- `apps-private/remit/app.tsx` — MODIFY. Mark the Remit manifest `launchable: true` and drop its `Root` so it can only be launched, not mounted.
- `platform/__tests__/install.test.ts` — MODIFY. Update the install assertion and add `launchApp` + launchable-install tests.

---

## Task 1: Add `launchable` to the manifest type

**Files:**
- Modify: `editor/platform/apps.ts:70` (add field to `AppManifest`)

**Interfaces:**
- Produces: `AppManifest.launchable?: boolean` — read by `App.tsx` (Task 6) and `install.ts` (Task 5) to choose the spawn path.

- [ ] **Step 1: Add the field**

In `editor/platform/apps.ts`, inside the `AppManifest` type, after the `Root?` field (line ~70), add:

```typescript
  /** When true, "Open" spawns this app as its own standalone `.app`
   *  (via `app_launch`) instead of mounting its `Root` in-process. Its
   *  built bundle is copied out on install. Apps without this stay
   *  in-process during the D1–D4 transition. */
  launchable?: boolean;
```

- [ ] **Step 2: Typecheck**

Run: `npm run -s tsc 2>/dev/null || npx tsc --noEmit`
Expected: PASS (no new errors; the field is optional so no existing manifest breaks).

- [ ] **Step 3: Commit**

```bash
git add editor/platform/apps.ts
git commit -m "feat(launcher): add launchable flag to AppManifest"
```

---

## Task 2: Rust `app_launch` command

**Files:**
- Modify: `src-tauri/src/store.rs` (add `app_launch` + a testable helper + tests)

**Interfaces:**
- Consumes: existing `read_registry`, `install_root`, `registry_path`, `InstalledEntry` in `store.rs`.
- Produces: `#[tauri::command] pub fn app_launch(app_id: String) -> Result<(), String>` (registered in Task 4) and a pure helper `fn resolve_installed_bundle(base: &Path, reg: &Path, app_id: &str) -> Result<PathBuf, String>` used by tests.

- [ ] **Step 1: Write the failing test**

Append to the `tests` module in `src-tauri/src/store.rs` (before the closing `}`):

```rust
    #[test]
    fn launch_resolves_installed_bundle_path() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        // Simulate an installed app: registry entry + a bundle dir on disk.
        fs::create_dir_all(base.join("Remit.app")).unwrap();
        write_registry(&reg, &[InstalledEntry { id: "remit".into(), name: "Remit.app".into() }])
            .unwrap();

        let path = resolve_installed_bundle(&base, &reg, "remit").unwrap();
        assert_eq!(path, base.join("Remit.app"));
    }

    #[test]
    fn launch_errors_when_not_installed() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        // No registry entry at all.
        assert!(resolve_installed_bundle(&base, &reg, "remit").is_err());
    }

    #[test]
    fn launch_errors_when_registered_but_bundle_missing() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        // Registered but the .app on disk is gone.
        write_registry(&reg, &[InstalledEntry { id: "remit".into(), name: "Remit.app".into() }])
            .unwrap();
        assert!(resolve_installed_bundle(&base, &reg, "remit").is_err());
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml store:: 2>&1 | tail -20`
Expected: FAIL — `cannot find function resolve_installed_bundle in this scope`.

- [ ] **Step 3: Write the implementation**

In `src-tauri/src/store.rs`, add the helper and command. Put the helper just above `#[tauri::command] pub fn app_install` (~line 135), and the command just below `app_install_states` (~line 156):

```rust
/// Resolve the installed `.app` bundle path for an app id, erroring if the
/// app isn't registered or its bundle is gone. Pure (no process spawn) so it
/// can be unit-tested.
fn resolve_installed_bundle(base: &Path, reg: &Path, app_id: &str) -> Result<PathBuf, String> {
    let entry = read_registry(reg)
        .into_iter()
        .find(|e| e.id == app_id)
        .ok_or_else(|| format!("app not installed: {}", app_id))?;
    let name = safe_name(&entry.name)?;
    let bundle = base.join(name);
    if !bundle.exists() {
        return Err(format!("installed bundle missing: {}", bundle.display()));
    }
    Ok(bundle)
}
```

```rust
#[tauri::command]
pub fn app_launch(app_id: String) -> Result<(), String> {
    let bundle = resolve_installed_bundle(&install_root(), &registry_path(), &app_id)?;
    // macOS `open` focuses an already-running app instead of duplicating it.
    std::process::Command::new("open")
        .arg(&bundle)
        .status()
        .map_err(|e| format!("open {}: {}", bundle.display(), e))
        .and_then(|s| if s.success() { Ok(()) } else { Err("open failed".into()) })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml store:: 2>&1 | tail -20`
Expected: PASS — all `store::tests` pass, including the three new `launch_*` tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/store.rs
git commit -m "feat(launcher): app_launch resolves + opens the installed bundle"
```

---

## Task 3: Rewrite `app_install` as a bundle copy

**Files:**
- Modify: `src-tauri/src/store.rs` (rewrite `install_into` copy semantics + `app_install` signature + `reconcile_in` predicate; update the docstring; replace asset-oriented tests with bundle-copy tests)

**Interfaces:**
- Consumes: `safe_name`, `read_registry`, `write_registry`, `InstalledEntry`, `install_root`, `registry_path`.
- Produces:
  - `fn copy_bundle_into(base: &Path, reg: &Path, resources_apps: &Path, app_id: &str, app_name: &str) -> Result<(), String>` — copies `resources_apps/<app_name>` → `base/<app_name>` via temp+rename, writes the registry. Pure/testable (no `AppHandle`).
  - `#[tauri::command] pub fn app_install(app: tauri::AppHandle, app_id: String, app_name: String) -> Result<(), String>` — resolves `resources/apps` via `app.path().resource_dir()` and delegates to `copy_bundle_into`. **Signature dropped `manifest_json` + `assets`.**
- Note: `install.ts` (Task 5) stops passing `manifestJson`/`assets`; `install-assets.ts` becomes unused by launchable apps (left in place — non-surgical to delete; flagged, not removed).

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/store.rs`, the existing tests reference the old `install_into(base, reg, id, name, manifest, assets)` signature. **Replace the whole `#[cfg(test)] mod tests { … }` block** with this bundle-copy test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Make a fake `.app` bundle (a dir with a marker file) under `resources_apps`.
    fn fake_bundle(resources_apps: &Path, name: &str) {
        let app = resources_apps.join(name);
        fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
        fs::write(app.join("Contents/Info.plist"), b"<plist/>").unwrap();
    }

    #[test]
    fn install_copies_bundle_and_records_registry() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        let res = dir.path().join("resources/apps");
        fake_bundle(&res, "Remit.app");

        copy_bundle_into(&base, &reg, &res, "remit", "Remit.app").unwrap();

        assert!(base.join("Remit.app/Contents/Info.plist").exists());
        assert!(fs::read_to_string(&reg).unwrap().contains("remit"));
    }

    #[test]
    fn install_errors_when_bundle_absent_from_resources() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        let res = dir.path().join("resources/apps"); // empty, no Remit.app
        fs::create_dir_all(&res).unwrap();

        let err = copy_bundle_into(&base, &reg, &res, "remit", "Remit.app").unwrap_err();
        assert!(err.contains("app bundle not found"), "got: {}", err);
    }

    #[test]
    fn install_overwrites_existing_bundle_idempotently() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        let res = dir.path().join("resources/apps");
        fake_bundle(&res, "Remit.app");

        copy_bundle_into(&base, &reg, &res, "remit", "Remit.app").unwrap();
        // Re-install (e.g. after an app update) must not error or leave staging.
        copy_bundle_into(&base, &reg, &res, "remit", "Remit.app").unwrap();
        assert!(base.join("Remit.app/Contents/Info.plist").exists());
        assert!(!base.join(".Remit.app.staging").exists());
    }

    #[test]
    fn install_rejects_traversal_app_name() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        let res = dir.path().join("resources/apps");
        fs::create_dir_all(&res).unwrap();

        assert!(copy_bundle_into(&base, &reg, &res, "evil", "../escape").is_err());
        assert!(!dir.path().join("escape").exists());
        assert!(copy_bundle_into(&base, &reg, &res, "evil", "/tmp/evil-ds-test.app").is_err());
        assert!(!Path::new("/tmp/evil-ds-test.app").exists());
    }

    #[test]
    fn uninstall_removes_bundle_and_registry_entry() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        let res = dir.path().join("resources/apps");
        fake_bundle(&res, "Remit.app");
        copy_bundle_into(&base, &reg, &res, "remit", "Remit.app").unwrap();

        uninstall_into(&base, &reg, "remit", "Remit.app").unwrap();
        assert!(!base.join("Remit.app").exists());
        assert!(!fs::read_to_string(&reg).unwrap().contains("remit"));
    }

    #[test]
    fn reconcile_drops_entry_when_bundle_gone() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        let res = dir.path().join("resources/apps");
        fake_bundle(&res, "Remit.app");
        copy_bundle_into(&base, &reg, &res, "remit", "Remit.app").unwrap();

        fs::remove_dir_all(base.join("Remit.app")).unwrap();
        reconcile_in(&base, &reg);
        assert!(!fs::read_to_string(&reg).unwrap().contains("remit"));
    }

    // ---- launch resolution (from Task 2) ----

    #[test]
    fn launch_resolves_installed_bundle_path() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        fs::create_dir_all(base.join("Remit.app")).unwrap();
        write_registry(&reg, &[InstalledEntry { id: "remit".into(), name: "Remit.app".into() }])
            .unwrap();
        assert_eq!(
            resolve_installed_bundle(&base, &reg, "remit").unwrap(),
            base.join("Remit.app")
        );
    }

    #[test]
    fn launch_errors_when_not_installed() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        assert!(resolve_installed_bundle(&base, &reg, "remit").is_err());
    }

    #[test]
    fn launch_errors_when_registered_but_bundle_missing() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        write_registry(&reg, &[InstalledEntry { id: "remit".into(), name: "Remit.app".into() }])
            .unwrap();
        assert!(resolve_installed_bundle(&base, &reg, "remit").is_err());
    }
}
```

(The two `launch_*` tests from Task 2 are folded in here so the final block is self-contained; do not keep a duplicate copy from Task 2.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml store:: 2>&1 | tail -25`
Expected: FAIL — `cannot find function copy_bundle_into in this scope` (and the old `install_into`/asset tests are gone).

- [ ] **Step 3: Write the implementation**

In `src-tauri/src/store.rs`:

**(a)** Update the module docstring's DS-1 "STATE MARKER" paragraph (lines ~9–14) to describe the new copy model. Replace that paragraph with:

```rust
//! In DS2′-B the installed folder IS the app: `app_install` copies the built
//! `<App>.app` bundle out of `DreamStore.app/Contents/Resources/apps/` into
//! `~/Applications/DreamStore/<App>.app`, and `app_launch` `open`s it as an
//! independent macOS process. `app_install_states`/`reconcile` track presence
//! by the bundle on disk (not a manifest file).
```

**(b)** Replace the `install_into` function (lines ~79–114) with `copy_bundle_into`. It recursively copies a directory tree via a small helper (std has no recursive copy). Add both:

```rust
/// Recursively copy a directory tree (std has no built-in recursive copy).
fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("mkdir {}: {}", dst.display(), e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("read {}: {}", src.display(), e))? {
        let entry = entry.map_err(|e| format!("dir entry: {}", e))?;
        let ty = entry.file_type().map_err(|e| format!("file type: {}", e))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| format!("copy {}: {}", from.display(), e))?;
        }
    }
    Ok(())
}

/// Copy the bundled `<app_name>` (a `.app` dir) from `resources_apps` into the
/// install root via a staged temp + rename, then record the registry entry.
fn copy_bundle_into(
    base: &Path,
    reg: &Path,
    resources_apps: &Path,
    app_id: &str,
    app_name: &str,
) -> Result<(), String> {
    let app_name = safe_name(app_name)?;
    let source = resources_apps.join(app_name);
    if !source.exists() {
        return Err(format!("app bundle not found in DreamStore resources: {}", source.display()));
    }
    let app_dir = base.join(app_name);
    let staging = base.join(format!(".{}.staging", app_name));
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    copy_dir_all(&source, &staging)?;
    if app_dir.exists() {
        fs::remove_dir_all(&app_dir).map_err(|e| format!("clear old: {}", e))?;
    }
    fs::rename(&staging, &app_dir).map_err(|e| format!("rename into place: {}", e))?;

    let mut entries = read_registry(reg);
    if let Some(e) = entries.iter_mut().find(|e| e.id == app_id) {
        e.name = app_name.to_string();
    } else {
        entries.push(InstalledEntry { id: app_id.to_string(), name: app_name.to_string() });
    }
    write_registry(reg, &entries)
}
```

**(c)** Delete the now-unused `InstallAsset` struct (lines ~24–28) — `app_install` no longer takes assets. Also remove `use` of it if any (there is none besides the struct def).

**(d)** Rewrite the `app_install` command (lines ~135–143) to resolve the resource dir and delegate:

```rust
#[tauri::command]
pub fn app_install(app: tauri::AppHandle, app_id: String, app_name: String) -> Result<(), String> {
    use tauri::Manager;
    let resources_apps = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resolve resource dir: {}", e))?
        .join("resources/apps");
    copy_bundle_into(&install_root(), &registry_path(), &resources_apps, &app_id, &app_name)
}
```

**(e)** Change the `reconcile_in` predicate (line ~130) from the manifest-file check to a bundle-existence check:

```rust
fn reconcile_in(base: &Path, reg: &Path) {
    let kept: Vec<InstalledEntry> = read_registry(reg)
        .into_iter()
        .filter(|e| base.join(&e.name).exists())
        .collect();
    let _ = write_registry(reg, &kept);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml store:: 2>&1 | tail -25`
Expected: PASS — all bundle-copy + launch tests pass.

- [ ] **Step 5: Verify the crate still checks (the signature change touches `lib.rs` in Task 4, so expect one error here)**

Run: `cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -15`
Expected: The library compiles for `store.rs` itself. `lib.rs` still lists the OLD `app_install` args indirectly only via `generate_handler!` — `generate_handler!` infers args from the fn, so no arg list to update there. If `cargo check` is green, good. If it errors on `InstallAsset` being referenced elsewhere, grep and fix:

Run: `grep -rn "InstallAsset" src-tauri/src/`
Expected: no matches outside the (now-deleted) definition.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/store.rs
git commit -m "feat(launcher): app_install copies the bundled .app instead of writing asset bytes"
```

---

## Task 4: Register `app_launch` in the Tauri handler

**Files:**
- Modify: `src-tauri/src/lib.rs:138` (add `store::app_launch` to `invoke_handler`)

**Interfaces:**
- Consumes: `store::app_launch` (Task 2).

- [ ] **Step 1: Register the command**

In `src-tauri/src/lib.rs`, in the `tauri::generate_handler![…]` list, next to the other `store::` entries (lines ~136–138), add `store::app_launch`:

```rust
            store::app_install,
            store::app_launch,
            store::app_uninstall,
            store::app_install_states,
```

- [ ] **Step 2: Verify the crate compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -15`
Expected: PASS — no errors. (`generate_handler!` now includes `app_launch`; `app_install`'s new `AppHandle` first arg is injected by Tauri, not listed here.)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(launcher): register app_launch command"
```

---

## Task 5: Frontend `launchApp` + launchable-aware install

**Files:**
- Modify: `editor/platform/install.ts` (add `launchApp`; drop manifest/assets from `startInstall` for launchable apps)
- Modify: `editor/platform/__tests__/install.test.ts` (update assertion; add launch + launchable-install tests)

**Interfaces:**
- Consumes: `findApp` (returns `AppManifest` with `launchable` from Task 1), `invoke`, `isTauri`.
- Produces: `export const launchApp = async (appId: string): Promise<void>` — calls `invoke("app_launch", { appId })`. Used by `App.tsx` (Task 6).

- [ ] **Step 1: Write the failing tests**

In `editor/platform/__tests__/install.test.ts`:

**(a)** The current test asserts `app_install` is called with `appId: "remit"` and (implicitly) the old manifest/assets shape. Update the `startInstall` assertion to reflect the new no-payload call, and add two tests. Replace the `startInstall calls app_install…` test and append new ones:

```typescript
  it("startInstall calls app_install with only ids (bundle copy, no assets)", async () => {
    invoke.mockResolvedValue(undefined);
    await startInstall("remit");
    expect(invoke).toHaveBeenCalledWith("app_install", {
      appId: "remit",
      appName: "Remit",
    });
    expect(getInstallState("remit").state).toBe("installed");
  });

  it("launchApp invokes app_launch with the app id", async () => {
    invoke.mockResolvedValue(undefined);
    await launchApp("remit");
    expect(invoke).toHaveBeenCalledWith("app_launch", { appId: "remit" });
  });
```

Add `launchApp` to the import list at the top of the file:

```typescript
import {
  getInstallState,
  startInstall,
  uninstall,
  refreshInstallStates,
  launchApp,
  __resetInstallCacheForTests,
} from "../install";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run editor/platform/__tests__/install.test.ts 2>&1 | tail -25`
Expected: FAIL — `launchApp` is not exported; the `app_install` assertion fails against the current manifest/assets call.

- [ ] **Step 3: Write the implementation**

In `editor/platform/install.ts`:

**(a)** Change `startInstall` (lines ~88–114) to stop resolving assets and stop sending the manifest — the Rust side copies a bundle now. Replace the body between `notify(appId, { state: "installing"… })` and the success `notify`:

```typescript
  notify(appId, { state: "installing", progress: 0, installedAt: null, error: null });
  try {
    if (!isTauri()) throw new Error("install requires the desktop app");
    await invoke("app_install", { appId, appName: app.name });
    notify(appId, {
      state: "installed",
      progress: 1,
      installedAt: new Date().toISOString(),
      error: null,
    });
  } catch (e) {
    notify(appId, { state: "failed", progress: 0, installedAt: null, error: String(e) });
  }
```

Remove the now-unused import of `installAssetsFor` at the top of the file (line ~17: `import { installAssetsFor } from "./install-assets";`) and the `const { Root, ...data } = app;` line. `findApp` is still used.

> Note: `install-assets.ts` is now unreferenced by launchable apps. Leaving the module in place is intentional (surgical change; a later D-cycle or cleanup can delete it). Flag, don't delete.

**(b)** Add `launchApp` after `uninstall` (~line 130):

```typescript
/** Spawn a launchable app as its own standalone `.app`. No-op outside Tauri. */
export const launchApp = async (appId: string): Promise<void> => {
  if (!isTauri()) return;
  await invoke("app_launch", { appId });
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run editor/platform/__tests__/install.test.ts 2>&1 | tail -20`
Expected: PASS — all install tests green.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -15`
Expected: PASS — no unused-import errors (both dead imports removed).

- [ ] **Step 6: Commit**

```bash
git add editor/platform/install.ts editor/platform/__tests__/install.test.ts
git commit -m "feat(launcher): launchApp + install no longer ships asset bytes"
```

---

## Task 6: Route "Open" through launch-vs-mount

**Files:**
- Modify: `editor/App.tsx:186-191` (the `Square` `onOpen` handler)

**Interfaces:**
- Consumes: `launchApp` (Task 5), `AppManifest.launchable` (Task 1), existing `findApp`, `canOpen`, `setCurrentId`.

The `Square`/`AppRow`/`AppDrawer` "Open" CTA already funnels through the single `onOpen(id)` callback (`AppRow` calls `onOpen`; `AppDrawer` calls `onOpen`; `Square` forwards to `App.tsx`'s handler). So the only change is in `App.tsx`'s handler — no edits to `AppRow.tsx`/`AppDrawer.tsx`/`Square.tsx`.

- [ ] **Step 1: Update the handler**

In `editor/App.tsx`, change the `Square onOpen` handler (lines ~186–191) so launchable apps spawn and others mount:

```tsx
          <Square
            onOpen={(id) => {
              const app = APPS.find((a) => a.id === id);
              if (!app || app.status !== "available" || !canOpen(id)) return;
              if (app.launchable) {
                void launchApp(id);
                return;
              }
              if (app.Root) setCurrentId(id);
            }}
          />
```

Add `launchApp` to the install import at the top of `App.tsx` (line ~27):

```tsx
import { canOpen, launchApp, refreshInstallStates } from "./platform/install";
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -15`
Expected: PASS.

- [ ] **Step 3: Run the frontend tests (nothing should regress)**

Run: `npm test 2>&1 | tail -20`
Expected: PASS — existing platform/catalog tests still green.

- [ ] **Step 4: Commit**

```bash
git add editor/App.tsx
git commit -m "feat(launcher): Open spawns launchable apps, mounts the rest"
```

---

## Task 7: Make Remit launchable-only (drop its in-process Root)

**Files:**
- Modify: `editor/apps-private/remit/app.tsx` (mark `launchable`, remove `Root`)

**Interfaces:**
- Consumes: `AppManifest.launchable` (Task 1).
- Produces: a Remit manifest with `launchable: true` and NO `Root`, so `App.tsx`'s handler takes the spawn path and the in-process mount can never fire for Remit.

Remit is a **private** app: its manifest lives in the git-ignored overlay `editor/apps-private/remit/app.tsx` (not in `store-catalog/`). This is consistent with `resources/apps/` being git-ignored too — a shared clone has neither the overlay nor the bundle.

- [ ] **Step 1: Edit the manifest**

In `editor/apps-private/remit/app.tsx`:

- Remove the `import { RemitApp } from "./RemitApp";` line.
- Remove the `Root: RemitApp,` line from the manifest.
- Add `launchable: true,` to the manifest (e.g. right after `status: "available",`).

Resulting manifest object (unchanged fields elided):

```tsx
import type { PrivateApp } from "../../platform/apps";

const remit: PrivateApp = {
  manifest: {
    id: "remit",
    name: "Remit",
    // …blurb, description, creator, version, tokens, files, loc,
    //   rating, ratingCount, tags, hue unchanged…
    status: "available",
    launchable: true,
    releasedAt: "2026-07-03",
    sizeBytes: 1_500_000,
    category: "private",
    visibility: "private",
  },
};

export default remit;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -15`
Expected: PASS — `Root` is optional, `RemitApp` import removed so no unused-import error.

> Note: `RemitApp.tsx` and the rest of `apps-private/remit/` (`Preview.tsx`, `FormPanel.tsx`, canvas plugin in `index.tsx`, etc.) remain — they're still the source that the *standalone* `apps/remit/` was built from, and deleting them is out of scope for this task. The spec only requires removing the in-process **mount wiring** (the `Root`), which the manifest edit accomplishes.

- [ ] **Step 3: Run tests**

Run: `npm test 2>&1 | tail -20`
Expected: PASS — Remit still appears in the catalog (manifest present) but is no longer mountable.

- [ ] **Step 4: Commit**

```bash
git add editor/apps-private/remit/app.tsx
git commit -m "feat(launcher): Remit is launchable-only (drop in-process Root)"
```

---

## Task 8: Bundle Remit.app into DreamStore's resources

**Files:**
- Create: `scripts/bundle-apps.sh`
- Modify: `src-tauri/tauri.conf.json:41` (add `resources/apps/*` to `bundle.resources`)
- Modify: `.gitignore` (ignore `src-tauri/resources/apps/`)

**Interfaces:**
- Produces: `src-tauri/resources/apps/Remit.app` (git-ignored, populated by the script) so `app_install`'s `resource_dir().join("resources/apps")` resolves it in a built DreamStore.

- [ ] **Step 1: Add `resources/apps/*` to the bundle**

In `src-tauri/tauri.conf.json`, change the `bundle.resources` array (line ~41) from:

```json
    "resources": ["resources/bin/yt-dlp"],
```

to:

```json
    "resources": ["resources/bin/yt-dlp", "resources/apps/*"],
```

- [ ] **Step 2: Git-ignore the built bundles**

Append to `.gitignore` (near the other build-output/private sections):

```
# Built standalone .app bundles staged into DreamStore's resources by
# scripts/bundle-apps.sh before `npm run tauri:build`. Build output, not source.
src-tauri/resources/apps/
```

- [ ] **Step 3: Write the bundle script**

Create `scripts/bundle-apps.sh`:

```bash
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
```

Make it executable:

```bash
chmod +x scripts/bundle-apps.sh
```

- [ ] **Step 4: Verify the script stages Remit (the standalone build already exists in this repo)**

Run: `bash scripts/bundle-apps.sh && ls -d src-tauri/resources/apps/Remit.app`
Expected: prints `staged Remit.app -> …` and lists the copied `Remit.app`. (The built `Remit.app` is already present at `apps/remit/src-tauri/target/release/bundle/macos/Remit.app` per the DS2′-A work.)

- [ ] **Step 5: Verify tsc + tests + cargo check still green**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -5 && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/bundle-apps.sh src-tauri/tauri.conf.json .gitignore
git commit -m "build(launcher): bundle standalone .app bundles into DreamStore resources"
```

---

## Task 9: Manual E2E verification (the real proof)

**Files:** none (verification only).

This is the spec's B.5 "real proof". It requires a full DreamStore build with Remit bundled, so it can't be a unit test. Run it once at the end.

- [ ] **Step 1: Ensure the standalone Remit is built**

Run: `ls -d apps/remit/src-tauri/target/release/bundle/macos/Remit.app 2>/dev/null || (cd apps/remit && npm run tauri:build)`
Expected: `Remit.app` exists (build it if missing — this is slow).

- [ ] **Step 2: Stage the bundle, then build DreamStore**

Run: `bash scripts/bundle-apps.sh && npm run tauri:build 2>&1 | tail -20`
Expected: DreamStore builds; the produced `DreamStore.app` contains `Contents/Resources/resources/apps/Remit.app`.

Verify the bundle landed inside the built app:

Run: `find "$(pwd)/src-tauri/target/release/bundle/macos/DreamStore.app" -name Remit.app`
Expected: prints the path to the nested `Remit.app`.

- [ ] **Step 3: Drive the launcher (manual, documented)**

Launch the built DreamStore, then in the UI:
1. Search "Remit" → the Remit card appears.
2. Click **Install** → the button reaches "Installed" (this copies the bundle to `~/Applications/DreamStore/Remit.app`). Verify:
   `ls -d ~/Applications/DreamStore/Remit.app` → exists.
3. Click **Open** → Remit launches as its **own independent window / dock icon** (a separate process, not mounted inside DreamStore). Confirm DreamStore's own window still shows The Square (it did not navigate into Remit).
4. In the drawer, click **Uninstall** → verify:
   `ls -d ~/Applications/DreamStore/Remit.app` → gone.

- [ ] **Step 4: Confirm the shell no longer mounts Remit in-window**

In DreamStore, confirm there is no in-window Remit view (opening Remit never replaces The Square with Remit's `Root`). This is the observable proof that Task 7's Root removal + Task 6's launch routing worked together.

- [ ] **Step 5: Final green check + commit any doc notes**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -5 && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5`
Expected: all PASS.

No code commit expected here unless E2E surfaced a fix; if it did, commit that fix with a `fix(launcher): …` message.

---

## Self-Review

**Spec coverage (against `2026-07-06-dreamstore-launcher-pivot-design.md` §DS2′-B):**

- B.1 `app_launch` (resolve installed bundle → `open`, error if not installed) → **Task 2**. ✓
- B.1 `app_install` becomes a real bundle copy (resource dir → temp → atomic rename; keep registry + `safe_name` + `reconcile`) → **Task 3**. ✓
- B.1 `app_uninstall` removes the copied `.app` + registry entry → unchanged `uninstall_into` already removes the folder (now the folder is the `.app`); covered by Task 3's `uninstall_removes_bundle…` test. ✓
- B.1 `app_install_states` unchanged; reconcile prunes gone bundles → **Task 3** (predicate switched to bundle existence). ✓
- B.2 `bundle.resources` includes `resources/apps/*`; `bundle-apps.sh` copies built bundles; `resources/apps/` git-ignored → **Task 8**. ✓
- B.3 "Open" CTA → `invoke("app_launch")` instead of `setCurrentId` → **Tasks 5 + 6**. ✓
- B.3 manifest gains `launchable?` and dual-mode transition → **Tasks 1 + 6**. ✓
- B.3 Remit stops mounting in-window (remove its overlay `Root`); manifest stays so it appears in the store; add `Remit.app` to `Resources/apps/` → **Tasks 7 + 8**. ✓
- B.3 `PlatformChrome` back-button/`onExit` stay for still-in-process apps → left untouched (Task 6 changes only the open path). ✓
- B.4 launch-not-installed error; bundle-missing-from-resources error; Gatekeeper note → `app_launch` errors (Task 2 tests), `copy_bundle_into` "app bundle not found in DreamStore resources" (Task 3 test); Gatekeeper is a documented DS2′-C concern, no code. ✓
- B.5 Rust unit tests (launch resolution + install-copy + traversal guard) → Tasks 2 + 3; manual E2E → Task 9; shell stays green (`tsc`+`npm test`+`cargo check`) → verified in Tasks 5/6/8/9. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N" — every code step shows the actual code.

**Type consistency:** `app_launch(app_id: String)` ↔ `invoke("app_launch", { appId })` (Tauri snake↔camel). `app_install(app: AppHandle, app_id, app_name)` ↔ `invoke("app_install", { appId, appName })`. `resolve_installed_bundle` / `copy_bundle_into` / `copy_dir_all` names match across Tasks 2–3. `launchApp` name matches across Tasks 5–6. `launchable` field name matches across Tasks 1/6/7.

**One deliberate deviation from a literal spec reading:** the spec says "Keep the registry write + `safe_name` traversal guard + `reconcile`" — kept. It does not spell out that dropping `manifest_json`/`assets` from `app_install` also makes `install-assets.ts` dead for launchable apps; the plan flags this (Task 5) and leaves the module in place rather than deleting it, honoring the surgical-change rule. If a later cleanup wants it gone, that's a separate change.
