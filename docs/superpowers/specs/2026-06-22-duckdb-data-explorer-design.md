# DuckDB Data Explorer — design

**Date:** 2026-06-22
**Branch:** `feat/duckdb-data-explorer`
**Source brainstorm:** `docs/superpowers/specs/2026-06-22-platform-app-ideas.md`
(§ "Implementation plan — DuckDB Data Explorer")

## Goal

A platform app where the user loads local data files (CSV / Parquet / JSON),
explores them through a live SQL + chart canvas, and an embedded agent
co-operates: writes/refines SQL, suggests cuts, and reads the user's edits.
DuckDB runs **in-process in the Tauri Rust backend** — no server, no cloud.

## Confirmed decisions

- **Agent access: doc-driven.** The agent edits `query.json` (sql/viz) like
  Kinetic edits `story.json`; the canvas re-runs the affected cell and writes
  `.kinetic-studio/last_result.json` (schema + sample + rowcount) for the agent
  to read. **No new MCP server, no new process to spawn/kill** — this avoids the
  orphaned-child + port-collision risks the Brainstorm canvas-server carries.
- **Chart library: Observable Plot** (`@observablehq/plot`). Lighter than
  Vega-Lite; the cell's `viz` spec (`{type,x,y,color}`) maps cleanly to Plot
  marks.

## Scope of this spec (vertical slice — build steps 1–4)

This spec covers the vertical slice the build prompt asks for:

1. **Backend engine** — `duckdb` crate; one `Connection` per active project in
   `AppState`; `data_open_source` / `data_run_sql` / `data_schema` commands;
   `DataCanvas` + seed `query.json` + skill bundle.
2. **App shell** — `data` manifest in `apps.ts`; `resolveCanvas("data")`;
   `DataApp` (sessions list + editor), reusing the Brainstorm list pattern.
3. **Canvas** — sources sidebar + one SQL cell + result grid (run → render).
4. **Chart view** — Observable Plot; viz spec from the cell; chart/grid tabs.

Steps 5–7 (full properties panel with viz controls, doc-driven agent loop with
`last_result.json`, source staging + restore) are **out of scope for this
slice** but the data model and seams are designed so they slot in without
rework. The agent can already drive the app in this slice by editing
`query.json` and reading it back — the slice just doesn't yet write
`last_result.json` automatically.

## How it reuses the substrate (same seams as Pulse/Brainstorm)

Three seams, identical to how Pulse and Brainstorm plug in:

- **App manifest** — `editor/platform/apps.ts`: a `data` entry (id `data`,
  category `data`, `Root: DataApp`, distinct hue). Replaces nothing; appended to
  `APPS`.
- **Frontend canvas plugin** — `editor/canvas.ts`: `resolveCanvas("data")`
  returns `dataCanvas`. Like Pulse/Brainstorm, **`DataApp` owns its own Root and
  layout** — it does NOT mount through the kinetic `EditorView`. So the plugin's
  `Renderer`/`Timeline` are substrate-shaped stubs. **Unlike Brainstorm**, the
  doc is real and persisted, so `parse` validates `query.json` (zod) and
  `resolveConflict` does a real merge (see below). `Inspector` is a stub in this
  slice (the in-canvas sidebar covers schema browsing; the substrate Inspector
  is wired in step 5).
- **Rust canvas** — `src-tauri/src/canvas.rs`: a `DataCanvas` impl
  (`id "data"`, `doc_filename "query.json"`, seed bytes, `summarise` = cell
  count, `skill_bundle` → `canvases::data::BUNDLE`). Registered in `by_id`
  (`"data" => &DataCanvas`) and `for_project` (`query.json` → DataCanvas,
  extending the story/project/board detection chain).
- **Agent panel** — reuses `Chat` + `Terminal` verbatim, `cwd = project.path`.
  No MCP.
- **Skill bundle** — `src-tauri/skills/data/SKILL.md` + a `canvases::data`
  module mirroring `canvases::music`, teaching the agent the `query.json`
  contract and DuckDB SQL conventions.

## The artifact — `query.json`

The shared, inspectable document. One per project:

```jsonc
{
  "version": 1,
  "sources": [
    { "id": "sales", "path": "data/sales.csv", "kind": "csv" }
  ],
  "cells": [
    {
      "id": "c1",
      "title": "Revenue by region",
      "sql": "SELECT region, SUM(amount) AS total FROM sales GROUP BY 1",
      "viz": { "type": "bar", "x": "region", "y": "total", "color": null }
    }
  ],
  "activeCell": "c1"
}
```

- `kind` ∈ `csv | parquet | json`.
- `viz.type` ∈ `table | bar | line | scatter` (this slice: `table` + the three
  Plot marks). `x`/`y`/`color` are column names or `null`.
- The agent edits `query.json` on disk; the canvas re-runs the affected cell and
  re-renders. The user edits SQL in the cell editor (and, step 5, viz in the
  panel); both write back to `query.json` so the agent sees the edits (BYOA
  two-way).

Zod schema lives in `src/data/schema.ts` (mirrors `src/pulse/schema.ts`),
imported by both the canvas plugin (`parse`) and `DataApp`.

The seed `query.json` (`src-tauri/templates/seed-query.json`) ships one empty
example cell and no sources, so a fresh project opens to a runnable-but-empty
state and acts as the `for_project` detection marker.

## Local engine — DuckDB in the Rust backend

- **Crate:** `duckdb` with the `bundled` feature (compiles the engine in; no
  external install, no runtime dependency). Build-weight risk is accepted per
  the brainstorm open question — it's self-contained and only compiles once.
- **State:** a `DataEngine` holding `Mutex<Option<(PathBuf, duckdb::Connection)>>`
  added to `AppState` (sibling to `canvas_server`). One connection, keyed by the
  active project path; opening a different project replaces it. In-memory DuckDB
  database — sources are registered as views over the on-disk files, so there is
  no import/copy step and nothing to persist in the engine itself.
- **Module:** `src-tauri/src/data.rs` (mirrors `pulse.rs`): the engine struct +
  the three Tauri commands, registered in `lib.rs`.
- **Commands:**
  - `data_open_source(project_path, path, kind)` — ensure the connection exists
    for this project, `CREATE OR REPLACE VIEW <id> AS SELECT * FROM
    read_csv_auto('<abs>')` (or `read_parquet` / `read_json_auto`). `id` derived
    from the file stem, sanitized to a SQL identifier. Returns the inferred
    schema (`[{name, type}]`).
  - `data_run_sql(project_path, sql)` — run a query against the project's
    connection; return `{ columns: [{name,type}], rows: [...], rowCount,
    truncated }`. Rows **capped at 5_000** for the grid; `truncated` flags when
    the full result was larger (we run `sql` and stop reading at the cap;
    `rowCount` is the capped count in this slice — a separate `COUNT(*)` is a
    step-6 nicety, not needed for the grid).
  - `data_schema(project_path)` — list registered sources + their columns for
    the sidebar (and, later, the agent).
- **Safety:** queries run as-is (DuckDB on a local in-memory DB over the user's
  own files — same trust level as the user's shell). Result cap protects the UI
  and token budget. No network, no `INSTALL`/`LOAD` of remote extensions in the
  seed skill guidance.
- **Errors:** SQL errors return `Err(String)` with DuckDB's message; the cell
  shows it inline (red), nothing crashes.

## The canvas (main stage) — `DataApp`

`DataApp` is the app Root (like `PulseApp`/`BrainstormApp`):

- **Entry:** a **sessions list** screen (clone of `BoardsList`), using
  `projects_list/create/open/delete` with `canvas: "data"`. Opening a session is
  the only way into the editor.
- **Editor layout:** left column = agent panel (`Chat` + `Terminal`, identical
  to Brainstorm's switcher); right = the data canvas:
  - **Sources sidebar** — lists `query.json` sources + (from `data_schema`)
    their columns; an "Add source" button opens a file dialog
    (`tauri-plugin-dialog`), calls `data_open_source`, and appends to
    `query.json`. Clicking a column inserts its name into the active cell's SQL.
  - **Cell** — a SQL editor (textarea is fine for this slice; no CodeMirror
    dependency added) + Run (Cmd+Enter). Run calls `data_run_sql` and stores the
    result in component state.
  - **Result view** — tabbed **Grid | Chart**:
    - *Grid:* a simple scrollable table of columns + rows (virtualization
      deferred; 5k-row cap keeps it tractable).
    - *Chart:* renders Observable Plot from the cell's `viz` (step 4). `table`
      type shows the grid; `bar`/`line`/`scatter` render the matching Plot mark
      using `viz.x`/`y`/`color`. If `viz` columns aren't present in the result,
      show a gentle "pick columns" hint rather than erroring.

This slice keeps **one cell** (the spec's notebook-of-cells is honored by the
`cells[]` array but the UI renders `activeCell` only; multi-cell UI is a later
step). `query.json` is loaded on open and saved (atomic, via existing `save_doc`)
on SQL/source/viz change, debounced — same load-then-autosave ordering the
Brainstorm persistence note calls out (restore before autosave).

## Persistence (this slice)

- `query.json` saved via the existing `save_doc` command (atomic tmp+rename),
  debounced on change. Loaded via `load_doc` on open.
- Sources referenced by path. **This slice records the path the user picks**
  (absolute is fine for local exploration); the export-media-style *staging*
  into the project folder under a relative path is step 7. Noted so it isn't
  mistaken for done.
- No `last_result.json` write in this slice (step 6).

## Agent integration (this slice)

- The agent has the skill bundle and `query.json` in its cwd. It can already
  edit `query.json` (add a source, change the cell's SQL or viz) and the canvas
  picks it up on the next file-watch/save cycle — the same edit-the-doc loop as
  Kinetic. The automatic `last_result.json` feedback file (so the agent reads
  result shape without re-running) is **step 6**, out of this slice.
- No watch/continuous mode in this slice.

## `resolveConflict` (frontend plugin)

Real three-way merge, modeled on Pulse's mixer merge: agent's on-disk
`query.json` is the base; re-apply the user's in-memory edits that the substrate
would otherwise stomp — specifically the **active cell's `sql` and `viz`** if the
user changed them from the saved baseline while the agent wrote. Empty conflict
prompt (no terminal paste needed); the canvas just re-runs.

## Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `src-tauri/src/data.rs` | DuckDB engine + 3 commands | `duckdb` crate, `AppState` |
| `src-tauri/src/canvas.rs` `DataCanvas` | doc filename, seed, summary, bundle | `skill`, `canvases::data` |
| `src-tauri/src/canvases/data.rs` | skill bundle (SKILL.md + CLAUDE.md) | `skill::SkillBundle` |
| `src-tauri/templates/seed-query.json` | seed doc + detection marker | — |
| `src-tauri/skills/data/SKILL.md` | agent operating manual | — |
| `src/data/schema.ts` | zod schema for `query.json` | `zod` |
| `editor/canvases/data/index.tsx` | `dataCanvas` plugin (stubs + parse + merge) | `schema.ts`, `canvas.ts` |
| `editor/canvases/data/DataApp.tsx` | app Root: sessions list + editor | `Chat`, `Terminal`, invoke |
| `editor/canvases/data/Chart.tsx` | Observable Plot render from `viz` | `@observablehq/plot` |

Each unit has one purpose, a typed interface, and is testable: the zod schema
and the `viz → Plot` mapping get unit tests (`npm test`); the Rust commands get
a smoke test against a tiny CSV fixture.

## Testing & verification (per build step)

At each of steps 1–4, run and confirm green before committing:

- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npx tsc --noEmit` (or the project's `tsc` script)
- `npm test`
- the editor build (`npm run build` / the project's build script)

Step-specific:

1. Backend: a `#[cfg(test)]` smoke test creating a view over a fixture CSV and
   running `SELECT COUNT(*)`.
2. Shell: `tsc` + build green; manifest renders on the Square.
3. Canvas: schema test for `query.json`; manual run-a-query check in dev.
4. Chart: unit test for the `viz → Plot` mark mapping.

Commit per build step on `feat/duckdb-data-explorer`.

## Risks / open items

- **DuckDB bundled build time** — first `cargo check` will be slow (compiles the
  engine). Accepted; one-time. If it's prohibitive we fall back to the system
  `libduckdb` (`duckdb` without `bundled`) — noted, not chosen.
- **Result cap semantics** — `rowCount` is the capped count this slice; true
  total via `COUNT(*)` is a step-6 refinement.
- **Single connection / single project** — matches the Brainstorm "one server
  per session" assumption; two data projects open at once is out of scope.
