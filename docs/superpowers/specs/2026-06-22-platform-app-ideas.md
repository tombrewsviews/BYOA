# KineticType platform — app ideas (local-engine + agent + canvas)

**Date:** 2026-06-22
**Context:** Brainstorm on which open-source tools could become new platform apps
following the KineticType pattern, exploiting Tauri's ability to host engines
and small models locally.

## The pattern (the filter every candidate must pass)

A platform app belongs here only if it has all three:

1. **A live canvas/stage** — a structured domain artifact the user directly
   manipulates and sees change in real time.
2. **An embedded agent** (terminal + chat) with **MCP/tool access to that same
   artifact** — it can both perceive and act, not just generate once.
3. **A properties/inspector panel** — fine control the agent also reads, so
   human and agent edit the same state.

BYOA insight: the agent is a *co-operator on a shared, inspectable document*,
not a bolted-on chatbot. Best candidates: **(a)** a structured local artifact,
**(b)** a local engine/model that transforms it fast, **(c)** an agent that
genuinely collaborates. Tauri unlock: host a real DSP engine / CAD kernel /
database / small model locally — no cloud round-trip, full file access.

Existing apps: Kinetic (typography), Pulse (music visualizer), Brainstorm
Canvas (Excalidraw board).

## Tier 1 — strongest fit (canvas + local engine + agent co-op)

### 1. Audio/Music production — generative DAW-lite
- **Engine (local):** SuperCollider (scsynth), Sonic Pi runtime, or Rust DSP
  (FunDSP). Tauri hosts the audio server.
- **Canvas:** node/clip timeline. **Agent:** writes/edits synthdefs + patterns;
  user scrubs knobs (panel); agent hears analysis and adjusts.
- Sibling to Pulse but *generative* (composes) rather than reactive.
- Fit: artifact = patterns/synthdefs as text; real-time local engine; true
  co-authoring.

### 2. Parametric CAD — "describe the part, tweak the dimensions"
- **Engine (local):** CadQuery / OpenSCAD / Build123d (scriptable, headless
  render). Canvas = three.js viewport.
- **Agent:** writes parametric code; **panel** exposes parameters as sliders;
  re-renders on change.
- Makes the "Voxel" coming-soon card real and *precise*.
- Fit: the model IS code (ideal for an agent); parameters are an inspector;
  local kernel renders instantly.

### 3. Data exploration — local DuckDB notebook  ← CHOSEN, see plan below
- **Engine (local):** DuckDB embedded (in-process, fast on local files/Parquet).
- **Canvas:** live result grid + chart (Observable Plot / Vega-Lite).
  **Agent:** writes SQL/transforms; user edits viz spec in panel; agent sees
  result shape and iterates. Continuous mode = agent watches results, suggests
  next cut.
- Fit: artifact = SQL + viz spec; instant local engine; agent is a strong data
  analyst. Cheapest Tier-1 to build (no GPU/model hosting).

### 4. Image editing — local diffusion + layer canvas
- **Engine (local, small model):** ComfyUI (headless API), stable-diffusion.cpp,
  or mflux/MLX on Apple silicon. Tauri hosts it.
- **Canvas:** layered/masked editor. **Agent:** drives inpaint/outpaint/
  regenerate by region; panel = denoise, mask, per-layer prompt.
- Strongest showcase of "small models hosted locally"; agent-as-collaborator
  ("make the sky moodier there") is natural.

### 5. Diagramming / systems design — tldraw + local reasoning
- Sibling to Brainstorm, but *structured*: ER diagrams, state machines,
  architecture. tldraw has a computed-shapes API.
- **Agent:** keeps diagram and a generated artifact in sync (diagram ↔ SQL
  schema, ↔ Mermaid, ↔ infra code).

### 6. Local transcription / media studio
- **Engine (local):** whisper.cpp + ffmpeg (yt-dlp/ffmpeg already bundled).
  The `watch` plugin is the agent-side capability.
- **Canvas:** clip timeline + transcript. **Agent:** cuts/captions/reorders by
  editing an edit-decision-list; user nudges cut points in panel.

## Tier 2 — fit the pattern, narrower audience

- **GIS/maps** — local tile server + MapLibre canvas; agent geocodes/draws layers.
- **Shader playground** — WGSL canvas (Pulse already has GPU shaders); agent
  writes shaders, panel exposes uniforms.
- **Spreadsheet/model** — local formula engine (HyperFormula); agent builds the
  model, user tweaks cells.
- **Vector/logo design** — paper.js canvas (already a dep) + Recraft pattern;
  agent manipulates SVG paths.

## Recommendation rationale

- **#3 DuckDB** — cheapest to build (embedded engine, no model/GPU), proves a
  non-visual domain, agent is genuinely strong at SQL+viz. **Chosen.**
- **#2 CAD** — makes Voxel real; artifact-is-code maps perfectly to an agent.
- **#4 Image editing** — best "local model" showcase if that's the priority.

---

# Implementation plan — DuckDB Data Explorer

## Goal

A platform app where the user loads local data files (CSV / Parquet / JSON),
explores them through a live SQL + chart canvas, and an embedded agent
co-operates: writes/refines SQL, suggests cuts, and reads the user's edits.
DuckDB runs **in-process in the Tauri Rust backend** — no server, no cloud.

## How it reuses the substrate (same seams as Pulse/Brainstorm)

- **App manifest** in `editor/platform/apps.ts` (id `data`, category `data`).
- **Canvas plugin** registered in `resolveCanvas("data")`; like Pulse it owns
  its own layout via an app Root (`DataApp`) rather than the kinetic
  `EditorView`. Plugin doc methods are mostly real here (the doc IS persisted).
- **Canvas detection** in `src-tauri/src/canvas.rs::for_project`: a seed marker
  `query.json` → data canvas (extends story.json/project.json/board.json chain).
- **Agent panel** reuses `Chat` + Terminal verbatim, `cwd = project.path`.
- **Skill bundle** (`src-tauri/skills/data/SKILL.md`) teaches the agent the
  domain + how to drive the local DuckDB tools.

## The artifact (the shared, inspectable document)

`query.json` per project — the "local db" of the exploration session:

```jsonc
{
  "sources": [ { "id": "sales", "path": "data/sales.csv", "kind": "csv" } ],
  "cells": [
    {
      "id": "c1",
      "sql": "SELECT region, SUM(amount) AS total FROM sales GROUP BY 1",
      "viz": { "type": "bar", "x": "region", "y": "total" },
      "title": "Revenue by region"
    }
  ],
  "activeCell": "c1"
}
```

- The agent edits `query.json` (sql + viz) on disk; the canvas re-runs the
  affected cell and re-renders — same edit-the-doc loop as Kinetic's story.json.
- The user edits sql in the editor or viz in the properties panel; the agent
  reads `query.json` to see those edits (BYOA two-way).

## Local engine — DuckDB in the Rust backend

- **Crate:** `duckdb` (Rust bindings, bundles the engine; no external install).
- **State:** one in-process `duckdb::Connection` per active project, held in
  `AppState` (like the canvas-server handle). DuckDB reads CSV/Parquet/JSON
  directly via `read_csv_auto` / `read_parquet`, so "loading" a source is just
  registering a view — no import step.
- **Tauri commands:**
  - `data_open_source(path, kind)` → create a view, return inferred schema.
  - `data_run_sql(sql)` → run a query, return rows (capped, e.g. 5k) + column
    types as JSON. Read-only-ish: allow CREATE VIEW / WITH, the canvas owns
    execution.
  - `data_schema()` → list sources + columns for the panel + the agent.
- **Result cap + types:** return at most N rows for the grid; the agent gets
  schema + a small sample + row count, not the whole table (token safety).

## The canvas (right side / main stage)

- **Cells list** (notebook-style): each cell = SQL editor + result. Run on
  Cmd+Enter or on doc change (debounced).
- **Result view:** a virtualized grid (rows) with a tab to switch to **chart**
  (Observable Plot or Vega-Lite — Plot is lighter, good default). Chart spec
  comes from the cell's `viz`.
- **Schema sidebar / properties panel:** sources + columns (click to insert);
  for the active cell, the viz controls (chart type, x, y, color) — these write
  back into `query.json` so the agent sees them.

## The agent integration

- **MCP vs Tauri commands:** unlike Brainstorm (external MCP), here the engine
  is *in our backend*. Two options for agent access (decide in planning):
  1. **Doc-driven (recommended, simplest):** the agent just edits `query.json`
     (sql/viz) like Kinetic edits story.json; the canvas runs it. The agent
     "sees" results by reading a `last_result.json` the canvas writes after each
     run (schema + sample + row count). No new MCP server.
  2. **MCP tool:** ship a tiny local MCP exposing `run_sql`/`get_schema` so the
     agent can query directly. More power, more moving parts.
- **Modes (optional, later):** a "watch" mode like Brainstorm where the agent
  observes new results and suggests the next query.

## Persistence

- `query.json` is the persisted doc (sources + cells + viz). Reopening a project
  restores the full exploration. Source files referenced by relative path under
  the project folder (stage them in on add, mirroring export-media staging).
- After each run, the canvas writes `.kinetic-studio/last_result.json`
  (schema + sample + rowcount) so the agent reads result shape without re-running.

## Build order (vertical slice first)

1. **Backend engine:** add `duckdb` crate; `AppState` connection-per-project;
   `data_open_source` / `data_run_sql` / `data_schema` commands; register in
   lib.rs. Seed `query.json` + `DataCanvas` in canvas.rs + skill bundle.
2. **App shell:** `data` manifest in apps.ts; `resolveCanvas("data")`;
   `DataApp` (bootstrap a data project, open/create), boards-style entry list
   reusing the Brainstorm list pattern.
3. **Canvas:** sources sidebar + one SQL cell + result grid (run → render).
4. **Chart view:** add Observable Plot; viz spec from the cell; chart/grid tabs.
5. **Properties panel:** schema browser + viz controls writing to query.json.
6. **Agent loop:** doc-driven integration (agent edits query.json; canvas runs;
   writes last_result.json); skill teaches the contract.
7. **Persistence:** query.json save/restore; source staging.

## Open questions for planning

- DuckDB Rust crate build weight on macOS (bundled engine adds compile time /
  binary size) — acceptable? (Likely yes; it's self-contained.)
- Agent access: doc-driven (recommended) vs local MCP — confirm during plan.
- Chart lib: Observable Plot (light, recommended) vs Vega-Lite (richer spec the
  agent can author more declaratively).
- Row cap for the grid + sample size handed to the agent.

---

# Prompt to start the build in a new session

> I'm in the KineticType/BYOA repo (`/Users/parandykt/Apps/KineticType`), on a
> fresh session. I want to build the **DuckDB Data Explorer** — a new platform
> app following the KineticType pattern (embedded agent panel + live canvas +
> properties panel), with DuckDB running in-process in the Tauri Rust backend.
>
> The full design and build order are in
> `docs/superpowers/specs/2026-06-22-platform-app-ideas.md` (see the
> "Implementation plan — DuckDB Data Explorer" section). Read it first.
>
> Reuse the existing substrate exactly the way Pulse and Brainstorm Canvas do:
> app manifest in `editor/platform/apps.ts`, `resolveCanvas()` in
> `editor/canvas.ts`, canvas detection + a `DataCanvas` + skill bundle in
> `src-tauri/src/canvas.rs` / `canvases/`, agent panel via the existing `Chat`
> component. Study `editor/canvases/music/PulseApp.tsx` and
> `editor/canvases/brainstorm/` as the templates.
>
> Start with the brainstorming skill to confirm the two open decisions
> (agent access: doc-driven vs local MCP — I lean doc-driven; and chart lib:
> Observable Plot vs Vega-Lite — I lean Plot), then write a plan with the
> writing-plans skill, then build the vertical slice (build steps 1–4: backend
> engine + app shell + sources/SQL cell/result grid + chart view). Verify with
> `cargo check`, `tsc`, `npm test`, and the editor build at each step. Work on a
> `feat/duckdb-data-explorer` branch and commit per build step.
>
> Memory note `project_brainstorm_canvas.md` records hard-won gotchas from the
> Brainstorm build (separate-window rendering, skip-permissions, persistence
> ordering) — some patterns transfer. The dev-server restart gotcha
> (`project_devserver_restart_gotcha.md`) and font/publicDir notes still apply.
