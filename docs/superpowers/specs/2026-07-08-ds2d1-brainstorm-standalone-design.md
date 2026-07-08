# DS2′-D1 — Brainstorm as a standalone .app (design)

**Date:** 2026-07-08
**Status:** design approved; ready for implementation plan
**Branch:** new branch off `main` (suggest `feat/ds2d1-brainstorm`).
**Predecessors:** DS2′-A (Remit standalone, `apps/remit/` — the extraction template), DS2′-B (the launcher: `app_install` copy + `app_launch` spawn + `launchable` flag + `bundle-apps.sh`, merged to `main`).
**Reference specs:** `docs/superpowers/specs/2026-07-06-dreamstore-launcher-pivot-design.md` (the epic + per-extraction checklist), `docs/superpowers/specs/2026-07-05-ds2a-remit-standalone-app-design.md` (the Remit template).

## Motivation

DreamStore is now a launcher that install-copies a bundled `.app` and spawns it
as an independent process (DS2′-B). Only Remit is extracted so far. Every other
store app (Brainstorm, Pulse, Kinetic, Lens/data) is still an **in-process**
`Root` mounted in the DreamStore window.

Two things drive D1:

1. **The roadmap:** DS2′-D1 extracts Brainstorm — the first "moderate" native app
   (it spawns a `node` localhost server child) — to prove the extraction template
   works beyond dependency-free Remit, before the heavier D2–D4 cycles.
2. **A live regression to fix:** DS2′-B rewrote `app_install` to **unconditionally
   copy a bundled `.app`**. But only launchable apps have a bundle. Installing any
   in-process app (Brainstorm, Pulse, Kinetic, Data) now fails with "app bundle
   not found in DreamStore resources" → the "Retry install" state the user hit.
   D1 both extracts Brainstorm (giving it a real bundle) **and** restores a
   dual-mode install so the not-yet-extracted apps install again.

## Decisions (locked)

1. **Sequencing:** Brainstorm first, end-to-end (spec → plan → build → verify),
   then check in before D2–D4.
2. **Node server:** the standalone bundles `mcp-excalidraw-server` (its `dist/` +
   production `node_modules`) inside the `.app` as a Tauri resource and resolves
   it via `resource_dir()`. It still spawns the **user's** `node`
   (`Command::new("node")`) — `node` remains an external requirement, documented
   (same posture as the shell today). Bundling a node runtime is out of scope.
3. **Dual-mode install:** `app_install` copies the bundle for launchable apps and
   does a registry-only state-marker install for non-launchable (in-process) apps.
   The `launchable` manifest flag is the discriminator.
4. **Isolation + migration:** own dirs `~/.brainstorm` + `~/Brainstorm Projects/`;
   one-time non-destructive migration from `~/DreamStore Projects/`, filtering
   project dirs that contain `board.json` (Brainstorm's doc file).

## Non-goals

- Bundling a node runtime (user supplies `node`).
- D2–D4 (Pulse / Kinetic / Lens). Out of scope; own specs.
- Remote store / signing (DS2′-C).
- Any change to Brainstorm's UX beyond what extraction requires.

---

## Architecture (target end state)

```
apps/brainstorm/                         (git-ignored, like apps/remit/)
  frontend SPA (copied Brainstorm Root + decoupled shell imports)
  src-tauri/
    src/  trimmed shared core (copied from apps/remit/: paths/doc/projects/
          watch/skill/migrate + AppState) + brainstorm_canvas.rs (ported)
    resources/canvas-server/  mcp-excalidraw-server dist/ + prod node_modules
    capabilities/default.json (core:default + allow-start-dragging + …)
    tauri.conf.json  productName "Brainstorm Canvas", id app.altramanera.brainstorm,
                     bundle.resources: ["resources/canvas-server/**/*"]
  → builds "Brainstorm Canvas.app"

DreamStore shell  (Brainstorm STRIPPED)
  catalog.ts ROOTS: no brainstorm
  store-catalog/brainstorm.json: launchable: true
  lib.rs: no brainstorm_canvas module/commands/AppState.canvas_server/shutdown
  store.rs: app_install is DUAL-MODE (copy bundle | registry-only)
  scripts/bundle-apps.sh: + stage "apps/brainstorm" "Brainstorm Canvas.app"

Install:  launchable  → copy DreamStore/…/resources/apps/<App>.app → ~/Applications/DreamStore/<App>.app
          in-process  → registry entry only (state marker), Open mounts Root in-window
```

**Two hard-won invariants every extracted app MUST satisfy** (from DS2′-A):

- `apps/brainstorm/src-tauri/capabilities/default.json` granting `core:default`
  + `core:window:allow-start-dragging` (+ dialog, set-focus, close). Without it
  the webview silently gets zero permissions and the window won't drag — no error.
- A `data-tauri-drag-region` title bar in the app shell, left-padded ~84px to
  clear the macOS traffic lights, interactive buttons opting out with
  `data-tauri-drag-region={false}`, including an "Open DreamStore" button
  (`open -b app.altramanera.dreamstore`, fallback to the install path).

---

## D1.1 — Scaffold `apps/brainstorm/` (Remit template)

Per the launcher-pivot spec's per-extraction checklist steps 1–4:

1. Scaffold frontend SPA + Rust crate; copy the shared core from `apps/remit/`
   (paths/doc/projects/watch/skill/migrate + `AppState`); re-point data dirs to
   `~/.brainstorm` + `~/Brainstorm Projects/`.
2. Copy Brainstorm's frontend into `apps/brainstorm/`
   (`editor/canvases/brainstorm/BrainstormApp.tsx`, `index.tsx`,
   `persistence.ts`, `watch.ts`, `__tests__/`) and decouple its shell imports
   (UI components, icons, runtime) — the Remit §3 decoupling recipe.
3. Carry Brainstorm's per-app Rust — `brainstorm_canvas.rs` — into the crate and
   register its commands in the standalone's `invoke_handler`. Its `AppState`
   carries the `CanvasServer` handle.
4. Add `capabilities/default.json` + draggable title bar + "Open DreamStore"
   button + one-time migration from `~/DreamStore Projects/` (Remit's `migrate.rs`
   pattern) filtering dirs containing `board.json` → `~/Brainstorm Projects/`.

## D1.2 — Node canvas server (the one new piece vs. Remit)

The shell's `brainstorm_canvas.rs` resolves the server via
`CARGO_MANIFEST_DIR/../node_modules/mcp-excalidraw-server/dist/server.js` — the
dev repo layout, absent inside a bundled `.app`. The standalone changes exactly
one function:

- **`server_entry()`** resolves
  `app.path().resource_dir()?.join("resources/canvas-server/dist/server.js")`
  (mirroring `video.rs`'s `BaseDirectory::Resource` yt-dlp pattern). It therefore
  takes the `AppHandle` (or the resource dir) as input rather than reading
  `CARGO_MANIFEST_DIR`.
- Everything else ports verbatim: `pick_port` (prefer 3939 → free port),
  `write_mcp_config`, the `Command::new("node").arg(entry)…spawn()`,
  `wait_until_listening`, `brainstorm_canvas_open_window`/`_close_window`, and
  `shutdown` (kill the node child on main-window close so the localhost server +
  port don't leak).

**Bundling the server.** A build step stages `mcp-excalidraw-server` into
`apps/brainstorm/src-tauri/resources/canvas-server/`: copy the package's `dist/`
and install its production deps there (`npm install --omit=dev` inside a staging
copy of the package) so runtime `require`s resolve. `tauri.conf.json`
`bundle.resources` includes `"resources/canvas-server/**/*"` (the `**/*` rule from
DS2′-B — a bare `*` skips directories and fails the build). `resources/canvas-server/`
is git-ignored (build output). The step lives in the app's build script
(documented) and runs before `apps/brainstorm` `tauri:build`.

**Node requirement.** The spawn stays `Command::new("node")`; the standalone
requires `node` on `PATH` (documented in the app's CLAUDE.md / a clear error if
`node` is missing). Bundling a node runtime is DS2′-C-adjacent, out of scope.

## D1.3 — Dual-mode install fix (`src-tauri/src/store.rs`)

`app_install` must stop failing for apps with no bundle:

- **`launchable` app** (has a bundle staged in `resources/apps/<name>.app`): copy
  the bundle out — current behavior. Error if the bundle is genuinely missing
  (a real "should be bundled but isn't" failure).
- **non-`launchable` app** (in-process, no bundle): write the registry entry only
  (the pre-DS2′-B state-marker install). No bundle copy. Open mounts its `Root`
  in-window.

Implementation: the command learns whether the app is launchable. Cleanest is to
pass a `launchable: bool` from the frontend (`install.ts` already has the
manifest) so Rust doesn't guess; `copy_bundle_into` runs only when `launchable`,
else a registry-only write path (reuse the existing `read_registry`/`write_registry`
+ `safe_name` guard). `reconcile` for in-process apps checks registry presence
(no bundle to look for) — so `reconcile_in`'s predicate must tolerate a
registry entry whose name is a display name with no bundle on disk; keep the
launchable entries' `<name>.app`-existence check but do not prune a non-launchable
entry for lacking a bundle. Concretely: the registry entry records whether it was
a bundle install, and `reconcile` prunes only bundle-installs whose `.app` is gone.

**`app_install_states`** unchanged in contract (returns installed ids), backed by
the reconcile above.

## D1.4 — Strip Brainstorm from the shell (checklist step 6)

After the standalone builds and is added to `bundle-apps.sh` +
`store-catalog/brainstorm.json` (`launchable: true`):

- `editor/platform/catalog.ts`: remove `brainstorm: BrainstormApp` from `ROOTS`
  and the `BrainstormApp` import.
- `editor/canvases/brainstorm/`: remove from the shell tree (after it's copied
  into `apps/brainstorm/`) — the copy-then-strip Remit pattern.
- `src-tauri/src/lib.rs`: remove `mod brainstorm_canvas;`, the three
  `brainstorm_canvas::brainstorm_canvas_*` handler registrations, the
  `canvas_server: brainstorm_canvas::CanvasServer` field on `AppState` (and its
  initializer), and the `CloseRequested → brainstorm_canvas::shutdown` handler.
- Delete `src-tauri/src/brainstorm_canvas.rs`.
- Drop now-orphaned Cargo deps that only `brainstorm_canvas.rs` used (verify with
  `cargo check` / grep before removing each).
- `scripts/bundle-apps.sh`: add `stage "apps/brainstorm" "Brainstorm Canvas.app"`.

Note the bundle name has a space — `Brainstorm Canvas.app`. `safe_name`/
`bundle_name` handle spaces (basename check, not tokenization); `app.name`
"Brainstorm Canvas" → `bundle_name` → `Brainstorm Canvas.app`, consistent across
install/uninstall/launch. A test with a spaced name guards this.

## D1.5 — Error handling

- **Install a launchable app whose bundle is missing from Resources:**
  `app_install` returns "app bundle not found in DreamStore resources" (real
  failure — the bundle should have been staged).
- **Install a non-launchable app:** registry-only, always succeeds (no bundle
  needed).
- **`node` missing when Brainstorm starts its server:** the spawn fails;
  `brainstorm_canvas_start` returns a clear "node not found — install Node.js"
  error surfaced in the canvas UI (don't fail silently).
- **Gatekeeper on first open** of the unsigned copied `.app`: same as Remit
  (self-built → no quarantine; documented right-click→Open otherwise). Signing =
  DS2′-C.

## D1.6 — Testing

**Standalone `apps/brainstorm/` Rust tests** (mirroring Remit, with `tempfile`):
- `pick_port` prefers 3939, falls back to a free port when it's taken.
- `write_mcp_config` writes `.mcp.json` with the `excalidraw` MCP at the given URL.
- migration: `board.json`-filtered, marker-gated (`~/.brainstorm/migrated.json`),
  idempotent copy from a temp "DreamStore Projects" → "Brainstorm Projects";
  skips non-brainstorm dirs; source left read-only.
- `server_entry()` resolves under a given resource dir to
  `resources/canvas-server/dist/server.js`.
(The `node` spawn itself is not unit-tested — needs a real node + port — covered
by manual E2E, same boundary as Remit's PDF export.)

**Shell `store.rs` tests:**
- launchable-with-bundle → copies (existing behavior, still green).
- non-launchable-without-bundle → registry-only install succeeds, no bundle
  lookup, `app_install_states` reports it installed.
- reconcile does not prune a non-launchable (bundle-less) entry, but does prune a
  launchable entry whose `.app` is gone.
- a spaced bundle name (`Brainstorm Canvas.app`) resolves for a launchable app.

**Shell frontend tests:**
- a non-launchable app reaches `installed` without a bundle (pins the dual-mode
  fix at the `install.ts` layer).
- the catalog still lists Brainstorm after removing it from `ROOTS` (it's now a
  launchable manifest with no `Root`).

**Green gates:** shell `tsc` + `npm test` + `cargo check`; standalone `tsc` + its
tests + `cargo check`.

**Manual E2E (the real proof — needs a human at the screen):**
build Brainstorm standalone → `bundle-apps.sh` stages `Brainstorm Canvas.app` →
build DreamStore → launch DreamStore → **Install Brainstorm** (regression gone:
copies the bundle) → **Open** (Brainstorm launches as its own window; the
Excalidraw canvas server boots on a port; the board loads and the agent MCP wiring
works) → close (the node server does not leak) → **Uninstall**. Separately confirm
a still-in-process app (e.g. **Pulse**) **also installs again** (dual-mode fix)
and mounts in-window.

**Automated portions the controller runs:** all unit tests + both builds +
verifying `Brainstorm Canvas.app` nests inside `DreamStore.app` at
`Contents/Resources/resources/apps/`. The GUI smoke is the user's.

---

## Risks & open questions

- **Bundle size:** shipping `mcp-excalidraw-server` + its prod `node_modules`
  inside the `.app` is larger than Remit. Acceptable for a local offline store;
  flag the actual size after build.
- **Node dependency:** the app hard-requires `node` on the user's machine. If this
  becomes a support burden, bundling a node runtime is the DS2′-C-adjacent remedy.
- **Duplicate shared-core drift:** Brainstorm copies the projects/doc/watch/skill/
  migrate core like Remit. Accepted (independence > DRY); a shared crate is a later
  remedy. Same posture as the epic.
- **Dual-mode install is transitional:** the registry-only path exists only while
  D2–D4 are pending. After D4 every store app is launchable and the registry-only
  branch (and the in-process mount path) can be retired.
- **Spaced bundle name:** `Brainstorm Canvas.app` exercises spaces through
  `safe_name`/`bundle_name`; guarded by a test, but worth watching in the manual
  E2E (install dir, `open` arg).
