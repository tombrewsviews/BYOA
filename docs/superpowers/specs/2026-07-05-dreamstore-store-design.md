# DreamStore — rename + real install store (DS-0 + DS-1) — design

**Date:** 2026-07-05
**Status:** design approved; ready for implementation plan
**Branch:** `feat/dreamstore` (off `main`)
**Predecessor:** Phase-1 private-app overlay (commit `8c9b1fb`, merged to `main`)
**Reference plan:** `docs/superpowers/specs/2026-07-04-app-shell-separation-plan.md`

## Motivation

Evolve KineticType into **DreamStore**: a Glaze-style shell where apps are
listed in a store catalog but **not installed by default**. The user installs
each app separately; installed apps appear as folders under
`~/Applications/DreamStore/<App>/`, including private apps (Remit is the test
private app). The public app catalog lives as a folder in the repo. Everything
stays local — no server, no real users, no third-party distribution yet.

## Scope decomposition (this spec = DS-0 + DS-1 only)

The full "fully dynamic runtime plugin store, native apps included" is the
plan's Phase 4 — a multi-month epic. It decomposes into independent cycles:

- **DS-0 — Rename** KineticType → DreamStore. *This spec.*
- **DS-1 — Real install + store-catalog folder.** Native apps stay compiled
  into the binary (a "built-in" tier); install becomes real state + folder
  materialization; catalog moves to an in-repo folder. *This spec.*
- **DS-2 — Runtime web-bundle loading + generic host API** (deferred): shell
  loads a bundle-tier app's frontend via runtime `import()` from the install
  folder; one generic `ManifestCanvas` + `plugin_invoke` dispatcher replaces
  per-app Rust. Remit is the ideal first bundle app.
- **DS-3 — Native apps as sidecars** (deferred, per-app): port Lens/DuckDB,
  video export, Pulse to sidecar processes so they are truly uninstallable.
  Brainstorm's existing `CanvasServer` child is the proof-of-concept.

DS-2/DS-3 are explicitly out of scope here. DS-1 is designed so it is their
foundation, not a throwaway.

### Why the compile-time seams don't generalize (context for DS-2/DS-3)

A Phase-1 review established two hard facts that shape this decomposition:

- `import.meta.glob` (frontend) and `#[cfg(...)]` (Rust) are **compile-time**
  constructs. They deliver "app code optionally present in the repo at build
  time" — Phase 1's goal — but give nothing for "app code that arrives at
  runtime." DS-2 must replace the glob with runtime `import()`.
- `tauri::generate_handler!` bakes the command table into the binary at
  macro-expansion time. A running Tauri app **cannot register a new native
  command**. So native-per-app apps are a compile-time wall; making them
  runtime-installable (DS-3) means sidecar processes or a plugin ABI.

DS-1 keeps all native code compiled in and treats those apps as a permanent
**built-in tier** — honest about the wall rather than pretending around it.

---

## DS-0 — Rename KineticType → DreamStore

The *product* becomes DreamStore. Individual apps keep their names (Kinetic
Studio, Pulse, Lens, Remit).

- **Tauri identity** (`src-tauri/tauri.conf.json`): `productName`,
  `identifier` (bundle id → `app.altramanera.dreamstore`), window `title`.
  Main-window label stays `main`. *Consequence, accepted:* a new identifier
  makes the OS treat this as a fresh app — window state / permissions reset
  once.
- **Two user-level paths, both renamed with one-time non-destructive
  migration on startup:**
  - `~/.kinetic-studio/` → `~/.dreamstore/` (settings, recipients store,
    per-user metadata). Referenced in **20 code files** (`.kinetic-studio`).
  - `~/KineticStudio/` → `~/DreamStore Projects/` (the project pool dir).
    Referenced as `KineticStudio` in 3 files (`projects.rs`, `canvas.rs`,
    `ProjectsView.tsx`). *Note: this is a distinct path from
    `~/.kinetic-studio/`.*
  - Migration rule for each: if the new dir is absent and the old exists,
    rename it; if the new dir already exists, prefer it and leave the old
    untouched (never clobber).
- **Per-project skill dir** (`.kinetic-studio/` inside project folders): part
  of the 20-file count above. The plan states whether these per-project dirs
  are renamed (with migration) or left as legacy — chosen for lower risk,
  since they are recreated from the skill bundle on project open.
- **Docs / CLAUDE.md / user-facing package name:** updated. Internal Cargo
  crate name (`app`) left as-is — no functional value in churning it.

---

## DS-1 — Real install lifecycle + store-catalog folder

### Install model

Delete the force-install rule (`install.ts:44-47, 88-95`) that reports any
app with a `Root` as permanently `installed`. That rule is what blocks
"not-installed by default."

- **Default = `not-installed`** for every app. The store lists all apps with
  an **Install** button.
- **Install** (new Tauri command `app_install(appId)`): creates
  `~/Applications/DreamStore/<AppName>/`, writes `manifest.json` there, copies
  the app's declared install assets (Remit → `remit-template-white.pdf` +
  `signature.png`), then records installed state. Atomic: build into a temp
  dir, then rename into place; no partial folder on failure.
- **Persistence moves from localStorage to backend-owned disk.** Source of
  truth = the install folder's presence **and** a `~/.dreamstore/installed.json`
  registry. The frontend reads install state via a command
  (`app_install_states`), not localStorage. (localStorage was fine for the
  mock; a real install creating real folders must be backend-owned.)
- **Open is gated on installed.** `App.tsx` mounts an app's `Root` only when
  it is installed. The store always allows Install, so a user can never be
  permanently locked out. This applies to every app including Kinetic:
  uninstall-then-reopen requires reinstall (accepted).
- **Uninstall** (`app_uninstall(appId)`): removes the folder + registry entry
  → back to `not-installed`. Native code stays in the binary; uninstall
  removes only the installed *state + folder*, not compiled code.

**Asset declaration.** The manifest gains an optional `installAssets: string[]`
listing files to materialize into the install folder. Remit declares its PDF +
signature; apps with none declare nothing. The installer resolves each asset
from the app's source dir; a listed-but-missing asset fails the install
cleanly (see Error handling) rather than half-installing.

### Data flow

```
Square / AppRow
  --> app_install(appId)              (Tauri command)
      Rust: mkdir ~/Applications/DreamStore/<App>/  (temp -> rename)
            write manifest.json
            copy installAssets
            update ~/.dreamstore/installed.json
      --> returns InstallRecord
  --> frontend re-renders as installed
  --> Open enabled --> App.tsx mounts Root
```

### Store catalog as a repo folder

Replace the hardcoded `APPS[]` array with per-app manifest files in an in-repo
folder.

- **`store-catalog/`** at repo root: one data-only JSON per public app —
  `kinetic.json`, `pulse.json`, `brainstorm.json`, `data.json`, `voxel.json`.
  Each holds all manifest *data* except the `Root` component.
- **Loader** (`editor/platform/catalog.ts`): reads the folder via
  `import.meta.glob("../../store-catalog/*.json", { eager: true })` and builds
  the public `APPS[]`. A small id→component map in code attaches each app's
  `Root` (the only part that must be code). JSON = data; code map = `Root`.
- **Private apps unchanged:** Remit stays in the `editor/apps-private/remit/`
  overlay, collected as before and appended to the catalog. `visibility` is
  now read (public = from `store-catalog/`, private = from overlay) but remains
  descriptive of origin, **not** a security boundary — privacy is still
  enforced by git-ignore + build-time absence.

**Accepted trade-off:** adding a *public* app is "add a JSON file + one line in
the id→`Root` map" — not yet fully "drop a folder in" (that is DS-2's codegen).
The stated goal — public list is a folder in the repo — is met.

---

## Error handling

- **Install failure** (mkdir / copy / disk full): `app_install` returns an
  error; frontend shows `failed` + Retry. Temp-dir + atomic rename means no
  partial folder is left behind.
- **Missing declared asset:** install fails with a named error ("install asset
  not found: <path>"), never a silent half-install. Addresses the Phase-1
  "overlay incomplete" finding.
- **Registry / folder drift** (folder deleted outside the app, or registry out
  of sync): on startup the backend **reconciles** — an app is `installed` only
  if *both* its registry entry and its folder exist; any mismatch downgrades to
  `not-installed`. Single source-of-truth guard.
- **Path migration** (`~/.kinetic-studio` → `~/.dreamstore`): if target exists,
  prefer it, leave the old dir untouched — never clobber.

## Testing

**Frontend (vitest):**
- Catalog loader builds `APPS[]` from `store-catalog/` fixtures (correct data,
  `Root` attached for known ids).
- Install-state reducer transitions: not-installed → installing → installed →
  uninstalled.
- Open-gating: an uninstalled app yields no mountable `Root` in `App.tsx`.
- Remit overlay tests keep passing.

**Rust (cargo test, isolated dirs via `tempfile`):**
- `app_install` creates folder + copies assets + writes registry.
- `app_uninstall` reverses folder + registry.
- reconcile-on-startup downgrades drift to `not-installed`.
- asset-missing fails cleanly (no partial folder).
- path migration is non-destructive when target exists.

**Both-states check (from Phase 1):** with and without the Remit overlay,
build + tests green; Remit absent from the catalog when the overlay is absent.

**Manual verify:** launch app → install Remit → confirm
`~/Applications/DreamStore/Remit/` contains manifest + PDF + signature → open
it → uninstall → confirm folder + state gone.

## Non-goals (this spec)

- Runtime loading of app frontends (DS-2).
- Making native apps uninstallable at the code level / sidecars (DS-3).
- Bundle signing, CSP-per-app, third-party app distribution (Phase 4 proper).
- Scrubbing Remit secrets from git history (separate explicit decision; the
  overlay only untracks going forward — a normal `git clone` still retrieves
  the committed signature + account numbers from history).
