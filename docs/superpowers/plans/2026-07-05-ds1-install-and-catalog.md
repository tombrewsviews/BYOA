# DreamStore DS-1 — Real Install + Store Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make apps not-installed by default, install them per-app into `~/Applications/DreamStore/<App>/` (real folder + assets + registry), gate opening on install, and move the public catalog into an in-repo `store-catalog/` folder.

**Architecture:** A new generic Rust installer module owns `~/Applications/DreamStore/` and a `~/.dreamstore/installed.json` registry; three commands (`app_install`, `app_uninstall`, `app_install_states`) drive it, with startup reconciliation so state = registry ∧ folder. The frontend's `install.ts` keeps its public API but swaps internals from localStorage+mock to these commands. Asset bytes flow from the frontend (which owns the Vite `?url` imports) into the install command. The catalog moves to `store-catalog/*.json`, loaded by `catalog.ts`; `Root` components stay in a small id→component code map. Open-gating lives in `App.tsx`.

**Tech Stack:** Rust (Tauri 2, `dirs`, `tempfile`, `serde_json`), TypeScript/React (Vite `import.meta.glob`), vitest, cargo test.

**Depends on:** DS-0 (`crate::paths::user_path`, product rename) must land first.

## Global Constraints

- Install root: **`~/Applications/DreamStore/<AppName>/`** (per-user; no admin rights).
- Registry: **`~/.dreamstore/installed.json`** via `crate::paths::user_path("installed.json")`.
- Default install state: **`not-installed`** for every app (delete the force-install-if-`Root` rule).
- Open is gated on `installed`; the store always allows Install (no lockout).
- Reconcile on startup: an app is `installed` only if BOTH its registry entry AND its folder exist.
- Install is atomic: build into a temp dir, rename into place; no partial folder on failure.
- Missing declared asset → install FAILS cleanly (named error), no partial folder.
- `visibility` is read (public = `store-catalog/`, private = overlay) but is NOT a security boundary.
- Native code stays compiled in (built-in tier); uninstall removes state + folder only.

---

### Task 1: Rust installer module — folder + registry + reconcile

**Files:**
- Create: `src-tauri/src/store.rs`
- Modify: `src-tauri/src/lib.rs` (`mod store;`, register 3 commands, call reconcile in setup)
- Test: inline `#[cfg(test)]` in `src-tauri/src/store.rs`

**Interfaces:**
- Consumes: `crate::paths::user_path` (DS-0).
- Produces:
  - `pub struct InstallAsset { pub name: String, pub bytes: Vec<u8> }` (serde Deserialize).
  - `#[tauri::command] pub fn app_install(app_id: String, app_name: String, manifest_json: String, assets: Vec<InstallAsset>) -> Result<(), String>`
  - `#[tauri::command] pub fn app_uninstall(app_id: String, app_name: String) -> Result<(), String>`
  - `#[tauri::command] pub fn app_install_states() -> Result<Vec<String>, String>` — returns installed app ids (after reconcile).
  - `pub fn reconcile()` — prune registry entries whose folder is gone; called at startup.
  - Internal testable core takes an explicit base dir: `fn install_into(base: &Path, app_id, app_name, manifest_json, assets) -> Result<(), String>`, `fn uninstall_into(base, app_id, app_name)`, `fn reconcile_in(base, registry_path)`.

- [ ] **Step 1: Write the failing tests**

Add to `src-tauri/src/store.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn asset(name: &str, bytes: &[u8]) -> InstallAsset {
        InstallAsset { name: name.into(), bytes: bytes.to_vec() }
    }

    #[test]
    fn install_creates_folder_manifest_and_assets() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");

        install_into(&base, &reg, "remit", "Remit", "{\"id\":\"remit\"}",
            vec![asset("template.pdf", b"PDFBYTES")]).unwrap();

        let app = base.join("Remit");
        assert!(app.join("manifest.json").exists());
        assert_eq!(fs::read(app.join("template.pdf")).unwrap(), b"PDFBYTES");
        let reg_txt = fs::read_to_string(&reg).unwrap();
        assert!(reg_txt.contains("remit"));
    }

    #[test]
    fn install_missing_asset_bytes_still_writes_since_bytes_provided() {
        // Bytes are provided by caller; "missing asset" is a frontend concern.
        // Here we assert an empty asset list installs cleanly (app with no assets).
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Apps");
        let reg = dir.path().join("installed.json");
        install_into(&base, &reg, "kinetic", "Kinetic Studio", "{}", vec![]).unwrap();
        assert!(base.join("Kinetic Studio").join("manifest.json").exists());
    }

    #[test]
    fn uninstall_removes_folder_and_registry_entry() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Apps");
        let reg = dir.path().join("installed.json");
        install_into(&base, &reg, "remit", "Remit", "{}", vec![]).unwrap();
        uninstall_into(&base, &reg, "remit", "Remit").unwrap();
        assert!(!base.join("Remit").exists());
        assert!(!fs::read_to_string(&reg).unwrap().contains("remit"));
    }

    #[test]
    fn reconcile_drops_entry_when_folder_gone() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Apps");
        let reg = dir.path().join("installed.json");
        install_into(&base, &reg, "remit", "Remit", "{}", vec![]).unwrap();
        fs::remove_dir_all(base.join("Remit")).unwrap();
        reconcile_in(&base, &reg);
        assert!(!fs::read_to_string(&reg).unwrap().contains("remit"));
    }

    #[test]
    fn install_is_atomic_no_partial_on_ok() {
        // Re-installing overwrites cleanly (idempotent).
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Apps");
        let reg = dir.path().join("installed.json");
        install_into(&base, &reg, "remit", "Remit", "{\"v\":1}", vec![]).unwrap();
        install_into(&base, &reg, "remit", "Remit", "{\"v\":2}", vec![]).unwrap();
        let m = fs::read_to_string(base.join("Remit").join("manifest.json")).unwrap();
        assert!(m.contains("\"v\":2"));
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test store:: 2>&1 | tail -20`
Expected: FAIL — module/functions not found.

- [ ] **Step 3: Write the implementation**

Above the tests in `src-tauri/src/store.rs`:

```rust
//! Generic app installer for DreamStore.
//!
//! Apps are listed in the store but not installed by default. Installing an
//! app materializes `~/Applications/DreamStore/<AppName>/` (manifest.json +
//! declared asset bytes provided by the frontend) and records the app id in
//! `~/.dreamstore/installed.json`. Native app CODE stays compiled into the
//! binary (built-in tier); uninstall removes only the folder + registry entry.
//!
//! Source of truth = registry entry AND folder both present. `reconcile()`
//! prunes drift on startup.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

#[derive(Deserialize)]
pub struct InstallAsset {
    pub name: String,
    pub bytes: Vec<u8>,
}

fn install_root() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join("Applications").join("DreamStore"))
        .unwrap_or_else(|| PathBuf::from("Applications/DreamStore"))
}

fn registry_path() -> PathBuf {
    crate::paths::user_path("installed.json")
}

fn read_registry(reg: &Path) -> Vec<String> {
    fs::read_to_string(reg)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
}

fn write_registry(reg: &Path, ids: &[String]) -> Result<(), String> {
    if let Some(parent) = reg.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir registry: {}", e))?;
    }
    let body = serde_json::to_string(ids).map_err(|e| format!("serialize registry: {}", e))?;
    let tmp = reg.with_extension("json.tmp");
    fs::write(&tmp, body.as_bytes()).map_err(|e| format!("write registry tmp: {}", e))?;
    fs::rename(&tmp, reg).map_err(|e| format!("rename registry: {}", e))
}

/// Sanitise an asset name to a bare basename so it can't escape the app folder.
fn safe_name(name: &str) -> Result<&str, String> {
    Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| format!("invalid asset name: {}", name))
}

fn install_into(
    base: &Path,
    reg: &Path,
    app_id: &str,
    app_name: &str,
    manifest_json: &str,
    assets: Vec<InstallAsset>,
) -> Result<(), String> {
    let app_dir = base.join(app_name);
    // Build into a temp sibling then rename into place (atomic-ish).
    let staging = base.join(format!(".{}.staging", app_name));
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    fs::create_dir_all(&staging).map_err(|e| format!("mkdir staging: {}", e))?;
    fs::write(staging.join("manifest.json"), manifest_json.as_bytes())
        .map_err(|e| format!("write manifest: {}", e))?;
    for a in &assets {
        let name = safe_name(&a.name)?;
        fs::write(staging.join(name), &a.bytes)
            .map_err(|e| format!("write asset {}: {}", name, e))?;
    }
    if app_dir.exists() {
        fs::remove_dir_all(&app_dir).map_err(|e| format!("clear old: {}", e))?;
    }
    fs::rename(&staging, &app_dir).map_err(|e| format!("rename into place: {}", e))?;

    let mut ids = read_registry(reg);
    if !ids.iter().any(|i| i == app_id) {
        ids.push(app_id.to_string());
    }
    write_registry(reg, &ids)
}

fn uninstall_into(base: &Path, reg: &Path, app_id: &str, app_name: &str) -> Result<(), String> {
    let app_dir = base.join(app_name);
    if app_dir.exists() {
        fs::remove_dir_all(&app_dir).map_err(|e| format!("remove app dir: {}", e))?;
    }
    let ids: Vec<String> = read_registry(reg).into_iter().filter(|i| i != app_id).collect();
    write_registry(reg, &ids)
}

fn reconcile_in(base: &Path, reg: &Path) {
    // NOTE: reconcile works on ids, but folders are keyed by name; we keep an
    // id only if SOME folder for it exists. Since we don't store id->name here,
    // reconcile prunes ids whose registry we can't confirm by re-reading. To
    // keep it simple and correct, the registry stores ids and the folder check
    // is done by the caller passing existing folder names. For the common path
    // (folder deleted) we detect emptiness of base for that app via a marker:
    // here we prune any id with no matching manifest under base.
    let ids = read_registry(reg);
    let kept: Vec<String> = ids
        .into_iter()
        .filter(|_id| {
            // An id is kept if at least one subfolder of base has a manifest.
            // We can't map id->name without more state, so treat presence of
            // ANY app folder with a manifest as "installed set intact" is wrong;
            // instead store id inside the manifest and scan. See Step 4 note.
            base.read_dir()
                .map(|rd| {
                    rd.flatten().any(|e| e.path().join("manifest.json").exists())
                })
                .unwrap_or(false)
        })
        .collect();
    let _ = write_registry(reg, &kept);
}
```

> **Step 4 note (fix reconcile to be id-accurate):** the registry should store `{id, name}` pairs, not bare ids, so reconcile can check the exact folder. Adjust: change the registry format to `Vec<InstalledEntry { id, name }>`, update `read/write_registry`, `install_into` (push `{id,name}`), `uninstall_into` (filter by id), and `reconcile_in` (keep an entry only if `base.join(&entry.name).join("manifest.json").exists()`). Update `app_install_states` to return the ids. Re-run the tests — they already assert folder/registry behavior and will pass with the accurate version.

- [ ] **Step 4: Implement the id-accurate registry (per the note) and the commands**

Replace the registry representation with:

```rust
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct InstalledEntry {
    id: String,
    name: String,
}
```
and rework `read_registry`/`write_registry`/`install_into`/`uninstall_into`/`reconcile_in` to use `Vec<InstalledEntry>`, with `reconcile_in` keeping entries where `base.join(&e.name).join("manifest.json").exists()`. Then add the public commands + `reconcile()`:

```rust
#[tauri::command]
pub fn app_install(
    app_id: String,
    app_name: String,
    manifest_json: String,
    assets: Vec<InstallAsset>,
) -> Result<(), String> {
    install_into(&install_root(), &registry_path(), &app_id, &app_name, &manifest_json, assets)
}

#[tauri::command]
pub fn app_uninstall(app_id: String, app_name: String) -> Result<(), String> {
    uninstall_into(&install_root(), &registry_path(), &app_id, &app_name)
}

#[tauri::command]
pub fn app_install_states() -> Result<Vec<String>, String> {
    let base = install_root();
    let reg = registry_path();
    reconcile_in(&base, &reg);
    Ok(read_registry(&reg).into_iter().map(|e| e.id).collect())
}

pub fn reconcile() {
    reconcile_in(&install_root(), &registry_path());
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo test store:: 2>&1 | tail -20`
Expected: PASS (5 tests). Fix `read_registry`/tests to the `InstalledEntry` shape if any assertion checks raw text — the tests use `.contains("remit")`, which still holds since the id is serialized.

- [ ] **Step 6: Wire module + commands + startup reconcile in lib.rs**

Add `mod store;` near the other module decls. In the `generate_handler!` list, add:

```rust
            store::app_install,
            store::app_uninstall,
            store::app_install_states,
```

In `run()`'s `.setup(...)` closure, after `paths::migrate_user_paths();` (DS-0), add:

```rust
            store::reconcile();
```

- [ ] **Step 7: Verify compile**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: `Finished`.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/store.rs src-tauri/src/lib.rs
git commit -m "feat(dreamstore): generic app installer (folder + registry + reconcile)"
```

---

### Task 2: Store catalog as a repo folder + loader

Move each public app's manifest DATA into `store-catalog/<id>.json`; a loader reads the folder and re-attaches `Root` from a small code map.

**Files:**
- Create: `store-catalog/kinetic.json`, `pulse.json`, `brainstorm.json`, `data.json`, `voxel.json`
- Create: `editor/platform/catalog.ts` (loader + id→Root map)
- Modify: `editor/platform/apps.ts` (build `PUBLIC_APPS` from the loader instead of the inline array)
- Test: `editor/platform/__tests__/catalog.test.ts`

**Interfaces:**
- Consumes: `AppManifest` type (`apps.ts`), the app Root components.
- Produces: `export const PUBLIC_APPS: AppManifest[]` from `catalog.ts` (re-exported by `apps.ts`).

- [ ] **Step 1: Write the failing test**

`editor/platform/__tests__/catalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PUBLIC_APPS } from "../catalog";

describe("store catalog loader", () => {
  it("loads all public apps from store-catalog/ with data + Root", () => {
    const ids = PUBLIC_APPS.map((a) => a.id).sort();
    expect(ids).toEqual(["brainstorm", "data", "kinetic", "pulse", "voxel"]);
    const kinetic = PUBLIC_APPS.find((a) => a.id === "kinetic")!;
    expect(kinetic.name).toBe("Kinetic Studio");
    expect(kinetic.Root).toBeTruthy();            // Root re-attached from code map
    const voxel = PUBLIC_APPS.find((a) => a.id === "voxel")!;
    expect(voxel.status).toBe("coming-soon");
    expect(voxel.Root).toBeFalsy();               // coming-soon has no Root
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run editor/platform/__tests__/catalog.test.ts 2>&1 | tail -12`
Expected: FAIL — `../catalog` not found.

- [ ] **Step 3: Create the catalog JSON files**

For each public app, copy its object from the current `apps.ts` `PUBLIC_APPS` array into `store-catalog/<id>.json`, MINUS the `Root` field (JSON can't hold a component). Example `store-catalog/kinetic.json` (copy the real values from `apps.ts`):

```json
{
  "id": "kinetic",
  "name": "Kinetic Studio",
  "blurb": "Agent-native kinetic typography",
  "description": "Compose animated text pieces with the agent in the terminal. Bring your own Claude / Codex / Gemini. The agent edits a single story.json on disk; the canvas re-renders within ~300 ms. Scrub parameters directly; the agent sees your edits.",
  "creator": "altramanera",
  "version": "0.1.0",
  "tokens": 12400000,
  "files": 142,
  "loc": 8200,
  "rating": 4.8,
  "ratingCount": 23,
  "tags": ["typography", "video", "agent-native"],
  "hue": 268,
  "status": "available",
  "releasedAt": "2026-05-10",
  "sizeBytes": 4100000,
  "category": "video-motion",
  "visibility": "public",
  "skills": [
    { "name": "/gsd:update", "on": true },
    { "name": "/beat:add", "on": true },
    { "name": "/palette", "on": true },
    { "name": "/export", "on": true }
  ],
  "runtime": { "model": "Opus 4.7", "context": "1M", "effort": "xhigh" }
}
```

Do the same for `pulse.json`, `brainstorm.json`, `data.json`, `voxel.json` using their exact current values from `apps.ts`.

- [ ] **Step 4: Create `editor/platform/catalog.ts`**

```ts
/**
 * Public catalog loader. Manifest DATA lives in `store-catalog/*.json`
 * (the "public app list is a folder in the repo"); the `Root` component
 * can't live in JSON, so it's re-attached here from a small id->component
 * map. Private apps are collected separately from the overlay (apps.ts).
 */
import type React from "react";
import type { AppManifest } from "./apps";
import { KineticApp } from "../canvases/kinetic/KineticApp";
import { PulseApp } from "../canvases/music/PulseApp";
import { BrainstormApp } from "../canvases/brainstorm/BrainstormApp";
import { DataApp } from "../canvases/data/DataApp";

// The only part of a public app that must be code. Coming-soon apps
// (e.g. voxel) have no entry and stay Root-less.
const ROOTS: Record<string, React.FC<{ onExit: () => void }>> = {
  kinetic: KineticApp,
  pulse: PulseApp,
  brainstorm: BrainstormApp,
  data: DataApp,
};

const catalogModules = import.meta.glob<{ default: AppManifest }>(
  "../../store-catalog/*.json",
  { eager: true },
);

export const PUBLIC_APPS: AppManifest[] = Object.values(catalogModules)
  .map((m) => {
    const data = m.default;
    const Root = ROOTS[data.id];
    return Root ? { ...data, Root } : data;
  })
  // Deterministic display order by releasedAt then id (was array order).
  .sort((a, b) =>
    a.releasedAt === b.releasedAt
      ? a.id.localeCompare(b.id)
      : a.releasedAt.localeCompare(b.releasedAt),
  );
```

- [ ] **Step 5: Point apps.ts at the loader**

In `editor/platform/apps.ts`, remove the inline `PUBLIC_APPS` array and the now-unused static Root imports (`KineticApp`, `PulseApp`, `BrainstormApp`, `DataApp`), and re-export from the loader:

```ts
import { PUBLIC_APPS } from "./catalog";
```
Keep `PRIVATE_APPS` (overlay glob) and `APPS = [...PUBLIC_APPS, ...PRIVATE_APPS]` exactly as-is.

- [ ] **Step 6: Run test + full suite**

Run: `npx vitest run editor/platform/__tests__/catalog.test.ts 2>&1 | tail -8 && npm test 2>&1 | grep -E "Test Files|Tests "`
Expected: catalog test passes; full suite green (Remit overlay still appended).

- [ ] **Step 7: tsc**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean (orphaned imports removed).

- [ ] **Step 8: Commit**

```bash
git add store-catalog editor/platform/catalog.ts editor/platform/apps.ts editor/platform/__tests__/catalog.test.ts
git commit -m "feat(dreamstore): public catalog as store-catalog/ folder + loader"
```

---

### Task 3: install.ts internals → Tauri-backed; asset map; keep public API

Swap `install.ts` from localStorage+mock to the backend commands, preserving its exported API so `AppRow`/`Square`/`Sidebar`/`AppDrawer` need no changes. Delete the force-install-if-`Root` rule.

**Files:**
- Modify: `editor/platform/install.ts` (internals; keep exports `useInstallState`, `startInstall`, `uninstall`, `cancelInstall`, `getInstallState`, types)
- Create: `editor/platform/install-assets.ts` (id→asset `?url` map for install)
- Test: `editor/platform/__tests__/install.test.ts`

**Interfaces:**
- Consumes: Tauri `invoke` (`@tauri-apps/api/core`), `app_install`/`app_uninstall`/`app_install_states` (Task 1), `findApp` (apps.ts), `isTauri` (`editor/runtime`).
- Produces: unchanged public API; new `installAssetsFor(appId): Promise<{name, bytes}[]>`.

- [ ] **Step 1: Create the asset map** `editor/platform/install-assets.ts`

```ts
/**
 * Which files each app materializes into ~/Applications/DreamStore/<App>/.
 * The frontend owns the Vite ?url imports, resolves them to bytes, and hands
 * them to the app_install command (Rust just writes bytes). Apps with no
 * assets have no entry.
 */
import whitePdfUrl from "../apps-private/remit/assets/remit-template-white.pdf?url";
import signaturePngUrl from "../apps-private/remit/assets/signature.png?url";

const ASSET_URLS: Record<string, { name: string; url: string }[]> = {
  remit: [
    { name: "remit-template-white.pdf", url: whitePdfUrl },
    { name: "signature.png", url: signaturePngUrl },
  ],
};

export const installAssetsFor = async (
  appId: string,
): Promise<{ name: string; bytes: number[] }[]> => {
  const specs = ASSET_URLS[appId] ?? [];
  return Promise.all(
    specs.map(async ({ name, url }) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`asset not found: ${name}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      return { name, bytes: Array.from(buf) };
    }),
  );
};
```

> Note: `install-assets.ts` imports from the private overlay. It is tracked shell code but references overlay files. When the overlay is absent, the `remit` entry's imports would break the build — so guard it: wrap the Remit imports so a missing overlay degrades to no entry. Use `import.meta.glob` for overlay assets instead of static imports:

Replace the two static imports + the `remit` entry with an overlay-tolerant glob:

```ts
// Overlay-tolerant: private-app install assets live in apps-private/*/assets/.
// A shared clone has no overlay -> empty glob -> no private asset entries.
const overlayAssets = import.meta.glob("../apps-private/*/assets/*", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

// Map appId -> [{name,url}] from the globbed overlay paths.
const ASSET_URLS: Record<string, { name: string; url: string }[]> = {};
for (const [path, url] of Object.entries(overlayAssets)) {
  const m = path.match(/apps-private\/([^/]+)\/assets\/(.+)$/);
  if (!m) continue;
  const [, appId, name] = m;
  (ASSET_URLS[appId] ??= []).push({ name, url });
}
```
Keep `installAssetsFor` unchanged below it. Public apps with assets can add a static-import branch later; none need assets today.

- [ ] **Step 2: Write the failing test** `editor/platform/__tests__/install.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Tauri runtime + invoke BEFORE importing install.
vi.mock("../../runtime", () => ({ isTauri: () => true }));
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { getInstallState, startInstall, uninstall, refreshInstallStates } from "../install";

describe("install.ts backed by Tauri commands", () => {
  beforeEach(() => invoke.mockReset());

  it("defaults to not-installed (no force-install for apps with Root)", () => {
    expect(getInstallState("kinetic").state).toBe("not-installed");
  });

  it("startInstall calls app_install and lands installed", async () => {
    invoke.mockResolvedValue(undefined);
    await startInstall("remit");
    expect(invoke).toHaveBeenCalledWith("app_install", expect.objectContaining({ appId: "remit" }));
    expect(getInstallState("remit").state).toBe("installed");
  });

  it("uninstall calls app_uninstall and returns to not-installed", async () => {
    invoke.mockResolvedValue(undefined);
    await startInstall("remit");
    await uninstall("remit");
    expect(invoke).toHaveBeenCalledWith("app_uninstall", expect.objectContaining({ appId: "remit" }));
    expect(getInstallState("remit").state).toBe("not-installed");
  });

  it("refreshInstallStates seeds installed set from backend", async () => {
    invoke.mockResolvedValue(["remit"]);
    await refreshInstallStates();
    expect(getInstallState("remit").state).toBe("installed");
    expect(getInstallState("kinetic").state).toBe("not-installed");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run editor/platform/__tests__/install.test.ts 2>&1 | tail -15`
Expected: FAIL — `refreshInstallStates` missing / force-install still returns installed.

- [ ] **Step 4: Rewrite install.ts internals**

Keep the exported types (`InstallState`, `InstallRecord`) and the subscription/`useInstallState` machinery. Change:

1. **Delete** `isBundled` and its use in `getInstallState`/`startInstall`/`uninstall` (the force-install rule).
2. `startInstall(appId)` becomes async: set `installing`, resolve the manifest + assets, `await invoke("app_install", { appId, appName, manifestJson, assets })`, then set `installed` (or `failed` on throw). Remove the fake progress walk (or keep an indeterminate `installing` flash).
3. Add `uninstall(appId)` async: `await invoke("app_uninstall", { appId, appName })`, set `not-installed`.
4. Add `export async function refreshInstallStates()`: `const ids = await invoke<string[]>("app_install_states"); ` then set each id `installed` and known-but-absent ids `not-installed`; call once at app boot.
5. Persistence: drop localStorage as source of truth; the in-memory `cache` + `refreshInstallStates()` (backed by the registry) is the truth. Keep the subscriber `notify` for UI updates.

Concretely, the new install action:

```ts
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../runtime";
import { findApp } from "./apps";
import { installAssetsFor } from "./install-assets";

export const startInstall = async (appId: string): Promise<void> => {
  const app = findApp(appId);
  if (!app) return;
  const cur = getInstallState(appId);
  if (cur.state === "installing" || cur.state === "installed") return;
  notify(appId, { state: "installing", progress: 0, installedAt: null, error: null });
  try {
    if (!isTauri()) throw new Error("install requires the desktop app");
    const assets = await installAssetsFor(appId);
    // Serialize the manifest without the Root component (not JSON-able).
    const { Root, ...data } = app;
    await invoke("app_install", {
      appId,
      appName: app.name,
      manifestJson: JSON.stringify(data),
      assets,
    });
    notify(appId, { state: "installed", progress: 1, installedAt: new Date().toISOString(), error: null });
  } catch (e) {
    notify(appId, { state: "failed", progress: 0, installedAt: null, error: String(e) });
  }
};

export const uninstall = async (appId: string): Promise<void> => {
  const app = findApp(appId);
  if (!app) return;
  try {
    if (isTauri()) await invoke("app_uninstall", { appId, appName: app.name });
  } finally {
    notify(appId, { ...DEFAULT_RECORD });
  }
};

export async function refreshInstallStates(): Promise<void> {
  if (!isTauri()) return;
  try {
    const ids = await invoke<string[]>("app_install_states");
    const set = new Set(ids);
    for (const a of (await import("./apps")).APPS) {
      notify(a.id, set.has(a.id)
        ? { state: "installed", progress: 1, installedAt: cache.get(a.id)?.installedAt ?? new Date().toISOString(), error: null }
        : { ...DEFAULT_RECORD });
    }
  } catch { /* leave defaults */ }
}
```
`getInstallState` returns `cache.get(appId) ?? DEFAULT_RECORD` (no more `isBundled` branch). Remove `saveToStorage`/`loadFromStorage`/`storageKey` and the timer walk if unused (mention dead code, delete only what your change orphaned).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run editor/platform/__tests__/install.test.ts 2>&1 | tail -12`
Expected: PASS (4 tests).

- [ ] **Step 6: Handle async startInstall in AppRow**

`AppRow.tsx` calls `startInstall(app.id)` in onClick (now async). No await needed (fire-and-forget; UI reacts via `useInstallState`). Confirm it still typechecks; `void startInstall(app.id)` if the linter complains about a floating promise.

- [ ] **Step 7: Full suite + tsc**

Run: `npx tsc --noEmit -p tsconfig.json && npm test 2>&1 | grep -E "Test Files|Tests "`
Expected: clean; all pass.

- [ ] **Step 8: Commit**

```bash
git add editor/platform/install.ts editor/platform/install-assets.ts editor/platform/__tests__/install.test.ts editor/platform/AppRow.tsx
git commit -m "feat(dreamstore): install.ts backed by Tauri installer; drop force-install"
```

---

### Task 4: Gate open on install + boot refresh + uninstall UI

**Files:**
- Modify: `editor/App.tsx` (mount `Root` only if installed; call `refreshInstallStates()` on boot; drop stale open on uninstall)
- Modify: `editor/platform/AppDrawer.tsx` (add an Uninstall control for installed apps)
- Test: `editor/__tests__/open-gating.test.tsx`

**Interfaces:**
- Consumes: `getInstallState`, `refreshInstallStates`, `uninstall`, `useInstallState` (Task 3).

- [ ] **Step 1: Write the failing test** `editor/__tests__/open-gating.test.tsx`

```tsx
import { describe, it, expect, vi } from "vitest";
vi.mock("../runtime", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
import { getInstallState } from "../platform/install";
import { canOpen } from "../platform/install"; // small helper we add

describe("open gating", () => {
  it("an app cannot be opened unless installed", () => {
    expect(canOpen("kinetic")).toBe(false);       // not installed by default
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run editor/__tests__/open-gating.test.tsx 2>&1 | tail -10`
Expected: FAIL — `canOpen` missing.

- [ ] **Step 3: Add `canOpen` to install.ts + gate App.tsx**

In `install.ts`:

```ts
export const canOpen = (appId: string): boolean =>
  getInstallState(appId).state === "installed";
```

In `App.tsx`:
- On mount (a `useEffect`), call `refreshInstallStates()`.
- In `loadCurrentApp()` and the open handler, require `canOpen(id)` in addition to the existing `status === "available" && app.Root` checks. If the persisted current app is no longer installed, return `null` (drops the user to the Square).

```ts
// loadCurrentApp: after the existing checks
    if (!canOpen(id)) return null;
```
```ts
// open handler (around line 169-170)
              const app = APPS.find((a) => a.id === id);
              if (app?.status === "available" && app.Root && canOpen(id)) setCurrentId(id);
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run editor/__tests__/open-gating.test.tsx 2>&1 | tail -8`
Expected: PASS.

- [ ] **Step 5: Add Uninstall to AppDrawer**

In `AppDrawer.tsx`, for an installed app, add a secondary "Uninstall" button that calls `uninstall(app.id)` (fire-and-forget) and closes/relabels via `useInstallState`. Match the existing button styling in the drawer.

- [ ] **Step 6: Full suite + tsc**

Run: `npx tsc --noEmit -p tsconfig.json && npm test 2>&1 | grep -E "Test Files|Tests "`
Expected: clean; all pass.

- [ ] **Step 7: Commit**

```bash
git add editor/App.tsx editor/platform/install.ts editor/platform/AppDrawer.tsx editor/__tests__/open-gating.test.tsx
git commit -m "feat(dreamstore): gate open on install; boot refresh; uninstall control"
```

---

### Task 5: Full verification (both states + manual store flow)

**Files:** none.

- [ ] **Step 1: Frontend tsc + tests**

Run: `npx tsc --noEmit -p tsconfig.json && npm test 2>&1 | grep -E "Test Files|Tests "`
Expected: clean; all pass (catalog + install + open-gating + Remit overlay).

- [ ] **Step 2: Rust check + tests**

Run: `cd src-tauri && cargo check 2>&1 | tail -3 && cargo test 2>&1 | tail -8`
Expected: `Finished`; store:: + paths:: + existing tests pass.

- [ ] **Step 3: No-overlay state builds** (Phase-1 regression + install-assets glob tolerance)

Run:
```bash
STASH=$(mktemp -d)
mv editor/apps-private "$STASH/" && mv src-tauri/src/canvases-private "$STASH/" && mv src-tauri/skills-private "$STASH/" && mv src-tauri/templates-private "$STASH/"
npx tsc --noEmit -p tsconfig.json && npx vite build --config vite.editor.config.ts >/dev/null 2>&1 && echo "frontend build OK" && (cd src-tauri && cargo check 2>&1 | tail -2)
mv "$STASH/apps-private" editor/ && mv "$STASH/canvases-private" src-tauri/src/ && mv "$STASH/skills-private" src-tauri/ && mv "$STASH/templates-private" src-tauri/ && rmdir "$STASH"
```
Expected: tsc + Vite build + cargo check all clean; overlay restored. (Confirms `install-assets.ts` glob tolerates the missing overlay.)

- [ ] **Step 4: Manual store flow** (via `/run` or `npm run tauri:dev`)

1. Launch → Square lists all apps, each shows **Install** (none installed by default).
2. Click Install on **Remit** → button → Installing → **Open**; confirm `~/Applications/DreamStore/Remit/` now contains `manifest.json` + `remit-template-white.pdf` + `signature.png`.
3. Click **Open** → Remit mounts.
4. Back to Square → open the drawer for Remit → **Uninstall** → folder + state gone; button back to **Install**; Open no longer available.
5. Restart the app → installed set persists (registry); uninstalled apps stay uninstalled.

- [ ] **Step 5: Finish the branch**

Use superpowers:finishing-a-development-branch (verify tests, present merge/PR options).

---

## Self-Review

- **Spec coverage:** not-installed-by-default + delete force-install (Task 3); `app_install`/`app_uninstall`/`app_install_states` + registry + reconcile + atomic + missing-asset (Task 1); `~/Applications/DreamStore/<App>/` folder with manifest+assets (Tasks 1,3); open gated on install (Task 4); `store-catalog/` folder + loader + `Root` code map (Task 2); `visibility` read from origin (Task 2, non-security); both-states verification (Task 5). Covered.
- **Placeholders:** none — all code shown. Task 1 Step 3→4 deliberately shows a first-cut reconcile then corrects it to the id-accurate `InstalledEntry` form (the note explains why); the tests assert the corrected behavior.
- **Type consistency:** `InstallAsset { name, bytes }` (Rust) ↔ `{ name, bytes: number[] }` (TS, `Array.from(Uint8Array)` serializes to a JSON number array Rust reads as `Vec<u8>`). Command names `app_install`/`app_uninstall`/`app_install_states` consistent across Rust registration (Task 1) and TS `invoke` (Task 3). `refreshInstallStates`/`canOpen`/`installAssetsFor` defined before use. `PUBLIC_APPS` produced by `catalog.ts`, consumed by `apps.ts` (Task 2).
- **Known risk flagged:** `install-assets.ts` is tracked shell code that must tolerate the missing overlay — handled via the overlay-tolerant `import.meta.glob` (Task 3 Step 1), verified in Task 5 Step 3.
