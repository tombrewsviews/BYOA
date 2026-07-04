# App / Shell Separation & Private Apps — architecture plan

**Date:** 2026-07-04
**Status:** planning (no implementation yet — per user request, plan pros/cons first)
**Motivation:** Distribute and evolve the KineticType *shell* (the app-store /
platform) independently from the *apps* it hosts, and keep certain apps
(e.g. Remit, which holds personal bank details + signature) **private** — present
locally but excluded when the repo is shared or distributed.

The reference model the user gave: **Glaze** — an App-Store-style app that lives
in `/Applications` with none of the hosted apps' code inside it; installing an
app drops it into a `Glaze/` folder under `/Applications`. KineticType would play
the role of Glaze: a shell that lists a store library and installs apps into a
`KineticType Apps/` folder, with app code separated from shell code.

---

## 1. Where we are today (the coupling)

Apps are **statically linked into the shell at compile time**, in five hardcoded
seams (verified in the codebase):

1. **Frontend app registry** — `editor/platform/apps.ts:21-25` statically imports
   every app's Root component; `APPS[]` lists them.
2. **Frontend canvas registry** — `editor/canvas.ts:97-101` imports each
   `CanvasPlugin`; `resolveCanvas()` switches on app id.
3. **Backend canvas registry (Rust)** — `src-tauri/src/canvas.rs`: five `Canvas`
   trait impls + `by_id()` / `for_project()` matches.
4. **Compile-time embeds** — `src-tauri/src/canvases/*.rs` pull each app's
   `SKILL.md` (`include_str!`) and seed JSON (`include_bytes!`) into the binary.
5. **Module list** — `src-tauri/src/canvases/mod.rs`.

Consequences:
- Everything ships in one JS chunk and one Rust binary. No lazy-loading, no
  per-app cargo features, no dynamic discovery.
- There is **no** "private / local-only" concept anywhere. `status` is only
  `available | coming-soon`; `install.ts` mocks install and force-marks any app
  with a `Root` as permanently installed.
- Sharing the repo shares **all** app code, including Remit's bank data/signature
  assets (`editor/canvases/remit/assets/`).

So "make Remit private" and "separate app code from shell code" are the same
project viewed at two depths. This plan defines both and sequences them so the
**private-exclusion goal is reached early and cheaply**, with the full
store/distribution split as a larger, optional follow-on.

---

## 2. Options

### Option A — Manifest flag + git exclusion (lightweight, no architecture change)

Add `visibility: "public" | "private"` to `AppManifest`. Private apps:
- render only in a local build (gated by an env/flag),
- have their code kept out of the shared/distributed tree via a **separate
  private directory** that is git-ignored (or a git submodule / separate repo).

Mechanism: move private apps to `editor/apps-private/**` and
`src-tauri/src/canvases-private/**`, add those globs to `.gitignore`, and make
the five seams above **tolerate missing private apps** (a codegen or a
try-import) so the public build still compiles without them.

- **Pros:** smallest change; reaches the real goal (private apps absent when
  sharing) fast; no runtime install machinery; keeps single-binary simplicity.
- **Cons:** the Rust seams (`include_str!`, `by_id`, `mod.rs`) are compile-time —
  a git-ignored private app that's *present locally* still compiles in, but a
  clone *without* it must still compile. That requires either (a) a build script
  that generates the registry from whatever app dirs exist, or (b) cargo features
  per private app. Not "store-like"; apps still bundle into the one binary when
  present.

### Option B — Runtime plugin architecture (full Glaze-style store)

Shell becomes a host that **discovers apps at runtime** from an "apps folder"
(e.g. `~/KineticType Apps/` or `<Application Support>/KineticType/Apps/`). Each
app is a self-describing bundle (manifest + frontend entry + optional sidecar).
Shell ships with none of the app code; installing fetches an app bundle into the
apps folder.

Two sub-variants by how app UI loads:
- **B1 — Web-bundle apps:** each app is a pre-built JS bundle (ESM) loaded via
  dynamic `import()` from the apps folder, mounted in an iframe or module
  federation boundary. Rust side exposes a **generic** doc/skill/seed API driven
  by the app manifest (no per-app Rust). Apps that need native code (Pulse's
  audio, Data's DuckDB) would need a plugin-ABI or WASM — a hard boundary.
- **B2 — Separate-process apps:** each app is its own Tauri/webview or sidecar
  process the shell launches. Maximum isolation, maximum complexity.

- **Pros:** true separation; ship shell updates without touching apps and vice
  versa; private apps are simply bundles you don't publish; matches the Glaze
  mental model exactly.
- **Cons:** large effort. The current apps rely on **compile-time Rust** (DuckDB
  engine, audio analysis, video export, canvas-server spawning). A runtime plugin
  model needs a stable host API those apps call instead of being linked in —
  a substantial refactor per app. Security/signing of installed bundles, version
  compatibility, and the loss of one-binary simplicity are real costs.

### Option C — Build-time app catalog (codegen) + private overlay (middle path)

Keep single-binary runtime, but make the **catalog generated, not hardcoded**:
- A build step scans `editor/apps/*` and `src-tauri/src/canvases/*` for app
  manifests and **generates** the five seams (frontend registry, canvas registry,
  Rust `by_id`/`for_project`/`mod.rs`, embeds).
- Private apps live in a git-ignored overlay dir (`apps-private/`) that the same
  build step includes **only when present**. A public clone simply has no overlay
  → the generated catalog omits them → compiles and ships without them.
- Add `visibility` to the manifest and an in-app **Settings → Apps** panel to
  flip an app between Private (local overlay) and Public (tracked tree), which
  physically moves the app dir and updates git tracking.

- **Pros:** achieves both goals (private exclusion **and** clean app/shell
  separation of *source*) without adopting a runtime plugin ABI; keeps native
  Rust apps working as-is; the codegen is the seam that makes apps additive.
- **Cons:** codegen adds build complexity; still one binary (not a literal
  install-to-folder store, but the *distribution* concern — "private code absent
  when shared" — is fully met); moving apps between public/private is a
  file-move + git operation, needs care.

---

## 3. Recommendation

**Do Option A now (Phase 1) to hit the privacy goal immediately, structured so it
grows into Option C (Phases 2-3). Treat Option B as a separate future epic** only
if you actually want a downloadable third-party app store; it's overkill for
"keep my private apps out of the shared repo and let me version the shell
separately."

Rationale: the urgent, concrete need is **"when I share the repo, private apps
(Remit) aren't in it."** That's a source-tree + build-catalog problem, not a
runtime-plugin problem. Option A delivers it in the smallest change; Option C
generalizes it so adding/removing apps stops touching five hand-maintained lists.
Option B's runtime loading only pays off if apps come from outside your own repo.

---

## 4. Implementation plan (phased)

### Phase 1 — Private overlay + build tolerance (reaches the privacy goal)

1. **Manifest:** add `visibility: "public" | "private"` to `AppManifest`
   (`editor/platform/apps.ts`); default `"public"`. Mark Remit `"private"`.
2. **Move private app source** into overlay dirs, git-ignored:
   - `editor/apps-private/remit/**` (from `editor/canvases/remit/`)
   - `src-tauri/src/canvases-private/remit.rs`, `skills-private/remit/`,
     `templates-private/seed-remit.json`
   - Add these globs to `.gitignore`.
3. **Make the five seams tolerate absence.** Minimal form: a small `build.rs`
   (Rust) and a Vite/codegen step (frontend) that emit the registry entries for
   whatever app dirs exist (public always; private only if the overlay is
   present). A public clone with no overlay compiles clean.
4. **Verify:** `git status` on a fresh clone shows no Remit code; local build
   still runs Remit; `cargo check` + `tsc` + tests green in both states.

**Outcome after Phase 1:** sharing the repo excludes private apps; shell + public
apps are self-contained. This is the milestone that satisfies the user's request.

### Phase 2 — Catalog codegen (removes the hand-maintained lists) — Option C

5. Replace the hardcoded `APPS[]`, `resolveCanvas`, `by_id`, `for_project`,
   `mod.rs`, and `include_*!` blocks with generated code produced from a
   per-app `app.manifest.json` (frontend) and a Rust `build.rs` scan. Adding an
   app becomes "drop a folder in", not "edit five files".
6. Each app declares its capabilities in its manifest (doc filename, seed path,
   skill dir, whether it needs native Rust) so the generator wires it correctly.

### Phase 3 — In-app Apps settings panel (the "make public/private" toggle)

7. **Settings → Apps** panel: list apps with a Public/Private switch. Flipping it
   moves the app's source between the tracked tree and the git-ignored overlay
   and updates git tracking, then prompts a rebuild. This is the UI the user
   sketched ("a panel to change the app to be included in the KineticType github
   and store").

### Phase 4 (optional, future) — Runtime store (Option B)

Only if distributing third-party apps becomes a goal: define a host API, build
per-app bundles, load them from a `KineticType Apps/` folder, and add real
install/uninstall/versioning. Large; not needed for the stated goal.

---

## 5. Risks & open questions

- **Native-Rust apps vs isolation:** Pulse/Data/Remit-export use compiled Rust.
  Phase 1-3 keep them compiled-in (present-locally), so isolation is at the
  *source/distribution* layer, not runtime. Full runtime isolation (Phase 4)
  needs a host API — flag before committing to it.
- **Codegen determinism:** the generated catalog must be reproducible and
  reviewable; check generated files into `dist`/`OUT_DIR`, not the tracked tree,
  or clearly mark them generated.
- **Moving apps public↔private** must not lose git history or leave dangling
  seam references — Phase 3 needs careful file-move + tracking logic and a dry-run.
- **Secrets already committed:** Remit's signature + bank template were committed
  earlier in this branch's history. Making Remit private going forward does not
  scrub history — if that matters, a history rewrite (git filter-repo) of those
  asset paths is a separate, explicit step to decide on.

---

## 6. Suggested first concrete step

Land **Phase 1** behind the already-added `private` category (done) as a separate
branch `feat/private-apps`, starting with the manifest `visibility` flag and the
Remit overlay move + build tolerance, verified by a throwaway clean clone that
must build without the overlay. Defer Phases 2-4 until Phase 1 is validated.
