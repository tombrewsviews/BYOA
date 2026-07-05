# DreamStore Launcher Pivot — design (DS2′-B + DS2′-D roadmap)

**Date:** 2026-07-06
**Status:** design approved; ready for implementation plan (Launcher cycle first)
**Branch:** new branch off `main` (suggest `feat/dreamstore-launcher`). Depends on the DS2′-A work (Remit standalone, `apps/remit/`) being present — ideally `feat/dreamstore-ds2` is merged to `main` first so `apps/remit/` and its `Remit.app` build exist as the launcher's first real app.
**Predecessors:** DS-0 rename + DS-1 install store (merged to `main`); **DS2′-A** — Remit extracted to a standalone `.app` (`apps/remit/`, branch `feat/dreamstore-ds2`, merge-ready). Remit is the template for every extraction here.
**Reference specs:** `docs/superpowers/specs/2026-07-05-ds2a-remit-standalone-app-design.md`, `docs/superpowers/specs/2026-07-05-dreamstore-store-design.md`, `docs/superpowers/specs/2026-07-04-app-shell-separation-plan.md` (Option B2 — the full Glaze model).

## Motivation

Today DreamStore is a **monolith**: every "app" (Kinetic, Pulse, Lens/data,
Brainstorm, Remit) is a React `Root` component mounted *in-process* inside the
one DreamStore window; "opening" an app just flips `currentId` and mounts its
`Root`. The user's target is the **full Glaze model**: DreamStore is a **pure
launcher** that discovers, searches, installs, and **spawns each app as its own
independent `.app`** (own process, own dock icon, own window) — exactly like the
already-extracted `apps/remit/`. Each app also runs standalone with no DreamStore
present.

This design covers the whole pivot, decomposed into sequenced cycles. Only the
first cycle (the Launcher) is specified in full here; each app-extraction cycle
gets its own downstream spec following the Remit template.

## Decisions (locked)

1. **Spawn model:** the launcher runs `open ~/Applications/DreamStore/<App>.app`
   (fallback `open -b <bundle-id>`). Each app is a fully independent macOS `.app`
   — own process, dock icon, window. (Not Tauri child-windows.)
2. **Bundle source:** each app's built `.app` ships **inside** `DreamStore.app`
   at `Contents/Resources/apps/<App>.app`. "Install" copies it out to
   `~/Applications/DreamStore/<App>.app`. Offline, self-contained. (Remote
   download + signing = DS2′-C, deferred.)
3. **Shell cleanup:** as each app is extracted, its in-process `Root` + per-app
   Rust commands + native deps are **deleted from the shell** in that same cycle.
   End state: `DreamStore.app` is a pure launcher with ~no native deps.
4. **Scope of this epic:** the launcher + extraction of all four remaining native
   apps. Remote store (DS2′-C) is out of scope.

## Non-goals

- Remote approved-app list / download / code signing / versioning (DS2′-C).
- Windows/Linux (macOS only, matching the rest of the project).
- Any change to how an individual app works internally beyond what extraction
  requires (each app's UX is preserved).

---

## Architecture (target end state)

```
DreamStore.app  (pure launcher)
  Contents/Resources/apps/
    Remit.app  Kinetic.app  Pulse.app  Lens.app  Brainstorm.app   ← bundled
  frontend: "The Square" (search + list + drawer)  ← already exists
  backend:  app_install (copy bundle) · app_launch (spawn) · app_uninstall
            · app_install_states   ← NO duckdb/ffmpeg/pulse/pty/agent-chat

apps/<app>/   (one self-contained Tauri project per app — Remit is the template)
  own frontend SPA + trimmed Rust backend (shared core copied) + own native bits
  + isolated data dirs + one-time migration + draggable title bar
  + capabilities/default.json (allow-start-dragging) + "Open DreamStore" button

Install:  DreamStore/Contents/Resources/apps/<App>.app  ──copy──▶
          ~/Applications/DreamStore/<App>.app  ──open──▶  standalone app runs
```

**Two hard-won invariants every extracted app MUST satisfy** (learned the
expensive way during DS2′-A — see the Remit spec's postmortem):

- **`apps/<app>/src-tauri/capabilities/default.json`** granting `core:default`
  + `core:window:allow-start-dragging` (+ dialog, set-focus, close). Without a
  `capabilities/` file a fresh Tauri crate silently grants the webview **zero**
  permissions, so `data-tauri-drag-region` renders but the window won't move —
  with **no error**. This is not optional.
- **A `data-tauri-drag-region` title bar** in the app shell (`main.tsx`), because
  the standalone window uses a hidden/overlay native title bar. Pattern: drag
  region on the bar container, `pointer-events-none` on centered content,
  interactive buttons opt out with `data-tauri-drag-region={false}`, left-pad to
  clear the macOS traffic lights (~84px). Include an "Open DreamStore" button
  (`open -b app.altramanera.dreamstore`, fallback to the install path).

---

## Cycle roadmap (sequenced)

Each cycle is its own spec → plan → subagent-driven implementation. **Build the
launcher first**, then extract apps one at a time (ascending native difficulty),
so there is always a working build.

| Cycle | Deliverable | Native difficulty | Notes |
|------|-------------|-------------------|-------|
| **DS2′-B Launcher** | DreamStore spawns/install-copies real `.app`s; wired to Remit | n/a | **Specified in full below.** Shippable with one real app. |
| **DS2′-D1 Brainstorm** | `apps/brainstorm/` standalone `.app` | moderate — spawns a `node` localhost server child (Excalidraw collab) | Carries the node-server spawn + `.mcp.json` seed. |
| **DS2′-D2 Pulse** | `apps/pulse/` standalone `.app` | heavy — `ffmpeg` stem transcode + a second `/stage` webview window | Carries `pulse.rs` + `stage.rs`; `ffmpeg` dependency. |
| **DS2′-D3 Kinetic** | `apps/kinetic/` standalone `.app` | heavy — `ffmpeg` + `yt-dlp` + Remotion render | Carries `video.rs`; the biggest frontend. |
| **DS2′-D4 Lens (data)** | `apps/lens/` standalone `.app` | heaviest — **bundled DuckDB** + `claude` semantic ops | id `data`, display name "Lens"; `data.rs`+`data_semantic.rs`. |

After D4, DreamStore.app carries no `duckdb`/`ffmpeg`/`pty`/`agent-chat`/per-app
code — it is a pure launcher. `voxel` stays a coming-soon catalog entry (no Root,
nothing to extract).

**Per-extraction-cycle checklist** (the reusable template — each D-cycle spec
instantiates this for its app; do not re-derive):
1. Scaffold `apps/<app>/` (frontend SPA + Rust crate) — copy the shared core from
   `apps/remit/` (paths/skill/watch/projects/doc + AppState) and re-point data
   dirs to the app's own isolated `~/.<app>/` + `~/<App> Projects/`.
2. Copy the app's frontend `Root` + decouple its shell imports (UI components,
   icons, runtime) — the Remit §3 decoupling recipe.
3. Carry the app's per-app Rust (its `#[tauri::command]`s + native deps) into the
   crate; register in its own `invoke_handler`.
4. Add `capabilities/default.json` + draggable title bar + "Open DreamStore"
   button + one-time migration from `~/DreamStore Projects/` (Remit's `migrate.rs`).
5. `tauri:build` → add the built `.app` to DreamStore's `Resources/apps/` + a
   `store-catalog/<app>.json` entry marked `launchable`.
6. **Strip the app from the shell:** delete its in-process `Root` (from
   `catalog.ts` ROOTS or the private overlay), its per-app Rust commands from
   `lib.rs`'s handler + the modules, and its now-orphaned Cargo deps.
7. Verify: shell still builds (tsc + tests + `cargo check`); the standalone app
   builds, installs from the launcher, spawns, and keeps its migrated data.

---

## DS2′-B — The Launcher cycle (full spec)

The launcher UI already exists: **"The Square"** (`editor/platform/Square.tsx` +
`Sidebar.tsx` + `AppRow.tsx` + `AppDrawer.tsx`) is a searchable, filterable,
sortable app-store list with a detail drawer and install buttons. Search is
already implemented (`searchApps`). So this cycle is **not** about building a
launcher UI — it's about changing what *install* and *open* DO, and bundling the
real `.app`s.

### B.1 Backend — spawn + real install (`src-tauri/src/store.rs`)

- **New `app_launch(app_id: String) -> Result<(), String>`** (register in
  `lib.rs` handler). Resolves the installed bundle
  `~/Applications/DreamStore/<AppName>.app` from the registry
  (`installed.json` id→name), then `std::process::Command::new("open").arg(path)`;
  fallback `open -b <bundle-id>` if a `bundleId` is on the manifest. Returns an
  error if the app isn't installed. (Mirrors the `open_dreamstore` command
  already written in `apps/remit/src-tauri/src/remit.rs`.) macOS `open` focuses
  an already-running app's window, so re-launch = focus (no dup process).
- **`app_install` becomes a real bundle copy.** Today it writes a manifest +
  asset bytes as a state marker (`store.rs` docstring: "STATE MARKER… nothing
  reads the folder at runtime"). Change it to **copy the bundled `.app`**:
  `DreamStore.app/Contents/Resources/apps/<App>.app` → staged temp under the
  install root → atomic rename to `~/Applications/DreamStore/<App>.app`. Keep the
  registry write + `safe_name` traversal guard + `reconcile`. Resolve the
  resource dir via Tauri's `app.path().resource_dir()`.
- **`app_uninstall`** removes the copied `.app` bundle + registry entry (already
  removes the folder; now the folder IS the `.app`).
- **`app_install_states`** unchanged (reports installed ids; reconcile prunes
  entries whose bundle is gone).

### B.2 Bundling the apps into DreamStore

- `src-tauri/tauri.conf.json`: add `bundle.resources` including
  `resources/apps/*` (a new `src-tauri/resources/apps/` dir).
- A build step (documented script, e.g. `scripts/bundle-apps.sh`) copies each
  standalone app's built bundle
  (`apps/<app>/src-tauri/target/release/bundle/macos/<App>.app`) into
  `src-tauri/resources/apps/` **before** `npm run tauri:build` at the repo root.
  For the launcher cycle this is just `Remit.app`.
- `resources/apps/` is git-ignored (holds built `.app`s; same posture as other
  build output).

### B.3 Frontend — open spawns instead of mounts (`editor/`)

- **`AppRow`/`AppDrawer` "Open" CTA → `invoke("app_launch", { appId })`** instead
  of `onOpen(id)` → `setCurrentId(id)`. The launcher window stays; the app opens
  as its own window.
- **Manifest gains `launchable?: boolean`** (or reuse a `bundleId`) marking
  spawn-apps. During the transition, any app still in-process (D1–D4 not yet
  done) keeps the old `setCurrentId` path; `launchable` apps take the spawn path.
  After D4 every app is `launchable` and the in-process mount path + `currentId`
  router collapse to just the launcher.
- **Remit stops mounting in-window:** it's `launchable` (it's the one extracted
  app). Remove Remit's in-process `Root` wiring (its private-overlay `app.tsx`
  `Root`) so it can only be launched, not mounted. Its catalog manifest stays so
  it appears in the store; add its `Remit.app` to `Resources/apps/`.
- `PlatformChrome`'s "back to The Square" and `onExit` stay for any still-in-
  process app until D4 retires them.

### B.4 Error handling

- **Launch a not-installed app:** `app_launch` returns an error; the UI shows
  "not installed" (shouldn't happen — Open only shows when installed).
- **Bundled `.app` missing from Resources at install:** `app_install` returns a
  clear error ("app bundle not found in DreamStore resources"); surfaced in the
  install button's failed state.
- **Gatekeeper on first open** of an unsigned copied `.app`: same as Remit today
  (self-built → no quarantine; documented right-click→Open otherwise). Signing =
  DS2′-C.

### B.5 Testing

- **Rust unit tests** (`store.rs`, with `tempfile`): `app_launch` path resolution
  (installed → resolves the bundle path; not-installed → error); install-copy
  (copies a fake `.app` dir from a temp "resources" into the install root via
  temp+rename; existing traversal-guard tests stay).
- **Manual E2E** (the real proof): build DreamStore with `Remit.app` bundled →
  launch DreamStore → search "Remit" → **Install** (copies the bundle) → **Open**
  (Remit launches as its own independent window) → Uninstall (bundle removed).
  DreamStore no longer mounts Remit in its own window.
- **Shell stays green:** `tsc` + `npm test` + `cargo check`.

---

## Risks & open questions

- **DreamStore bundle size:** shipping every app's `.app` inside DreamStore makes
  it large (Kinetic+Lens carry ffmpeg/DuckDB). Acceptable for a local, offline
  store; DS2′-C's remote download is the eventual remedy. Flag actual size after
  D-cycles.
- **Duplicate shared-core drift:** every standalone app copies the projects/doc/
  pty/agent-chat/skill core (like Remit). Accepted (independence > DRY); a shared
  crate is a later remedy if it becomes painful. Same posture as the Remit spec.
- **Data isolation vs. migration:** each extracted app gets isolated dirs +
  one-time non-destructive migration from `~/DreamStore Projects/` (Remit's
  pattern). Per app, decide the migration filter (which doc file marks its
  projects: `story.json`=kinetic, `project.json`=pulse, `query.json`=data,
  `board.json`=brainstorm, `remit.json`=remit).
- **Two windows, one agent workflow:** each standalone app writes its own
  per-project skill bundle + CLAUDE.md (Remit pattern). No cross-app agent state.
- **Signing:** unsigned copied `.app`s trigger Gatekeeper; local self-built is
  fine (DS2′-C concern).
- **Transition breakage:** while D1–D4 are in flight the shell is dual-mode (some
  apps in-process, some spawned via `launchable`). The `launchable` flag keeps
  both paths working so every intermediate build ships.
