# DS2′-A — Remit as a standalone `.app` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Remit into its own self-contained Tauri `.app` at `apps/remit/` that runs with zero dependency on the DreamStore shell — its own frontend SPA, its own trimmed Rust backend, its own isolated data dirs — and packages to a double-clickable `Remit.app`.

**Architecture:** A new git-ignored npm+Tauri project at `apps/remit/`. The frontend is a plain SPA that mounts `<RemitApp/>` directly (no shell router / canvas plugin). The backend is a fresh minimal crate holding only the ~10 commands Remit's frontend calls, copied from the shell and **aggressively trimmed**: the multi-canvas `Canvas` trait collapses to hardcoded `remit.json` constants; `ProjectMeta` sheds its Remotion-preview fields; `project_close` no longer renders; the app reads/writes its **own isolated dirs** (`~/Remit Projects/` + `~/.remit/`), fully independent of the shell. Shell is untouched this cycle.

**Tech Stack:** Tauri 2.11 + React 19 + Vite 6 + Tailwind v4 (`@tailwindcss/vite`) + pdf-lib + radix-ui/shadcn components. Rust deps: `tauri` (protocol-asset), `tauri-plugin-dialog`, `serde`/`serde_json`, `dirs`, `slug`, `chrono`, `trash`, `notify` + `notify-debouncer-mini`. Tests: vitest (frontend), cargo test + `tempfile` (Rust).

## Global Constraints

- **Isolated data dirs (design decision this cycle):** standalone Remit uses `~/Remit Projects/` (project pool) and `~/.remit/` (recipients, recents, skills-bundle). It does **NOT** touch `~/DreamStore Projects/` or `~/.dreamstore/`, and runs **no** legacy migration. This intentionally reverses the design spec's §2 "shared state" premise per the user's direction ("each app must run separately … standalone without the DreamStore app"), and neutralizes the spec's "shared-pool concurrency" risk.
- **`apps/` is git-ignored.** Add `apps/` to `.gitignore` (Remit holds bank details + signature — same privacy posture as `editor/apps-private/`).
- **The shell is NOT touched this cycle.** No edits under `editor/`, `src-tauri/`, or root config. Shell `tsc` + `npm test` + `cargo check` must stay green (they will, since nothing there changes).
- **Copy, don't move.** The canonical Remit source stays in `editor/apps-private/remit/` + `src-tauri/{canvases-private,templates-private,skills-private}/`. This plan *copies* it. The copy is a point-in-time fork (drift risk accepted; a shared crate is the later remedy).
- **macOS only.** Unsigned `.app` → Gatekeeper prompt on first open is acceptable (right-click → Open). Real signing is DS2′-C.
- **Identifiers:** `productName` "Remit", bundle identifier `app.altramanera.remit`, window title "Remit". CSP `null` (no external loads).
- **Packaging target:** the built `.app` is copied to `~/Applications/DreamStore/Remit.app` (the store's install root) so it's install-location-compatible and double-clickable. Wiring the store's `app_install` to copy the `.app` is DS2′-B, out of scope here.
- **All source files carry the same comment density / header-comment style as the shell originals.** These are copies — preserve the doc comments.

---

## File Structure

New project rooted at `apps/remit/` (all paths below relative to it unless noted):

```
apps/remit/
  .gitignore                     # node_modules, dist, src-tauri/target
  package.json                   # own deps + scripts (dev/build/test)
  tsconfig.json                  # React + strict, @ alias → src/
  vite.config.ts                 # Vite, root=., tailwind plugin, port 5175, @ alias
  vitest.config.ts               # jsdom, @ alias, include src/**/__tests__
  index.html                     # SPA entry → src/main.tsx
  src/
    index.css                    # copied token block (from editor/index.css)
    main.tsx                     # mounts <RemitApp onExit={noop}/> into #root
    RemitApp.tsx                 # copied; imports rewired to local paths
    FormPanel.tsx, Preview.tsx, export.ts, schema.ts, fields.ts, layout.ts, recipients.ts   # copied verbatim (import paths rewired)
    lib/utils.ts                 # copied cn()
    runtime.ts                   # copied isTauri()
    components/ui/{button,input,label,select,switch}.tsx   # copied 5 shadcn comps
    assets/remit-template-white.pdf, remit-template-white.png, signature.png   # copied
    __tests__/schema.test.ts, recipients.test.ts, export.test.ts   # ported
  src-tauri/
    .gitignore                   # target/
    tauri.conf.json              # Remit product/identifier/window; frontendDist ../dist; devUrl 5175
    Cargo.toml                   # trimmed deps
    build.rs                     # tauri_build::build()  (no cfg logic)
    templates/seed-remit.json    # copied
    skills/remit/SKILL.md        # copied
    src/
      main.rs                    # app_lib::run()
      lib.rs                     # AppState{active_project}, plugins, invoke_handler
      paths.rs                   # ~/.remit + ~/Remit Projects helpers (no migration)
      remit.rs                   # ALL commands: projects_*, project_*, doc, recipients, export, duplicate
      watch.rs                   # copied doc-file watcher
      skill.rs                   # trimmed skill-bundle materialization (.claude/skills symlink + CLAUDE.md)
```

Design note on the backend collapse: the shell splits Remit's backend across `projects.rs`, `doc.rs`, `canvas.rs`, `canvases-private/remit_commands.rs`, `canvases-private/remit_skill.rs`, `prompt_mode.rs`, `preview.rs`, `history.rs`. Standalone, most of that is either dead (preview/history/prompt_mode) or collapses to constants (the whole `Canvas` trait → `DOC_FILENAME = "remit.json"` + a seed + a skill bundle). So all commands live in one focused `remit.rs`, with `watch.rs` and `skill.rs` as the two genuinely-separable support modules.

---

## Task 1: Scaffold the `apps/remit/` frontend project (builds + runs empty)

**Files:**
- Modify: `/Users/parandykt/Apps/KineticType/.gitignore` (add `apps/`)
- Create: `apps/remit/.gitignore`
- Create: `apps/remit/package.json`
- Create: `apps/remit/tsconfig.json`
- Create: `apps/remit/vite.config.ts`
- Create: `apps/remit/index.html`
- Create: `apps/remit/src/main.tsx` (temporary placeholder mount)
- Create: `apps/remit/src/index.css`

**Interfaces:**
- Produces: a runnable Vite dev server on port 5175 serving an empty `#root`, and `npm run build` producing `apps/remit/dist/`. Later tasks replace the placeholder `main.tsx`.

- [ ] **Step 1: Add `apps/` to the repo `.gitignore`**

Append to `/Users/parandykt/Apps/KineticType/.gitignore` (after the "Private apps" block near the end):

```
# Standalone extracted apps — each a self-contained Tauri project holding
# private data (Remit carries bank details + signature). Git-ignored like
# editor/apps-private/; the shell build does not depend on them.
apps/
```

- [ ] **Step 2: Create `apps/remit/.gitignore` and `apps/remit/src-tauri/.gitignore`**

`apps/remit/.gitignore`:

```
node_modules/
dist/
src-tauri/target/
.DS_Store
```

(Create `apps/remit/src-tauri/.gitignore` too, so the nested target is covered even standalone:)

```
target/
```

- [ ] **Step 3: Create `apps/remit/package.json`**

```json
{
  "name": "remit-app",
  "version": "0.1.0",
  "private": true,
  "description": "Remit — standalone bank-transfer form filler (extracted from DreamStore).",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run --passWithNoTests",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.11.0",
    "@tauri-apps/plugin-dialog": "^2.7.1",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^1.16.0",
    "pdf-lib": "^1.17.1",
    "radix-ui": "^1.4.3",
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "tailwind-merge": "^3.6.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.0",
    "@tauri-apps/cli": "^2.11.1",
    "@testing-library/dom": "^10.4.1",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^4.7.0",
    "jsdom": "^25.0.1",
    "tailwindcss": "^4.3.0",
    "typescript": "^6.0.3",
    "vite": "^6.4.2",
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 4: Create `apps/remit/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

Note: TypeScript 6.x errors on `baseUrl` (TS5101, deprecation-as-error), so it is omitted; with no `baseUrl`, `paths` values must be **relative** (`./src/*`). The Vite ambient types (`import.meta`, the `?url` / `.css` side-effect imports) come from `src/vite-env.d.ts` (next step), not a `types` restriction.

- [ ] **Step 5: Create `apps/remit/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import * as path from "path";

// Standalone Remit SPA. root is apps/remit/ (index.html at root), output to
// dist/ (the .app's frontendDist). No shell publicDir needed — Remit's PDF
// template + signature ship as bundled src/assets/ imports.
export default defineConfig({
  plugins: [tailwindcss(), react()],
  // Tauri dev server: fixed port, no auto-open, fail if the port is taken.
  clearScreen: false,
  server: { port: 5175, strictPort: true },
  resolve: {
    alias: { "@": path.join(__dirname, "src") },
  },
});
```

- [ ] **Step 6: Create `apps/remit/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Remit</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `apps/remit/src/index.css`** (copy the token block from `editor/index.css` verbatim — it is self-contained)

Copy the entire contents of `/Users/parandykt/Apps/KineticType/editor/index.css` into `apps/remit/src/index.css` unchanged. It begins with `@import "tailwindcss";` and defines the `:root` grey tokens, `.light` overrides, the number-spinner reset, and the `@theme inline` color/text mappings that every `bg-card` / `text-muted-foreground` / `border-border` class Remit uses resolves against. **Exception:** the shell file's line 2 is `@import "tw-animate-css";`. The select dropdown uses `data-[state=open]:animate-in` etc. from that package. To avoid adding the `tw-animate-css` dep, **delete line 2** (`@import "tw-animate-css";`) — the animate utilities degrade to no-ops (dropdown appears without the fade/zoom transition), which is cosmetically fine. Keep everything else identical.

- [ ] **Step 7b: Create `apps/remit/src/vite-env.d.ts`** (Vite ambient types)

```ts
/// <reference types="vite/client" />
```

This gives TypeScript the types for `import.meta`, `?url` asset imports, and CSS side-effect imports (`import "./index.css"`) that Remit's source uses. Without it, `tsc --noEmit` errors TS2882 on the CSS import.

- [ ] **Step 8: Create a temporary `apps/remit/src/main.tsx` placeholder**

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div className="p-8 text-foreground">Remit scaffold OK</div>
  </React.StrictMode>,
);
```

- [ ] **Step 9: Install deps and verify the build**

Run:
```bash
cd apps/remit && npm install && npm run build
```
Expected: `npm install` completes; `npm run build` succeeds and creates `apps/remit/dist/index.html` + assets. (Warnings are fine; a non-zero exit is not.)

- [ ] **Step 10: Commit**

```bash
cd /Users/parandykt/Apps/KineticType
git add .gitignore
git add -f apps/remit/.gitignore apps/remit/src-tauri/.gitignore apps/remit/package.json apps/remit/tsconfig.json apps/remit/vite.config.ts apps/remit/index.html apps/remit/src/main.tsx apps/remit/src/index.css
git commit -m "feat(remit-app): scaffold standalone apps/remit/ frontend project"
```

Note: `apps/` is git-ignored, so every `git add` of a tracked-plan file under `apps/remit/` must use `git add -f`. Do **not** force-add `node_modules/`, `dist/`, or `src-tauri/target/`. This applies to every commit step below.

---

## Task 2: Copy the shared UI components + helpers

**Files:**
- Create: `apps/remit/src/lib/utils.ts`
- Create: `apps/remit/src/runtime.ts`
- Create: `apps/remit/src/components/ui/button.tsx`
- Create: `apps/remit/src/components/ui/input.tsx`
- Create: `apps/remit/src/components/ui/label.tsx`
- Create: `apps/remit/src/components/ui/select.tsx`
- Create: `apps/remit/src/components/ui/switch.tsx`

**Interfaces:**
- Produces: `cn(...)` (from `@/lib/utils`), `isTauri()` (from `@/runtime`), and the 5 components (`Button`, `Input`, `Label`, `Switch`, and the `Select*` family) — all importing `cn` from `@/lib/utils`. Consumed by `FormPanel.tsx` / `RemitApp.tsx` in Task 4.

- [ ] **Step 1: Copy `cn()` helper**

Copy `/Users/parandykt/Apps/KineticType/editor/lib/utils.ts` verbatim to `apps/remit/src/lib/utils.ts`. (Contents: imports `clsx` + `twMerge`, exports `cn`.)

- [ ] **Step 2: Copy `isTauri()` helper**

Copy `/Users/parandykt/Apps/KineticType/editor/runtime.ts` verbatim to `apps/remit/src/runtime.ts`.

- [ ] **Step 3: Copy the 5 shadcn components**

Copy each of these verbatim from `editor/components/ui/` to `apps/remit/src/components/ui/`:
- `button.tsx`, `input.tsx`, `label.tsx`, `select.tsx`, `switch.tsx`

They already import `cn` from `@/lib/utils`, which now resolves to `apps/remit/src/lib/utils.ts` via the `@` alias (Task 1 vite + tsconfig). `select.tsx`/`switch.tsx` import from `radix-ui` and `lucide-react` (both in Task 1 deps). **No edits needed** — verify each file's imports are only `@/lib/utils`, `radix-ui`, `lucide-react`, `class-variance-authority`, `react`.

- [ ] **Step 4: Verify the components typecheck**

Run:
```bash
cd apps/remit && npx tsc --noEmit
```
Expected: PASS (no errors). If `tsc` reports unused-locals in a copied component, that is a copy fidelity error — re-copy verbatim; do not hand-edit the component bodies.

- [ ] **Step 5: Commit**

```bash
cd /Users/parandykt/Apps/KineticType
git add -f apps/remit/src/lib/utils.ts apps/remit/src/runtime.ts apps/remit/src/components/ui/
git commit -m "feat(remit-app): copy shared cn/isTauri helpers + 5 shadcn UI components"
```

---

## Task 3: Copy Remit's domain source + assets, port the 3 tests

**Files:**
- Create: `apps/remit/src/schema.ts` (copy verbatim)
- Create: `apps/remit/src/fields.ts` (copy verbatim)
- Create: `apps/remit/src/layout.ts` (copy verbatim)
- Create: `apps/remit/src/export.ts` (copy verbatim)
- Create: `apps/remit/src/recipients.ts` (rewire `../../runtime` → `./runtime`)
- Create: `apps/remit/src/Preview.tsx` (copy verbatim)
- Create: `apps/remit/src/FormPanel.tsx` (rewire `@/components/ui/*` — unchanged, alias still works)
- Create: `apps/remit/src/assets/remit-template-white.pdf`
- Create: `apps/remit/src/assets/remit-template-white.png`
- Create: `apps/remit/src/assets/signature.png`
- Create: `apps/remit/src/__tests__/schema.test.ts`
- Create: `apps/remit/src/__tests__/recipients.test.ts`
- Create: `apps/remit/src/__tests__/export.test.ts`
- Create: `apps/remit/vitest.config.ts`

**Interfaces:**
- Consumes: `isTauri` (Task 2), the UI components (Task 2), `pdf-lib`.
- Produces: `defaultDoc()`, `parseDoc(raw)`, `exportFilename(doc)`, `RemitDoc`, `SENDER`, `SENDER_ACCOUNTS`, `AmountCurrency` (from `schema.ts`); `buildFilledPdf(doc, tplBytes, sigBytes)` (from `export.ts`); `loadRecipients()`, `saveRecipients(list)`, `applyRecipient`, `recipientFromDoc`, `recipientKey`, `newId`, `SavedRecipient` (from `recipients.ts`); `<FormPanel>`, `<Preview>` components. Consumed by `RemitApp.tsx` in Task 4.

- [ ] **Step 1: Copy the domain source files**

Copy these verbatim from `editor/apps-private/remit/` to `apps/remit/src/`:
- `schema.ts`, `fields.ts`, `layout.ts`, `export.ts`, `Preview.tsx`

Their imports are all relative (`./schema`, `./layout`, `./fields`) or npm (`pdf-lib`, `react`) or asset (`./assets/...`) — all still valid at the new location. **No edits.**

- [ ] **Step 2: Copy + rewire `recipients.ts`**

Copy `editor/apps-private/remit/recipients.ts` to `apps/remit/src/recipients.ts`, then change its one shell import:

```ts
// FROM:
import { isTauri } from "../../runtime";
// TO:
import { isTauri } from "./runtime";
```

Leave the rest unchanged (the `~/.kinetic-studio/...` mention in its header comment is stale even in the shell; optionally update the comment to `~/.remit/remit-recipients.json`, but the backend command name is unchanged so behavior is identical).

- [ ] **Step 3: Copy `FormPanel.tsx`**

Copy `editor/apps-private/remit/FormPanel.tsx` to `apps/remit/src/FormPanel.tsx` verbatim. Its imports are `@/components/ui/{button,input,label,switch,select}` (alias → `apps/remit/src/components/ui/`, valid) and `./schema` (valid). **No edits.**

- [ ] **Step 4: Copy the 3 binary assets**

```bash
cp editor/apps-private/remit/assets/remit-template-white.pdf apps/remit/src/assets/remit-template-white.pdf
cp editor/apps-private/remit/assets/remit-template-white.png apps/remit/src/assets/remit-template-white.png
cp editor/apps-private/remit/assets/signature.png apps/remit/src/assets/signature.png
```

- [ ] **Step 5: Create `apps/remit/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import * as path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.join(__dirname, "src") },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    globals: false,
  },
});
```

- [ ] **Step 6: Port `schema.test.ts` and `recipients.test.ts`**

Copy `editor/apps-private/remit/__tests__/schema.test.ts` and `recipients.test.ts` to `apps/remit/src/__tests__/`. Their imports are `../schema` and `../recipients` (relative — still valid one level up from `__tests__/`). **No edits.**

- [ ] **Step 7: Port `export.test.ts` (fix the asset path)**

Copy `editor/apps-private/remit/__tests__/export.test.ts` to `apps/remit/src/__tests__/export.test.ts`, then change the assets-dir line. The original reads assets relative to the shell repo root:

```ts
// FROM:
const assetsDir = path.resolve("editor/apps-private/remit/assets") + "/";
// TO (vitest cwd is apps/remit/ here):
const assetsDir = path.resolve("src/assets") + "/";
```

Leave the rest (the `readBytes` realm workaround, `sampleDoc`, assertions) unchanged.

- [ ] **Step 8: Run the ported tests to verify they pass**

Run:
```bash
cd apps/remit && npm test
```
Expected: PASS — all 3 test files green (schema, recipients, export). The export test actually loads the copied PDF/PNG assets and builds a filled PDF, so a green run also proves the asset copies are intact.

- [ ] **Step 9: Commit**

```bash
cd /Users/parandykt/Apps/KineticType
git add -f apps/remit/src/schema.ts apps/remit/src/fields.ts apps/remit/src/layout.ts apps/remit/src/export.ts apps/remit/src/recipients.ts apps/remit/src/Preview.tsx apps/remit/src/FormPanel.tsx apps/remit/src/assets/ apps/remit/src/__tests__/ apps/remit/vitest.config.ts
git commit -m "feat(remit-app): copy Remit domain source + assets, port 3 tests (green)"
```

---

## Task 4: Wire `RemitApp.tsx` + real `main.tsx` (frontend runs in browser dev)

**Files:**
- Create: `apps/remit/src/RemitApp.tsx` (copy + rewire imports)
- Modify: `apps/remit/src/main.tsx` (replace placeholder with the real mount)

**Interfaces:**
- Consumes: everything from Tasks 2–3, plus `@tauri-apps/api/core` (invoke), `@tauri-apps/api/event` (listen), `@tauri-apps/plugin-dialog` (open) — all lazy-imported at call sites (unchanged from the shell).
- Produces: `export const RemitApp: React.FC<{ onExit: () => void }>` — the whole app UI. `main.tsx` mounts it with a no-op `onExit`.

- [ ] **Step 1: Copy + rewire `RemitApp.tsx`**

Copy `editor/apps-private/remit/RemitApp.tsx` to `apps/remit/src/RemitApp.tsx`. Change **only** its two shell imports (lines 2 and 5); leave everything else (all logic, the `project://opened` listener, all `invoke` calls, the `onExit`-typed export signature) byte-for-byte identical:

```ts
// FROM:
import { isTauri } from "../../runtime";
import { Plus, Trash2, Download, ArrowLeft } from "../../icons";
// TO:
import { isTauri } from "./runtime";
import { Plus, Trash2, Download, ArrowLeft } from "lucide-react";
```

Rationale: the shell's `editor/icons.ts` merely re-exports these 4 names from `lucide-react`, so importing them directly is the minimal decoupling (no `icons.ts` copy needed). `@/components/ui/{button,input}` imports stay as-is (alias resolves).

- [ ] **Step 2: Replace `main.tsx` with the real mount**

Overwrite `apps/remit/src/main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { RemitApp } from "./RemitApp";
import "./index.css";

// Standalone: Remit is the whole app. There's no shell to exit back to, so
// onExit is a no-op (the app is closed by closing its window).
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div className="h-screen w-screen bg-background text-foreground">
      <RemitApp onExit={() => {}} />
    </div>
  </React.StrictMode>,
);
```

- [ ] **Step 3: Typecheck**

Run:
```bash
cd apps/remit && npx tsc --noEmit
```
Expected: PASS. (If `tsc` flags `onExit` unused in `RemitApp` — it's destructured-but-unused in the shell too, where the signature is `({ onExit }) => {}` with `onExit` referenced nowhere; the shell export is `({ }: {...}) => ...`. Match the shell's exact export line so `noUnusedParameters` is satisfied — the shell writes `export const RemitApp: React.FC<{ onExit: () => void }> = () => {` i.e. it does NOT destructure `onExit`. Keep that form.)

- [ ] **Step 4: Verify it renders in browser dev**

Run (background it, then curl the dev server, then stop it):
```bash
cd apps/remit && npm run dev &
sleep 3
curl -sf http://localhost:5175/ | grep -q '<div id="root">' && echo "DEV OK"
kill %1
```
Expected: `DEV OK`. In browser dev `isTauri()` is false, so `SessionsList` shows an empty list (no backend yet) — that's the correct non-Tauri fallback and proves the SPA mounts without the shell.

- [ ] **Step 5: Commit**

```bash
cd /Users/parandykt/Apps/KineticType
git add -f apps/remit/src/RemitApp.tsx apps/remit/src/main.tsx
git commit -m "feat(remit-app): wire RemitApp + main.tsx; SPA mounts standalone in browser dev"
```

---

## Task 5: Scaffold the Rust crate — `paths.rs` with isolated dirs (unit-tested)

**Files:**
- Create: `apps/remit/src-tauri/Cargo.toml`
- Create: `apps/remit/src-tauri/build.rs`
- Create: `apps/remit/src-tauri/src/main.rs`
- Create: `apps/remit/src-tauri/src/paths.rs`

**Interfaces:**
- Produces: `paths::user_dir() -> PathBuf` (`~/.remit`), `paths::user_path(rel: &str) -> PathBuf`, `paths::projects_dir() -> PathBuf` (`~/Remit Projects`). Consumed by `remit.rs` + `skill.rs` in Tasks 6–8.

- [ ] **Step 1: Create `Cargo.toml`** (trimmed dep set)

```toml
[package]
name = "remit-app"
version = "0.1.0"
description = "Remit — standalone bank-transfer form filler"
authors = ["Altramanera"]
edition = "2021"
rust-version = "1.77.2"

[lib]
name = "remit_app_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2.6.1", features = [] }

[dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tauri = { version = "2.11.1", features = ["protocol-asset"] }
tauri-plugin-dialog = "2"
notify = "6"
notify-debouncer-mini = "0.4"
chrono = { version = "0.4", features = ["serde"] }
dirs = "5"
slug = "0.1"
trash = "5"

[dev-dependencies]
tempfile = "3"
```

Dropped vs shell (none of Remit's commands touch them): `log`, `tauri-plugin-shell` (Remit shells out via `std::process::Command` directly), `tauri-plugin-log`, `portable-pty`, `tokio`, `dashmap`, `uuid`, `hex`, `json-patch`, `once_cell`, `sha2`, `duckdb`.

- [ ] **Step 2: Create `build.rs`** (no cfg logic — this crate IS Remit)

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 3: Create `src/main.rs`**

```rust
// Prevents an extra console window on Windows in release. macOS-only for now,
// but harmless to keep.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    remit_app_lib::run()
}
```

- [ ] **Step 4: Write the failing test for `paths.rs`**

Create `apps/remit/src-tauri/src/paths.rs`:

```rust
//! Central user-level paths for standalone Remit.
//!
//! Fully isolated from the DreamStore shell: Remit owns `~/.remit/`
//! (recipients, recents, skills bundle) and `~/Remit Projects/` (the
//! project pool). There is NO migration from any legacy location — this
//! app is independent and starts clean.

use std::path::PathBuf;

pub fn user_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".remit"))
        .unwrap_or_else(|| PathBuf::from(".remit"))
}

pub fn user_path(rel: &str) -> PathBuf {
    user_dir().join(rel)
}

pub fn projects_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join("Remit Projects"))
        .unwrap_or_else(|| PathBuf::from("Remit Projects"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_path_is_under_dot_remit() {
        let p = user_path("remit-recipients.json");
        assert!(p.ends_with(".remit/remit-recipients.json"));
    }

    #[test]
    fn projects_dir_is_remit_projects() {
        assert!(projects_dir().ends_with("Remit Projects"));
    }
}
```

- [ ] **Step 5: Run the tests to verify they fail (crate doesn't build yet — no `lib.rs`)**

Run:
```bash
cd apps/remit/src-tauri && cargo test paths:: 2>&1 | tail -20
```
Expected: FAIL to compile — `lib.rs`/`run()` missing. This is expected; the next task adds `lib.rs`. (If you want a green checkpoint before Task 6, temporarily add a stub `src/lib.rs` with `pub fn run() {}` and re-run — the two `paths::` tests then PASS. The stub is replaced in Task 8.)

- [ ] **Step 6: Add a temporary `lib.rs` stub so the crate compiles + paths tests pass**

Create `apps/remit/src-tauri/src/lib.rs` (temporary — replaced in Task 8):

```rust
mod paths;

pub fn run() {}
```

Run:
```bash
cd apps/remit/src-tauri && cargo test paths::
```
Expected: PASS (2 tests). A `warning: function \`run\` is never used`-style warning is fine.

- [ ] **Step 7: Commit**

```bash
cd /Users/parandykt/Apps/KineticType
git add -f apps/remit/src-tauri/Cargo.toml apps/remit/src-tauri/build.rs apps/remit/src-tauri/src/main.rs apps/remit/src-tauri/src/paths.rs apps/remit/src-tauri/src/lib.rs
git commit -m "feat(remit-app): scaffold Rust crate + isolated paths.rs (~/.remit, ~/Remit Projects)"
```

---

## Task 6: Port `watch.rs` + `skill.rs` (trimmed support modules)

**Files:**
- Create: `apps/remit/src-tauri/src/watch.rs`
- Create: `apps/remit/src-tauri/src/skill.rs`
- Create: `apps/remit/src-tauri/templates/seed-remit.json`
- Create: `apps/remit/src-tauri/skills/remit/SKILL.md`

**Interfaces:**
- Produces: `watch::DocWatcher` type, `watch::spawn(path: PathBuf, app: AppHandle) -> Result<DocWatcher, String>`; `skill::SkillBundle` struct, `skill::REMIT_BUNDLE: SkillBundle` const, `skill::write(project_path: &Path, bundle: &SkillBundle) -> std::io::Result<()>`. Consumed by `remit.rs` in Task 7 and `lib.rs` in Task 8.

- [ ] **Step 1: Copy `watch.rs` verbatim**

Copy `/Users/parandykt/Apps/KineticType/src-tauri/src/watch.rs` to `apps/remit/src-tauri/src/watch.rs` unchanged. It has no `crate::` deps beyond `notify`/`notify-debouncer-mini`/`tauri` (all in Cargo.toml). It emits `doc://changed` + legacy `story://changed`; keep both (harmless, and the frontend only relies on the app re-reading on change).

- [ ] **Step 2: Copy the seed template + skill markdown**

```bash
cp src-tauri/templates-private/seed-remit.json apps/remit/src-tauri/templates/seed-remit.json
cp src-tauri/skills-private/remit/SKILL.md apps/remit/src-tauri/skills/remit/SKILL.md
```

- [ ] **Step 3: Create trimmed `skill.rs`**

This is the shell's `skill.rs` collapsed to Remit's single bundle, with the bundle content inlined from `remit_skill.rs`, and the legacy `.kinetic-studio/skill.md` + `rc.zsh` step **dropped** (no `rc.zsh` dependency). Create `apps/remit/src-tauri/src/skill.rs`:

```rust
//! Per-project agent skill installer for standalone Remit.
//!
//! Materialises Remit's SKILL.md into a shared per-user bundle
//! (`~/.remit/skills-bundle/remit/`), symlinks it into the project's
//! `.claude/skills/remit/`, and writes the project-root `CLAUDE.md` that
//! points the agent at it. The symlink means a Remit update propagates to
//! every existing project on next open without rewriting per-project files.

use std::fs;
use std::path::{Path, PathBuf};

const SKILL_ROUTING: &str = include_str!("../skills/remit/SKILL.md");

const CLAUDE_MD: &str = r#"# Remit project

You are inside a Remit project — a bank-transfer form filler for the Maybank
remittance form. **The agent operating manual is at
`.claude/skills/remit/SKILL.md`** — read it first.

Short version:

- Edit `./remit.json` to set the per-transfer values (recipient, bank, amount,
  payment details, date). The fixed sender (Design Drives Growth Inc.) is baked
  into the app — you don't set it here.
- `senderAccount` is "MYR" or "USD" (which of the two sender accounts to debit).
- `amount.currency` "MYR" fills the "In RM" slot; anything else fills the
  "In Foreign Currency" slot. Only one is used.
- The user exports a filled page-1 PDF from the form panel; you just author the
  values in `remit.json`. Read it before editing so you build on the user's edits.
"#;

/// What Remit ships as its agent skill bundle.
pub struct SkillBundle {
    /// (relative path, file contents) pairs. SKILL.md is first by convention.
    pub files: &'static [(&'static str, &'static str)],
    /// Per-project CLAUDE.md content pointing at the bundle.
    pub claude_md: &'static str,
}

pub const REMIT_BUNDLE: SkillBundle = SkillBundle {
    files: &[("SKILL.md", SKILL_ROUTING)],
    claude_md: CLAUDE_MD,
};

fn bundle_root() -> PathBuf {
    crate::paths::user_path("skills-bundle/remit")
}

fn materialise_bundle(bundle: &SkillBundle) -> std::io::Result<PathBuf> {
    let root = bundle_root();
    fs::create_dir_all(&root)?;
    for (rel_path, contents) in bundle.files {
        fs::write(root.join(rel_path), contents)?;
    }
    Ok(root)
}

#[cfg(unix)]
fn ensure_symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    if link.exists() || link.symlink_metadata().is_ok() {
        if link.is_dir()
            && fs::symlink_metadata(link)
                .map(|m| !m.file_type().is_symlink())
                .unwrap_or(false)
        {
            fs::remove_dir_all(link)?;
        } else {
            fs::remove_file(link).or_else(|_| fs::remove_dir_all(link))?;
        }
    }
    if let Some(parent) = link.parent() {
        fs::create_dir_all(parent)?;
    }
    std::os::unix::fs::symlink(target, link)
}

#[cfg(not(unix))]
fn ensure_symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    if let Some(parent) = link.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::create_dir_all(link)?;
    for entry in fs::read_dir(target)? {
        let entry = entry?;
        fs::copy(entry.path(), link.join(entry.file_name()))?;
    }
    Ok(())
}

/// Install the skill bundle for `project_path`: shared bundle + project symlink
/// + project-root CLAUDE.md.
pub fn write(project_path: &Path, bundle: &SkillBundle) -> std::io::Result<()> {
    let bundle_dir = materialise_bundle(bundle)?;
    let skill_link = project_path.join(".claude").join("skills").join("remit");
    ensure_symlink(&bundle_dir, &skill_link)?;
    fs::write(project_path.join("CLAUDE.md"), bundle.claude_md)?;
    Ok(())
}
```

- [ ] **Step 4: Add `mod watch; mod skill;` to the temporary `lib.rs` and compile**

Edit `apps/remit/src-tauri/src/lib.rs` (still the stub) to declare the new modules so they compile:

```rust
mod paths;
mod skill;
mod watch;

pub fn run() {}
```

Run:
```bash
cd apps/remit/src-tauri && cargo build 2>&1 | tail -20
```
Expected: compiles (warnings about unused `watch::spawn` / `skill::write` / `REMIT_BUNDLE` are fine — Task 7/8 use them). If `include_str!("../skills/remit/SKILL.md")` errors, the file path in Step 2 is wrong — fix and rebuild.

- [ ] **Step 5: Commit**

```bash
cd /Users/parandykt/Apps/KineticType
git add -f apps/remit/src-tauri/src/watch.rs apps/remit/src-tauri/src/skill.rs apps/remit/src-tauri/templates/seed-remit.json apps/remit/src-tauri/skills/remit/SKILL.md apps/remit/src-tauri/src/lib.rs
git commit -m "feat(remit-app): port watch.rs + trimmed skill.rs + seed/skill assets"
```

---

## Task 7: Write `remit.rs` — all commands, collapsed single-canvas (unit-tested)

**Files:**
- Create: `apps/remit/src-tauri/src/remit.rs`

**Interfaces:**
- Consumes: `paths::{projects_dir,user_path}`, `watch::{spawn,DocWatcher}`, `skill::{write,REMIT_BUNDLE}`, and `AppState`/`ActiveProject` (defined here, re-exported by `lib.rs` in Task 8).
- Produces the `#[tauri::command]` fns: `projects_list`, `projects_create`, `project_open`, `project_close`, `project_delete`, `load_doc`, `save_doc`, `remit_export`, `remit_recipients_load`, `remit_recipients_save`, `remit_duplicate`; plus `pub struct AppState { active_project: Mutex<Option<ActiveProject>> }` and `pub struct ActiveProject { path: PathBuf, _watcher: watch::DocWatcher }`, and `pub struct ProjectMeta { name: String, path: String, last_opened: String }` (`#[serde(rename_all = "camelCase")]`).

Design decisions folded in (from the design spec §2 + the aggressive-trim decision):
- The `Canvas` trait/registry is **gone**. `remit.json` is a hardcoded const `DOC_FILENAME`. Seeds come from `include_bytes!("../templates/seed-remit.json")`.
- `ProjectMeta` drops `beats`, `preview_path`, `preview_stale` (all inert for Remit). So `preview_meta` and `summarise` are gone. **The frontend `ProjectMeta` type already only reads `name`/`path`/`lastOpened`** (see `RemitApp.tsx:22` — `{ name; path; lastOpened? }`), so no frontend change is needed.
- `project_open` keeps the load-bearing chain: watcher spawn, skill write, recents record, `AppState` store, `project://opened` emit. It **drops** `prompt_mode::ensure_seeded` (kinetic concept; Remit frontend never calls prompt-mode commands).
- `project_close` clears state + emits `project://closed`. It **drops** `preview::spawn_render` (Remotion render — meaningless for Remit).
- `project_delete` uses `trash::delete` (frontend calls it).

- [ ] **Step 1: Write `remit.rs` with the commands + inline unit tests**

Create `apps/remit/src-tauri/src/remit.rs`:

```rust
//! Remit's backend: project lifecycle + document read/write + recipients +
//! PDF export. Standalone single-app crate — no canvas registry; the document
//! is always `remit.json`.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::skill;
use crate::watch;

/// The one document filename for a Remit project.
const DOC_FILENAME: &str = "remit.json";
/// Seed written into a brand-new project's remit.json.
const SEED_REMIT: &[u8] = include_bytes!("../templates/seed-remit.json");

// ---- shared runtime state --------------------------------------------------

pub struct ActiveProject {
    pub path: PathBuf,
    pub _watcher: watch::DocWatcher,
}

pub struct AppState {
    pub active_project: Mutex<Option<ActiveProject>>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub name: String,
    pub path: String,
    pub last_opened: String,
}

// ---- store helpers ---------------------------------------------------------

fn recents_path() -> PathBuf {
    crate::paths::user_path("recents.json")
}

fn read_recents() -> HashMap<String, String> {
    fs::read_to_string(recents_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_recents(map: &HashMap<String, String>) {
    if let Some(parent) = recents_path().parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(map) {
        let _ = fs::write(recents_path(), json);
    }
}

fn recipients_path() -> PathBuf {
    crate::paths::user_path("remit-recipients.json")
}

fn active_path(state: &AppState) -> Result<PathBuf, String> {
    state
        .active_project
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|p| p.path.clone())
        .ok_or_else(|| "no active project".into())
}

// ---- project lifecycle -----------------------------------------------------

#[tauri::command]
pub fn projects_list(canvas: Option<String>) -> Result<Vec<ProjectMeta>, String> {
    // `canvas` is accepted for frontend compatibility (RemitApp passes
    // { canvas: "remit" }) but every project here is a Remit project, so the
    // only filter is "does the folder contain remit.json".
    let _ = canvas;
    let home = crate::paths::projects_dir();
    fs::create_dir_all(&home).map_err(|e| format!("mkdir home: {}", e))?;

    let recents = read_recents();
    let mut out: Vec<ProjectMeta> = vec![];

    for entry in fs::read_dir(&home).map_err(|e| format!("readdir: {}", e))? {
        let entry = entry.map_err(|e| format!("entry: {}", e))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if !path.join(DOC_FILENAME).exists() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown")
            .to_string();
        let path_str = path.to_string_lossy().to_string();
        let last_opened = recents.get(&path_str).cloned().unwrap_or_else(|| {
            fs::metadata(&path)
                .ok()
                .and_then(|m| m.modified().ok())
                .map(|t| chrono::DateTime::<Utc>::from(t).to_rfc3339())
                .unwrap_or_else(|| Utc::now().to_rfc3339())
        });
        out.push(ProjectMeta { name, path: path_str, last_opened });
    }
    out.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    Ok(out)
}

/// Create + seed a new Remit project folder. Shared by `projects_create` and
/// `remit_duplicate`.
fn create_project_dir(name: &str) -> Result<ProjectMeta, String> {
    let home = crate::paths::projects_dir();
    fs::create_dir_all(&home).map_err(|e| format!("mkdir home: {}", e))?;

    let base_slug = slug::slugify(if name.trim().is_empty() { "untitled" } else { name });
    let mut dir = home.join(&base_slug);
    let mut n = 2;
    while dir.exists() {
        dir = home.join(format!("{}-{}", base_slug, n));
        n += 1;
    }
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir project: {}", e))?;
    fs::write(dir.join(DOC_FILENAME), SEED_REMIT).map_err(|e| format!("write doc: {}", e))?;
    skill::write(&dir, &skill::REMIT_BUNDLE).map_err(|e| format!("write skill: {}", e))?;

    let display_name = if name.trim().is_empty() { "Untitled".into() } else { name.to_string() };
    Ok(ProjectMeta {
        name: display_name,
        path: dir.to_string_lossy().to_string(),
        last_opened: Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub fn projects_create(name: String, canvas: Option<String>) -> Result<ProjectMeta, String> {
    let _ = canvas; // always Remit
    create_project_dir(&name)
}

#[tauri::command]
pub fn project_open(
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ProjectMeta, String> {
    let path_buf = PathBuf::from(&path);
    let doc = path_buf.join(DOC_FILENAME);
    if !doc.exists() {
        return Err(format!("no {} in folder", DOC_FILENAME));
    }
    fs::read_to_string(&doc).map_err(|e| format!("read doc: {}", e))?;

    let watcher = watch::spawn(doc.clone(), app.clone()).map_err(|e| format!("watcher: {}", e))?;
    skill::write(&path_buf, &skill::REMIT_BUNDLE).map_err(|e| format!("write skill: {}", e))?;

    *state.active_project.lock().unwrap() =
        Some(ActiveProject { path: path_buf.clone(), _watcher: watcher });

    let path_str = path_buf.to_string_lossy().to_string();
    let mut recents = read_recents();
    let now = Utc::now().to_rfc3339();
    recents.insert(path_str.clone(), now.clone());
    write_recents(&recents);

    let name = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();
    let meta = ProjectMeta { name, path: path_str, last_opened: now };
    let _ = app.emit::<ProjectMeta>("project://opened", meta.clone());
    Ok(meta)
}

#[tauri::command]
pub fn project_close(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    *state.active_project.lock().unwrap() = None;
    let _ = app.emit::<()>("project://closed", ());
    Ok(())
}

#[tauri::command]
pub fn project_delete(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| format!("trash: {}", e))
}

// ---- document read/write ---------------------------------------------------

fn doc_path(state: &AppState) -> Result<PathBuf, String> {
    Ok(active_path(state)?.join(DOC_FILENAME))
}

#[tauri::command]
pub fn load_doc(state: State<'_, AppState>) -> Result<String, String> {
    fs::read_to_string(doc_path(&state)?).map_err(|e| format!("read: {}", e))
}

#[tauri::command]
pub fn save_doc(json: String, state: State<'_, AppState>) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| format!("invalid doc json: {}", e))?;
    let target = doc_path(&state)?;
    let tmp = target.with_extension("json.tmp");
    let body = if json.ends_with('\n') { json } else { format!("{}\n", json) };
    fs::write(&tmp, body.as_bytes()).map_err(|e| format!("write tmp: {}", e))?;
    fs::rename(&tmp, &target).map_err(|e| format!("rename: {}", e))?;
    Ok(())
}

/// Write filled-PDF bytes to `dir/filename` (basename-sanitised), reveal in
/// Finder, return the absolute path. `dir` comes from the frontend folder
/// picker.
#[tauri::command]
pub fn remit_export(dir: String, filename: String, bytes: Vec<u8>) -> Result<String, String> {
    let name = Path::new(&filename)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "invalid filename".to_string())?;
    let dir_path = Path::new(&dir);
    if !dir_path.is_dir() {
        return Err(format!("not a directory: {}", dir));
    }
    let target = dir_path.join(name);
    let tmp = target.with_extension("pdf.tmp");
    fs::write(&tmp, &bytes).map_err(|e| format!("write tmp: {}", e))?;
    fs::rename(&tmp, &target).map_err(|e| format!("rename: {}", e))?;
    let _ = std::process::Command::new("open").arg("-R").arg(&target).spawn();
    Ok(target.to_string_lossy().into_owned())
}

// ---- recipients + duplicate ------------------------------------------------

#[tauri::command]
pub fn remit_recipients_load() -> Result<String, String> {
    match fs::read_to_string(recipients_path()) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("[]".to_string()),
        Err(e) => Err(format!("read recipients: {}", e)),
    }
}

#[tauri::command]
pub fn remit_recipients_save(json: String) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| format!("invalid recipients json: {}", e))?;
    if !value.is_array() {
        return Err("recipients must be a JSON array".to_string());
    }
    let p = recipients_path();
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {}", e))?;
    }
    let body = if json.ends_with('\n') { json } else { format!("{}\n", json) };
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, body.as_bytes()).map_err(|e| format!("write tmp: {}", e))?;
    fs::rename(&tmp, &p).map_err(|e| format!("rename: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn remit_duplicate(source_path: String, name: String) -> Result<ProjectMeta, String> {
    let source = PathBuf::from(&source_path);
    let doc_bytes = fs::read(source.join(DOC_FILENAME)).map_err(|e| format!("read source doc: {}", e))?;
    let meta = create_project_dir(&name)?;
    let target_doc = PathBuf::from(&meta.path).join(DOC_FILENAME);
    let body = if doc_bytes.ends_with(b"\n") {
        doc_bytes
    } else {
        let mut b = doc_bytes;
        b.push(b'\n');
        b
    };
    let tmp = target_doc.with_extension("json.tmp");
    fs::write(&tmp, &body).map_err(|e| format!("write tmp: {}", e))?;
    fs::rename(&tmp, &target_doc).map_err(|e| format!("rename: {}", e))?;
    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // These test the file-level helpers directly (not the #[tauri::command]
    // wrappers, which need a running app). They exercise the paths that matter:
    // seeding, save/load round-trip, recipients round-trip, export.

    fn new_project(home: &Path, name: &str) -> PathBuf {
        let dir = home.join(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(DOC_FILENAME), SEED_REMIT).unwrap();
        dir
    }

    #[test]
    fn seed_is_valid_json_with_expected_shape() {
        let v: serde_json::Value = serde_json::from_slice(SEED_REMIT).unwrap();
        assert!(v.get("recipient").is_some(), "seed has a recipient block");
        assert!(v.get("amount").is_some(), "seed has an amount block");
    }

    #[test]
    fn save_then_load_round_trips() {
        let home = TempDir::new().unwrap();
        let proj = new_project(home.path(), "t1");
        let doc = proj.join(DOC_FILENAME);
        let payload = r#"{"recipient":{"name":"Acme"}}"#;
        // Emulate save_doc's atomic write.
        let tmp = doc.with_extension("json.tmp");
        fs::write(&tmp, format!("{}\n", payload)).unwrap();
        fs::rename(&tmp, &doc).unwrap();
        let loaded = fs::read_to_string(&doc).unwrap();
        let v: serde_json::Value = serde_json::from_str(&loaded).unwrap();
        assert_eq!(v["recipient"]["name"], "Acme");
    }

    #[test]
    fn remit_export_writes_a_file_and_rejects_traversal() {
        let dir = TempDir::new().unwrap();
        // basename-sanitise: a traversal filename lands inside dir, not above it.
        let out = remit_export(
            dir.path().to_string_lossy().into_owned(),
            "../escape.pdf".to_string(),
            b"%PDF-1.4 test".to_vec(),
        )
        .unwrap();
        let out_path = PathBuf::from(&out);
        assert_eq!(out_path.file_name().unwrap(), "escape.pdf");
        assert_eq!(out_path.parent().unwrap(), dir.path());
        assert!(out_path.exists());
    }

    #[test]
    fn remit_export_errors_on_missing_dir() {
        let missing = "/definitely/not/a/real/dir/xyz";
        let r = remit_export(missing.to_string(), "a.pdf".to_string(), vec![1, 2, 3]);
        assert!(r.is_err());
    }
}
```

- [ ] **Step 2: Declare `mod remit;` in the temporary `lib.rs` and run the tests**

Edit `apps/remit/src-tauri/src/lib.rs`:

```rust
mod paths;
mod remit;
mod skill;
mod watch;

pub fn run() {}
```

Run:
```bash
cd apps/remit/src-tauri && cargo test 2>&1 | tail -25
```
Expected: PASS — the 2 `paths::` tests + the 4 `remit::tests` (`seed_is_valid_json...`, `save_then_load...`, `remit_export_writes...`, `remit_export_errors...`). Unused-warning noise about the command fns is fine (Task 8 registers them).

- [ ] **Step 3: Commit**

```bash
cd /Users/parandykt/Apps/KineticType
git add -f apps/remit/src-tauri/src/remit.rs apps/remit/src-tauri/src/lib.rs
git commit -m "feat(remit-app): remit.rs — all commands, single-canvas collapse, unit tests green"
```

---

## Task 8: Real `lib.rs` (Tauri builder + handler) and `tauri.conf.json` — app builds

**Files:**
- Modify: `apps/remit/src-tauri/src/lib.rs` (replace stub with the real builder)
- Create: `apps/remit/src-tauri/tauri.conf.json`
- Create: `apps/remit/src-tauri/icons/` (icon set — see Step 3)

**Interfaces:**
- Consumes: all of `remit.rs` (commands + `AppState`), `paths`, `skill`, `watch`.
- Produces: a runnable Tauri app (`run()`), and a `tauri:build` that emits `Remit.app`.

- [ ] **Step 1: Replace `lib.rs` with the real builder**

Overwrite `apps/remit/src-tauri/src/lib.rs`:

```rust
//! Tauri 2 entry for standalone Remit: app state + command registration.

mod paths;
mod remit;
mod skill;
mod watch;

use std::sync::Mutex;

use remit::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState { active_project: Mutex::new(None) };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            remit::projects_list,
            remit::projects_create,
            remit::project_open,
            remit::project_close,
            remit::project_delete,
            remit::load_doc,
            remit::save_doc,
            remit::remit_export,
            remit::remit_recipients_load,
            remit::remit_recipients_save,
            remit::remit_duplicate,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 2: Overwrite `tauri.conf.json` with the full config**

Note: Task 5 already created a minimal `tauri.conf.json` (required for `tauri_build::build()` to compile the crate). **Overwrite** it with the full config below — this adds the `bundle` block (targets + icons) that packaging needs, and keeps the `assetProtocol` scope Task 5 added:

```json
{
  "$schema": "../node_modules/@tauri-apps/cli/config.schema.json",
  "productName": "Remit",
  "version": "0.1.0",
  "identifier": "app.altramanera.remit",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5175",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "windows": [
      {
        "title": "Remit",
        "width": 1000,
        "height": 720,
        "resizable": true,
        "fullscreen": false,
        "titleBarStyle": "Overlay",
        "hiddenTitle": true
      }
    ],
    "security": {
      "csp": null,
      "assetProtocol": {
        "enable": true,
        "scope": ["$HOME/Remit Projects/**"]
      }
    }
  },
  "bundle": {
    "active": true,
    "targets": ["app", "dmg"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

- [ ] **Step 3: Generate an icon set**

Tauri requires the icons listed above. Generate them from the shell's existing icon (fastest, valid placeholder — real Remit branding is out of scope):

```bash
cd apps/remit/src-tauri
npx @tauri-apps/cli icon ../../../src-tauri/icons/icon.icns 2>/dev/null || npx @tauri-apps/cli icon ../../../src-tauri/icons/128x128@2x.png
```
Expected: creates `apps/remit/src-tauri/icons/` with `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`, etc. (If the source path differs, point `tauri icon` at any square PNG ≥ 512px in `src-tauri/icons/`.)

- [ ] **Step 4: Verify the Rust app compiles as a Tauri app**

Run:
```bash
cd apps/remit/src-tauri && cargo build 2>&1 | tail -20
```
Expected: compiles cleanly (the `generate_context!` macro now finds `tauri.conf.json` + icons). No unused-command warnings anymore (all 11 are registered).

- [ ] **Step 5: Commit**

```bash
cd /Users/parandykt/Apps/KineticType
git add -f apps/remit/src-tauri/src/lib.rs apps/remit/src-tauri/tauri.conf.json apps/remit/src-tauri/icons/ apps/remit/src-tauri/Cargo.lock
git commit -m "feat(remit-app): real lib.rs Tauri builder + tauri.conf.json + icons; app compiles"
```

---

## Task 9: End-to-end verification — `tauri:dev`, real flows, `.app` build + packaging

**Files:**
- Create: `apps/remit/scripts/install-local.sh` (packaging convenience script)

**Interfaces:** none (verification task).

This task follows superpowers:verification-before-completion — every claim below is backed by a command whose output you must observe.

- [ ] **Step 1: Launch the app in dev and confirm it runs standalone**

Run (in the background; it opens a native window):
```bash
cd apps/remit && npm run tauri:dev
```
Watch the terminal for the window to open (Vite on 5175 + the Rust app building). This is the core proof: **Remit runs in its own window with no shell present.**

- [ ] **Step 2: Manually exercise the real flows in the running app**

In the Remit window:
1. Create a new transfer ("New transfer" → a name) → it opens the form + live PDF preview.
2. Fill several fields (recipient name, bank, amount) → the preview updates live.
3. Click "Export PDF" → pick a folder → confirm a PDF is written and Finder reveals it. Open the PDF; confirm the fields are filled on the Maybank template.
4. Save a recipient, go Back, create another transfer, and pick the saved recipient → confirm it fills the recipient/bank fields.
5. Confirm the new project + recipient landed in the isolated dirs:
```bash
ls "$HOME/Remit Projects/" && echo "---" && cat "$HOME/.remit/remit-recipients.json" 2>/dev/null | head
```
Expected: the project folder(s) exist under `~/Remit Projects/`, each with a `remit.json` + `.claude/skills/remit/` symlink + `CLAUDE.md`; recipients file exists under `~/.remit/`.

- [ ] **Step 3: Stop dev and run the release build**

Stop the dev app (close the window / Ctrl-C). Then:
```bash
cd apps/remit && npm run tauri:build 2>&1 | tail -30
```
Expected: build succeeds; note the emitted path, e.g. `apps/remit/src-tauri/target/release/bundle/macos/Remit.app`. Verify:
```bash
ls -d apps/remit/src-tauri/target/release/bundle/macos/Remit.app && echo "APP BUILT"
```

- [ ] **Step 4: Create the packaging script**

Create `apps/remit/scripts/install-local.sh`:

```bash
#!/usr/bin/env bash
# Copy the built Remit.app into the DreamStore install root so it's launchable
# standalone (double-click) from the same place the store installs apps.
# Run after `npm run tauri:build`.
set -euo pipefail

APP="src-tauri/target/release/bundle/macos/Remit.app"
DEST_DIR="$HOME/Applications/DreamStore"

if [ ! -d "$APP" ]; then
  echo "Remit.app not found at $APP — run 'npm run tauri:build' first." >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
rm -rf "$DEST_DIR/Remit.app"
cp -R "$APP" "$DEST_DIR/Remit.app"
echo "Installed → $DEST_DIR/Remit.app"
```

Make it executable:
```bash
chmod +x apps/remit/scripts/install-local.sh
```

- [ ] **Step 5: Package and launch the built `.app` with no dev server / shell present**

Run:
```bash
cd apps/remit && ./scripts/install-local.sh
open "$HOME/Applications/DreamStore/Remit.app"
```
Expected: the installed `Remit.app` launches in its own window (first launch may need right-click → Open past Gatekeeper — that's the documented unsigned-app behavior). Repeat a quick smoke of Step 2's create + export in the packaged app to confirm it works with **no Vite dev server and no DreamStore shell running**. This is the DS2′-A deliverable proven.

- [ ] **Step 6: Confirm the shell is untouched and still green**

```bash
cd /Users/parandykt/Apps/KineticType
git status --porcelain    # expect: nothing under editor/ or src-tauri/ changed
npm run test 2>&1 | tail -5
npx tsc --noEmit -p . 2>&1 | tail -5 || true
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```
Expected: `git status` shows no modifications to shell files (only the ignored `apps/` tree, plus the earlier `.gitignore` edit already committed); shell tests pass; shell `cargo check` passes. (Shell wasn't touched, so this is a regression guard, not new work.)

- [ ] **Step 7: Commit the packaging script**

```bash
cd /Users/parandykt/Apps/KineticType
git add -f apps/remit/scripts/install-local.sh
git commit -m "feat(remit-app): local install script; DS2′-A standalone Remit.app verified end-to-end"
```

---

## Self-Review

**Spec coverage** (design doc §1–§5):
- §1 Structure → Tasks 1–8 create the `apps/remit/` layout (git-ignored via Task 1). ✔ (Deviation: backend collapsed into one `remit.rs` + `watch.rs`/`skill.rs` rather than the spec's file-per-concern, because the multi-canvas split is dead weight standalone — noted in the File Structure design note.)
- §2 Backend / trimmed commands → Task 7. ✔ **Corrected spec gaps:** added `project_delete` (+`trash`) and `project_close` (both frontend-called, omitted from the spec's handler list); added `slug` dep. `remit_export` correctly placed (spec said `doc.rs`; it lives there in the shell — here consolidated into `remit.rs`).
- §2 support chain (watch/skill/prompt_mode/AppState/preview_meta) → Task 6–7. ✔ **Decision:** kept watcher + skill (load-bearing); dropped prompt_mode, preview_meta/preview render, and the inert `ProjectMeta` fields (aggressive-trim decision). `AppState` reduced to `active_project` only.
- §2 data dirs → **overridden by user to isolated `~/.remit` + `~/Remit Projects`, no migration** (Global Constraints + Task 5). This is the one deliberate divergence from the spec's "shared state" premise, per explicit user direction.
- §3 Frontend decoupling (10 shell imports) → Tasks 2–4. ✔ All 10 resolved: 5 UI comps + `runtime` copied; `icons` → direct `lucide-react`; `canvas`/`selection`/`platform/apps` dropped (index.tsx/app.tsx not copied); `@/lib/utils` copied.
- §4 Build/packaging/error-handling/testing → Tasks 1, 3, 8, 9. ✔ Missing-pool returns `[]` (Task 7 `projects_list` does `create_dir_all` first); export guards preserved; 3 frontend tests ported; Rust smoke tests added; standalone-run + `.app` build verified.
- §5 Risks → duplication-drift noted (Global Constraints "point-in-time fork"); UI-copy fidelity → Task 2 Step 4 + Task 9 Step 2 visual check; shared-pool concurrency → **neutralized** by the isolated-dirs decision; signing → documented Gatekeeper behavior (Task 9 Step 5); secrets-in-history → `apps/` git-ignored (Task 1).

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N" — every code step contains full content; every command has expected output.

**Type consistency:** `ProjectMeta { name, path, lastOpened }` matches the frontend's inline type at `RemitApp.tsx:22`. `AppState`/`ActiveProject` defined in `remit.rs`, imported by `lib.rs`. `skill::REMIT_BUNDLE` + `skill::write` + `watch::spawn`/`watch::DocWatcher` names consistent across Tasks 6–8. Command names in the Task 8 handler exactly match the `#[tauri::command]` fns in Task 7 and the frontend `invoke("...")` call sites.
