# DS2′-A — Remit as a standalone `.app` — design

**Date:** 2026-07-05
**Status:** design approved; ready for implementation plan
**Branch:** `feat/dreamstore-ds2` (off `main`)
**Predecessors:** DS-0 rename + DS-1 install store (merged to `main`), backlog cleanup (`e1d51a2`).
**Reference:** `docs/superpowers/specs/2026-07-05-dreamstore-store-design.md`, `docs/superpowers/specs/2026-07-04-app-shell-separation-plan.md` (Option B2).

## Motivation

The user's target model: **the DreamStore store is a launcher; each app is its
own independent desktop app** living in `~/Applications/DreamStore/`, added and
removed without rebuilding the store. This is the plan's Option B2 (separate-
process apps) — the full Glaze model — and is a multi-cycle epic:

- **DS2′-A (this spec):** extract Remit into its own standalone Tauri `.app`
  that runs with zero dependency on the shell. Proves the hardest new
  capability (an app fully separate from the shell, its own desktop app) on
  the easiest app (pure web + pdf-lib, the only app with no heavy native Rust).
- **DS2′-B (later):** the shell becomes a *launcher* that discovers, lists, and
  spawns `.app`s from `~/Applications/DreamStore/`; stops shipping Remit.
- **DS2′-C (later):** the store fetches a remote **approved-app list** and
  downloads/installs `.app` bundles from it (signing, versioning).
- **DS2′-D…N (later):** migrate the native apps (Kinetic, Pulse, Lens,
  Brainstorm) each into their own `.app`. This is the old DS-3, now the endgame.

DS2′-A touches the shell **not at all** (it keeps its compiled-in Remit); the
deliverable is a `Remit.app` that runs on its own.

## Non-goals (this spec)

- The launcher / store discovery + spawn (DS2′-B).
- Remote approved-app list, download, signing (DS2′-C).
- Removing Remit from the shell (DS2′-B).
- Migrating any native app (DS2′-D+).
- A shared Rust crate between shell and app (explicitly rejected — see §2).

---

## 1. Structure

A self-contained, **git-ignored** Tauri project at `apps/remit/` (git-ignored
because Remit holds the user's bank details + signature — same privacy posture
as today's `apps-private/remit/` overlay; it stays out of a shared clone).

```
apps/remit/                      # git-ignored
  package.json                   # own deps (React, pdf-lib, Radix UI, Vite, Tauri CLI)
  vite.config.ts                 # builds the Remit SPA (React + Tailwind, out: dist/)
  index.html                     # SPA entry
  tailwind + css tokens          # minimal copy of the vars Remit's components use
  src/
    main.tsx                     # mounts <RemitApp/> directly (no shell router)
    RemitApp.tsx, FormPanel.tsx, Preview.tsx, export.ts, schema.ts,
    recipients.ts, layout.ts, fields.ts   # moved from apps-private/remit/
    ui/                          # copied+trimmed: button, input, label, select, switch
    icons.tsx                    # copied subset: Plus, Trash2, Download, ArrowLeft
    runtime.ts                   # copied isTauri helper
    __tests__/                   # ported schema/recipients/export tests
  src-tauri/
    tauri.conf.json              # productName "Remit", id app.altramanera.remit, title "Remit"
    Cargo.toml                   # own crate; trimmed deps
    build.rs                     # tauri_build::build()
    src/
      lib.rs                     # own invoke_handler + minimal AppState (active_project mutex)
      paths.rs                   # ~/.dreamstore/ + ~/DreamStore Projects/ helpers (copied)
      projects.rs                # list/open/create/duplicate + ProjectMeta + create_project_dir
                                 #   (remit.json check inlined; no by_id/for_project)
      doc.rs                     # load_doc, save_doc, remit_export
      remit.rs                   # recipients_load/save, remit_duplicate
      canvas.rs                  # single RemitCanvas (doc_filename remit.json, seed, skill)
      skill.rs                   # skill-bundle materialization (project_open writes it)
      watch.rs                   # doc file watcher (project_open spawns it)
      prompt_mode.rs             # per-project prompt-mode seed (project_open calls it)
    templates/seed-remit.json
    skills/remit/SKILL.md
    assets/remit-template-white.pdf, signature.png, remit-template-white.png
```

The canonical Remit **source stays** in the shell's `apps-private/remit/` overlay
until DS2′-B removes Remit from the shell; DS2′-A *copies* it into `apps/remit/`.
(Both git-ignored; no shared-clone exposure either way.)

## 2. Backend — Remit.app's own Rust

Minimal `src-tauri` with ONLY the commands Remit's frontend calls, copied from
the shell and trimmed. **Shared state, not shared code**: Remit.app and the
shell's built-in Remit read the same `~/DreamStore Projects/` pool and
`~/.dreamstore/remit-recipients.json`, so the user's data is consistent across
both — but they are separate binaries with copied code. No build coupling.
(A shared crate was considered and rejected: it couples the two builds, against
the "each app fully separate" goal. Dedup can happen later if it ever matters.)

Commands in the `invoke_handler!` (exactly these):
- `projects_list`, `project_open`, `projects_create` — from `projects.rs`,
  trimmed to Remit only (pool = `~/DreamStore Projects/`; a Remit project is a
  dir containing `remit.json`). NOTE: the shell's `projects.rs` calls
  `canvas::for_project()` / `canvas::by_id()` to detect + filter project types.
  Trimmed, this collapses to a single check: a project is any dir containing
  `remit.json`. The copied `projects.rs` INLINES that (`dir.join("remit.json")
  .exists()`) instead of a multi-canvas registry — so `projects_list` needs no
  `for_project`/`by_id`, and `projects_create` always seeds `remit.json` from
  the single `RemitCanvas`. The `canvas: Option<String>` param on
  `projects_list` is kept for frontend compatibility (RemitApp calls it with
  `{ canvas: "remit" }`) but only ever matches Remit projects.
- `load_doc`, `save_doc`, `remit_export` — from `doc.rs`, copied verbatim
  (already generic; `remit_export` keeps its basename-sanitize + dir-exists
  guards).
- `remit_recipients_load`, `remit_recipients_save`, `remit_duplicate` — from
  `remit.rs` (recipients at `~/.dreamstore/remit-recipients.json`).

`canvas.rs`: a single `RemitCanvas` (`doc_filename() = "remit.json"`,
`seed_bytes()` from `templates/seed-remit.json`, `skill_bundle()`). No registry,
no `#[cfg(private_remit)]` gates — this app IS Remit; everything is
unconditional.

`paths.rs`: `user_dir()`/`user_path()`/`projects_dir()` copied. **No migration**
— the shell already migrated the legacy dirs; the standalone app only reads the
DreamStore locations.

**`project_open` pulls a support chain** (verified in the shell source): it
spawns a file watcher (`watch::spawn`), materializes the skill bundle
(`skill::write`), seeds prompt-mode (`prompt_mode::ensure_seeded`), records
recents with a timestamp, and stores an `ActiveProject` in `AppState`. So
Remit.app's backend also copies **`watch.rs`, `skill.rs`, `prompt_mode.rs`**, a
minimal **`AppState`** (`active_project: Mutex<Option<ActiveProject>>`), and
`preview_meta` support. (If the plan finds prompt_mode/preview are dead weight
for Remit's actual UX, it may drop them and simplify `project_open` — but the
watcher + skill write are load-bearing for the agent workflow and stay.)

Cargo deps: `tauri` (with `protocol-asset`), `tauri-plugin-dialog`,
`tauri-plugin-shell`, `serde`, `serde_json`, `dirs`, plus **`notify` +
`notify-debouncer-mini`** (the watcher) and **`chrono`** (recents timestamps) —
required by `project_open`. Dropped vs the shell: DuckDB, audio, video,
xterm/pty, agent-chat, git — none of Remit's commands touch those.

## 3. Frontend — Remit.app's own SPA

Remit's frontend becomes a plain standalone SPA: `index.html` + `main.tsx`
mounting `<RemitApp/>` directly. No shell platform router, no `CanvasPlugin`
indirection, no `mount(el,...)` micro-frontend contract — Remit is the whole app.

Decoupling the 10 shell imports found in the current overlay:
- `@/components/ui/{button,input,label,select,switch}` → copy those 5 Radix/
  shadcn components into `apps/remit/src/ui/`.
- `../../icons` → copy the used subset (`Plus, Trash2, Download, ArrowLeft`) into
  `src/icons.tsx`.
- `../../runtime` (`isTauri`) → copy the helper into `src/runtime.ts`.
- `../../canvas` + `../../selection` → **dropped.** The `remitCanvas` plugin
  (`index.tsx`) and its `CanvasPlugin`/`Selection`/`resolveConflict` types
  existed only so the shell substrate could host Remit. Standalone, `RemitApp`
  renders directly; delete `index.tsx` and those imports. `schema.ts`'s
  `parseDoc`/`defaultDoc`/`RemitDoc` stay (real logic) and are imported directly
  where `../../platform/apps` / `../../canvas` used to re-export the type.

`invoke` usage is unchanged in spirit: `RemitApp` already lazy-imports
`@tauri-apps/api/core` and calls `projects_list` / `project_open` /
`projects_create` / `remit_export`. Those names now resolve against Remit.app's
OWN backend (§2). No host-passed `invoke` — it's a normal Tauri app calling its
own commands.

Styling: copy the minimal Tailwind config + the CSS custom properties Remit's
components reference into `apps/remit/`, so it looks identical standalone.

## 4. Build, packaging, error handling, testing

**Build & packaging:**
- Own npm project. `cd apps/remit && npm install && npm run tauri:build` →
  `apps/remit/src-tauri/target/release/bundle/macos/Remit.app`.
- A documented step (or small script) copies the built `Remit.app` to
  `~/Applications/DreamStore/Remit.app`; double-clicking runs it standalone.
- `tauri.conf.json`: `productName` "Remit", `identifier` `app.altramanera.remit`,
  window `title` "Remit", `frontendDist` → the Vite `dist/`, `devUrl` its own
  port, `beforeDevCommand`/`beforeBuildCommand` its own Vite scripts. CSP `null`
  (matches shell; no external loads).

**Error handling:**
- Missing `~/DreamStore Projects/` pool → the projects list shows empty, not an
  error (`projects_create` does `create_dir_all`; confirm `projects_list`
  returns `[]` on a missing pool).
- `remit_export` keeps basename-sanitize + dir-exists guards verbatim.
- Missing recipients store → returns `[]` (already handled).

**Testing:**
- Frontend (vitest in `apps/remit/`): port the 3 existing tests (schema,
  recipients, export) to the new paths; the export test reads assets from
  `apps/remit/src-tauri/assets/`.
- Rust (cargo test in `apps/remit/src-tauri/`): smoke tests for the copied
  commands using `tempfile` — create a temp project, save/load a `remit.json`,
  recipients round-trip, `remit_export` writes a file.
- Standalone run (the real proof): `cd apps/remit && npm run tauri:dev` launches
  Remit in its own window; manually create a transfer, fill the form, export a
  PDF, save/load a recipient. Then `npm run tauri:build` + double-click the
  `.app` to confirm it runs with no shell present.
- Shell unaffected: shell `tsc` + `npm test` + `cargo check` stay green (this
  cycle does not touch the shell).

## 5. Risks & open questions

- **Duplication drift:** Remit.app's copied `projects.rs`/`doc.rs` can drift from
  the shell's. Accepted for now (independence > DRY); a shared crate is the
  later remedy if it becomes painful. Flag in the plan that the copy is a
  point-in-time fork.
- **UI-component copy fidelity:** the 5 copied shadcn components must carry their
  Tailwind classes + token CSS vars or Remit looks wrong standalone. The plan
  includes a visual check.
- **Shared-pool concurrency:** the shell's built-in Remit and Remit.app both
  read/write `~/DreamStore Projects/` + the recipients store. Same tmp+rename
  atomic writes already used; simultaneous use is unlikely (one is being
  replaced by the other in DS2′-B) — noted, not guarded.
- **Signing:** an unsigned `.app` triggers Gatekeeper on first open. For a
  local, self-built app this is acceptable (right-click → Open); real signing is
  a DS2′-C concern.
- **Secrets in history:** unchanged from prior cycles — Remit's assets remain in
  the shell repo's git history; `apps/remit/` being git-ignored keeps the new
  copy out of the tree but does not scrub history (separate decision).
