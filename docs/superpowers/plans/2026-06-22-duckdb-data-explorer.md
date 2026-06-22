# DuckDB Data Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A platform app where the user loads local CSV/Parquet/JSON, explores it through a live SQL + Observable-Plot chart canvas, and an embedded agent co-operates by editing `query.json`, with DuckDB running in-process in the Tauri Rust backend.

**Architecture:** Reuses the three substrate seams Pulse/Brainstorm use — an app manifest (`apps.ts`), a frontend canvas plugin (`canvas.ts`), and a Rust `Canvas` impl + skill bundle (`canvas.rs`/`canvases/`). `DataApp` owns its own Root/layout (it does NOT mount through the kinetic `EditorView`). DuckDB runs as one in-memory `Connection` per active project held in `AppState`; sources are registered as views over on-disk files; `query.json` is the shared, persisted, agent-editable document.

**Tech Stack:** Rust + Tauri 2, `duckdb` crate (bundled), React + TypeScript, zod v4, Observable Plot, vitest.

## Global Constraints

- Branch: `feat/duckdb-data-explorer`. Commit per build step.
- macOS only (matches existing app assumptions).
- Result grid capped at **5_000 rows**; query results returned to the frontend respect this cap.
- App id / canvas id / Rust canvas id are all the string `"data"`; doc filename is `query.json`.
- `viz.type` ∈ `table | bar | line | scatter`; `viz.x`/`viz.y`/`viz.color` are column-name strings or `null`.
- No new MCP server, no new spawned process (doc-driven agent access).
- Verify before each commit: `cargo check --manifest-path src-tauri/Cargo.toml`, `npx tsc -p tsconfig.json --noEmit` (use the repo's tsconfig; if `tsc` script differs, use it), `npm test`, and `npm run build:editor`.
- Skill installer materializes bundle files; SKILL.md MUST be the first entry in `SkillBundle.files`.

## File Structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `src-tauri/Cargo.toml` | Modify | add `duckdb = { version = "1", features = ["bundled"] }` |
| `src-tauri/src/data.rs` | Create | DuckDB engine state + `data_open_source`/`data_run_sql`/`data_schema` commands |
| `src-tauri/src/lib.rs` | Modify | `mod data;` + `DataEngine` in `AppState` + register 3 commands |
| `src-tauri/src/canvas.rs` | Modify | `DataCanvas` impl; register in `by_id` + `for_project` |
| `src-tauri/src/canvases/mod.rs` | Modify | `pub mod data;` |
| `src-tauri/src/canvases/data.rs` | Create | `BUNDLE: SkillBundle` (SKILL.md + CLAUDE.md) |
| `src-tauri/templates/seed-query.json` | Create | seed doc + `for_project` detection marker |
| `src-tauri/skills/data/SKILL.md` | Create | agent operating manual |
| `src/data/schema.ts` | Create | zod schema + types for `query.json` |
| `src/data/__tests__/schema.test.ts` | Create | schema unit tests |
| `editor/canvases/data/index.tsx` | Create | `dataCanvas` plugin (parse + merge + stubs) |
| `editor/canvases/data/DataApp.tsx` | Create | app Root: sessions list + editor |
| `editor/canvases/data/Chart.tsx` | Create | `vizToPlot` + Observable Plot render |
| `editor/canvases/data/__tests__/chart.test.ts` | Create | `vizToPlot` mapping unit test |
| `editor/canvas.ts` | Modify | `resolveCanvas("data")` |
| `editor/platform/apps.ts` | Modify | `data` manifest |
| `package.json` | Modify | add `@observablehq/plot` |

---

## Task 1: DuckDB backend engine + commands

**Files:**
- Modify: `src-tauri/Cargo.toml:20-41` (`[dependencies]`)
- Create: `src-tauri/src/data.rs`
- Modify: `src-tauri/src/lib.rs` (mod, AppState field, command registration)

**Interfaces:**
- Consumes: `AppState` (from `lib.rs`).
- Produces (Tauri commands the frontend calls via `invoke`):
  - `data_open_source(projectPath: string, path: string, kind: string) -> Column[]`
  - `data_run_sql(projectPath: string, sql: string) -> QueryResult`
  - `data_schema(projectPath: string) -> SourceSchema[]`
  - where `Column = { name: string, type: string }`,
    `QueryResult = { columns: Column[], rows: Array<Array<JsonValue>>, rowCount: number, truncated: boolean }`,
    `SourceSchema = { id: string, columns: Column[] }`.
- Produces (Rust): `pub struct DataEngine(pub Mutex<Option<(PathBuf, duckdb::Connection)>>);` with `impl Default`.

- [ ] **Step 1: Add the duckdb dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]`, add:

```toml
duckdb = { version = "1", features = ["bundled"] }
```

- [ ] **Step 2: Write `src-tauri/src/data.rs` with the engine + a failing smoke test**

Create `src-tauri/src/data.rs`:

```rust
//! Local DuckDB engine — one in-memory connection per active project.
//!
//! Sources are registered as VIEWs over on-disk files (read_csv_auto /
//! read_parquet / read_json_auto), so "opening" a source is just a view;
//! there is no import step and nothing in the engine to persist. The
//! query.json document is the persisted artifact (handled by doc.rs).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::AppState;
use tauri::State;

/// The per-project DuckDB connection. Keyed by project path; opening a
/// different project replaces it. In-memory database.
#[derive(Default)]
pub struct DataEngine(pub Mutex<Option<(PathBuf, duckdb::Connection)>>);

#[derive(serde::Serialize, Clone)]
pub struct Column {
    pub name: String,
    pub r#type: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<Column>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
    pub truncated: bool,
}

#[derive(serde::Serialize)]
pub struct SourceSchema {
    pub id: String,
    pub columns: Vec<Column>,
}

const ROW_CAP: usize = 5_000;

/// Sanitize a file stem into a SQL identifier (letters/digits/underscore,
/// not starting with a digit). Falls back to "src" if empty.
fn sanitize_id(stem: &str) -> String {
    let mut s: String = stem
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    if s.is_empty() {
        s = "src".into();
    }
    if s.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
        s = format!("_{s}");
    }
    s
}

/// The read function for a given source kind.
fn read_fn(kind: &str) -> Result<&'static str, String> {
    match kind {
        "csv" => Ok("read_csv_auto"),
        "parquet" => Ok("read_parquet"),
        "json" => Ok("read_json_auto"),
        other => Err(format!("unknown source kind: {other}")),
    }
}

/// Ensure a connection exists for `project_path`, creating (or replacing,
/// if the path changed) an in-memory connection. Returns a locked guard.
fn with_conn<T>(
    engine: &DataEngine,
    project_path: &str,
    f: impl FnOnce(&duckdb::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = engine.0.lock().map_err(|e| e.to_string())?;
    let want = PathBuf::from(project_path);
    let need_new = match guard.as_ref() {
        Some((p, _)) => p != &want,
        None => true,
    };
    if need_new {
        let conn = duckdb::Connection::open_in_memory().map_err(|e| e.to_string())?;
        *guard = Some((want.clone(), conn));
    }
    let (_, conn) = guard.as_ref().unwrap();
    f(conn)
}

/// Resolve a possibly-relative source path against the project dir.
fn resolve_path(project_path: &str, path: &str) -> PathBuf {
    let p = Path::new(path);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        Path::new(project_path).join(p)
    }
}

/// Read the column schema of a prepared statement into Column structs.
fn columns_of(stmt: &duckdb::Statement) -> Vec<Column> {
    let names = stmt.column_names();
    (0..names.len())
        .map(|i| Column {
            name: names[i].clone(),
            r#type: stmt
                .column_type(i)
                .to_string(),
        })
        .collect()
}

#[tauri::command]
pub fn data_open_source(
    project_path: String,
    path: String,
    kind: String,
    state: State<'_, AppState>,
) -> Result<Vec<Column>, String> {
    let reader = read_fn(&kind)?;
    let abs = resolve_path(&project_path, &path);
    let abs_str = abs.to_string_lossy().replace('\'', "''");
    let stem = abs
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("src");
    let id = sanitize_id(stem);
    with_conn(&state.data_engine, &project_path, |conn| {
        conn.execute_batch(&format!(
            "CREATE OR REPLACE VIEW {id} AS SELECT * FROM {reader}('{abs_str}');"
        ))
        .map_err(|e| e.to_string())?;
        let stmt = conn
            .prepare(&format!("SELECT * FROM {id} LIMIT 0"))
            .map_err(|e| e.to_string())?;
        Ok(columns_of(&stmt))
    })
}

#[tauri::command]
pub fn data_run_sql(
    project_path: String,
    sql: String,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    with_conn(&state.data_engine, &project_path, |conn| {
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let mut rows_iter = stmt.query([]).map_err(|e| e.to_string())?;
        let mut rows: Vec<Vec<serde_json::Value>> = Vec::new();
        let mut truncated = false;
        // Column metadata is available from the statement after query().
        let columns = columns_of(&stmt);
        let ncols = columns.len();
        while let Some(row) = rows_iter.next().map_err(|e| e.to_string())? {
            if rows.len() >= ROW_CAP {
                truncated = true;
                break;
            }
            let mut out = Vec::with_capacity(ncols);
            for i in 0..ncols {
                out.push(value_to_json(row, i));
            }
            rows.push(out);
        }
        let row_count = rows.len();
        Ok(QueryResult {
            columns,
            rows,
            row_count,
            truncated,
        })
    })
}

/// Convert a DuckDB cell to JSON. Falls back to string for types we don't
/// special-case, so the grid always has something to show.
fn value_to_json(row: &duckdb::Row, i: usize) -> serde_json::Value {
    use serde_json::Value;
    if let Ok(v) = row.get::<usize, Option<i64>>(i) {
        return v.map(Value::from).unwrap_or(Value::Null);
    }
    if let Ok(v) = row.get::<usize, Option<f64>>(i) {
        return v.map(Value::from).unwrap_or(Value::Null);
    }
    if let Ok(v) = row.get::<usize, Option<bool>>(i) {
        return v.map(Value::from).unwrap_or(Value::Null);
    }
    if let Ok(v) = row.get::<usize, Option<String>>(i) {
        return v.map(Value::from).unwrap_or(Value::Null);
    }
    Value::Null
}

#[tauri::command]
pub fn data_schema(
    project_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<SourceSchema>, String> {
    with_conn(&state.data_engine, &project_path, |conn| {
        let mut stmt = conn
            .prepare("SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'")
            .map_err(|e| e.to_string())?;
        let names: Vec<String> = stmt
            .query_map([], |r| r.get::<usize, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        let mut out = Vec::new();
        for id in names {
            let cstmt = conn
                .prepare(&format!("SELECT * FROM {id} LIMIT 0"))
                .map_err(|e| e.to_string())?;
            out.push(SourceSchema {
                id,
                columns: columns_of(&cstmt),
            });
        }
        Ok(out)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn view_over_csv_counts_rows() {
        let dir = tempfile::tempdir().unwrap();
        let csv = dir.path().join("t.csv");
        std::fs::write(&csv, "a,b\n1,x\n2,y\n3,z\n").unwrap();

        let conn = duckdb::Connection::open_in_memory().unwrap();
        let abs = csv.to_string_lossy().to_string();
        conn.execute_batch(&format!(
            "CREATE OR REPLACE VIEW t AS SELECT * FROM read_csv_auto('{abs}');"
        ))
        .unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM t", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 3);
    }

    #[test]
    fn sanitize_id_rules() {
        assert_eq!(sanitize_id("sales-2024"), "sales_2024");
        assert_eq!(sanitize_id("2024data"), "_2024data");
        assert_eq!(sanitize_id(""), "src");
    }
}
```

> Note: `duckdb::Statement::column_type` / `query`/`query_map` APIs are from the `duckdb` crate. If a method name differs in the resolved crate version, adapt minimally (the test in Step 4 catches signature drift). Keep behavior identical.

- [ ] **Step 3: Wire into `lib.rs`**

In `src-tauri/src/lib.rs`:
- Add `mod data;` near the other `mod` lines.
- Add to `AppState`: `pub data_engine: data::DataEngine,`
- In the `AppState { ... }` initializer add: `data_engine: data::DataEngine::default(),`
- In `tauri::generate_handler![ ... ]` add: `data::data_open_source, data::data_run_sql, data::data_schema,`

- [ ] **Step 4: Run the Rust smoke test (verify it builds + passes)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml data:: 2>&1 | tail -30`
Expected: compiles (first build is slow — duckdb bundled), `view_over_csv_counts_rows` and `sanitize_id_rules` PASS.

- [ ] **Step 5: Verify the whole crate type-checks**

Run: `cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20`
Expected: `Finished` with no errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/data.rs src-tauri/src/lib.rs
git commit -m "feat(data): DuckDB engine + data_open_source/run_sql/schema commands

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: DataCanvas Rust impl + seed + skill bundle

**Files:**
- Create: `src-tauri/templates/seed-query.json`
- Create: `src-tauri/skills/data/SKILL.md`
- Create: `src-tauri/src/canvases/data.rs`
- Modify: `src-tauri/src/canvases/mod.rs` (add `pub mod data;`)
- Modify: `src-tauri/src/canvas.rs` (add `DataCanvas`; register in `by_id`, `for_project`)

**Interfaces:**
- Consumes: `crate::skill::SkillBundle`, `crate::canvas::Canvas` trait.
- Produces: `crate::canvases::data::BUNDLE`; `canvas::by_id("data")` and `canvas::for_project(dir-with-query.json)` resolve to `DataCanvas`.

- [ ] **Step 1: Create the seed document**

Create `src-tauri/templates/seed-query.json`:

```json
{
  "version": 1,
  "sources": [],
  "cells": [
    {
      "id": "c1",
      "title": "Untitled query",
      "sql": "SELECT 1 AS hello",
      "viz": { "type": "table", "x": null, "y": null, "color": null }
    }
  ],
  "activeCell": "c1"
}
```

- [ ] **Step 2: Create the agent skill**

Create `src-tauri/skills/data/SKILL.md`:

```markdown
---
name: data-explorer
description: Operating manual for the DuckDB Data Explorer — drive the live SQL + chart canvas by editing query.json.
---

# DuckDB Data Explorer

You are inside a Data Explorer project. The user explores local data files
through a live SQL + chart canvas. **You collaborate by editing `./query.json`**;
the canvas re-runs the affected cell and re-renders.

## The document — `query.json`

```jsonc
{
  "version": 1,
  "sources": [ { "id": "sales", "path": "data/sales.csv", "kind": "csv" } ],
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

- `sources[].kind` ∈ `csv | parquet | json`. The `id` is the SQL table name
  (a view over the file). Add a source by appending to `sources`; the user
  adds files through the UI too.
- `cells[].sql` is DuckDB SQL. Query a source by its `id`.
- `cells[].viz.type` ∈ `table | bar | line | scatter`. `x`/`y`/`color` are
  column names produced by the cell's SQL, or `null`. For `table`, all are
  `null`.
- `activeCell` is the cell currently shown in the canvas.

## How to collaborate

- To refine a query: edit `cells[].sql` for the active cell, then choose a
  `viz` that fits the result shape (a category + a measure → `bar`; a time
  series → `line`; two measures → `scatter`).
- To add data: append a source, then write SQL against its `id`.
- Respect the user's edits: they may have changed the SQL or viz in the UI.
  Read `query.json` before editing so you build on their state.
- Keep SQL DuckDB-flavored. Do NOT `INSTALL`/`LOAD` remote extensions or hit
  the network. Stay on the user's local files.

## Conventions

- One active cell is rendered at a time (this version).
- Result grids are capped at 5,000 rows — aggregate/limit large tables.
```

- [ ] **Step 3: Create the bundle module**

Create `src-tauri/src/canvases/data.rs`:

```rust
//! Data Explorer canvas's agent skill bundle. Mirrors the pulse bundle:
//! pulls the routing skill from src-tauri/skills/data/ at compile time and
//! pairs it with a per-project CLAUDE.md pointing the agent at it.

use crate::skill::SkillBundle;

const SKILL_ROUTING: &str = include_str!("../../skills/data/SKILL.md");

const CLAUDE_MD: &str = r#"# Data Explorer project

You are inside a DuckDB Data Explorer project — a live SQL + chart canvas.
**The agent operating manual is at `.claude/skills/data/SKILL.md`** — read it
first.

Short version:

- Edit `./query.json` to add sources and to write/refine the active cell's
  `sql` and `viz`. The canvas re-runs and re-renders.
- `viz.type` is one of table | bar | line | scatter; `x`/`y`/`color` are
  column names the SQL produces, or null.
- DuckDB SQL only; never INSTALL/LOAD remote extensions or hit the network.
- Read `query.json` before editing so you build on the user's edits.
"#;

pub const BUNDLE: SkillBundle = SkillBundle {
    canvas_id: "data",
    files: &[("SKILL.md", SKILL_ROUTING)],
    claude_md: CLAUDE_MD,
};
```

- [ ] **Step 4: Register the module**

In `src-tauri/src/canvases/mod.rs`, add after the existing `pub mod` lines:

```rust
pub mod data;
```

- [ ] **Step 5: Add the `DataCanvas` impl in `canvas.rs`**

In `src-tauri/src/canvas.rs`, after the `BrainstormCanvas` impl block (before `pub fn by_id`), add:

```rust
/// The Data Explorer canvas. Its document is `query.json` (sources + cells
/// + viz). Unlike Brainstorm, this doc is real and persisted.
pub struct DataCanvas;

impl Canvas for DataCanvas {
    fn id(&self) -> &'static str {
        "data"
    }

    fn doc_filename(&self) -> &'static str {
        "query.json"
    }

    fn seed_bytes(&self) -> &'static [u8] {
        include_bytes!("../templates/seed-query.json")
    }

    fn summarise(&self, project_dir: &Path) -> ProjectSummary {
        let count = std::fs::read_to_string(project_dir.join(self.doc_filename()))
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v.get("cells").and_then(|b| b.as_array()).map(|a| a.len()))
            .unwrap_or(0);
        ProjectSummary { count }
    }

    fn skill_bundle(&self) -> &'static crate::skill::SkillBundle {
        &crate::canvases::data::BUNDLE
    }
}
```

- [ ] **Step 6: Register in `by_id` and `for_project`**

In `src-tauri/src/canvas.rs`:

In `by_id`, add the `"data"` arm:

```rust
pub fn by_id(id: &str) -> &'static dyn Canvas {
    match id {
        "pulse" => &MusicCanvas,
        "brainstorm" => &BrainstormCanvas,
        "data" => &DataCanvas,
        _ => &KineticCanvas,
    }
}
```

In `for_project`, add the `query.json` branch (before the kinetic fallback):

```rust
pub fn for_project(project_dir: &Path) -> &'static dyn Canvas {
    if project_dir.join("project.json").exists() {
        &MusicCanvas
    } else if project_dir.join("board.json").exists() {
        &BrainstormCanvas
    } else if project_dir.join("query.json").exists() {
        &DataCanvas
    } else {
        &KineticCanvas
    }
}
```

- [ ] **Step 7: Verify the crate type-checks**

Run: `cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20`
Expected: `Finished` with no errors.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/templates/seed-query.json src-tauri/skills/data/SKILL.md \
  src-tauri/src/canvases/data.rs src-tauri/src/canvases/mod.rs src-tauri/src/canvas.rs
git commit -m "feat(data): DataCanvas detection, seed query.json, skill bundle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `query.json` zod schema (frontend types)

**Files:**
- Create: `src/data/schema.ts`
- Create: `src/data/__tests__/schema.test.ts`

**Interfaces:**
- Produces: `queryDocSchema` (zod), and types `QueryDoc`, `DataSource`, `DataCell`, `Viz`, `VizType`. Used by Task 4 (`parse`) and Task 5 (`DataApp`).
  - `Viz = { type: "table"|"bar"|"line"|"scatter"; x: string|null; y: string|null; color: string|null }`
  - `DataCell = { id: string; title: string; sql: string; viz: Viz }`
  - `DataSource = { id: string; path: string; kind: "csv"|"parquet"|"json" }`
  - `QueryDoc = { version: number; sources: DataSource[]; cells: DataCell[]; activeCell: string }`

- [ ] **Step 1: Write the failing schema test**

Create `src/data/__tests__/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { queryDocSchema } from "../schema";

describe("queryDocSchema", () => {
  it("parses the seed document shape", () => {
    const doc = queryDocSchema.parse({
      version: 1,
      sources: [],
      cells: [
        { id: "c1", title: "Untitled query", sql: "SELECT 1 AS hello",
          viz: { type: "table", x: null, y: null, color: null } },
      ],
      activeCell: "c1",
    });
    expect(doc.cells[0].sql).toBe("SELECT 1 AS hello");
    expect(doc.cells[0].viz.type).toBe("table");
  });

  it("rejects an unknown viz type", () => {
    expect(() =>
      queryDocSchema.parse({
        version: 1,
        sources: [],
        cells: [{ id: "c1", title: "x", sql: "SELECT 1",
          viz: { type: "pie", x: null, y: null, color: null } }],
        activeCell: "c1",
      }),
    ).toThrow();
  });

  it("rejects an unknown source kind", () => {
    expect(() =>
      queryDocSchema.parse({
        version: 1,
        sources: [{ id: "s", path: "a.xlsx", kind: "excel" }],
        cells: [],
        activeCell: "",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/data/__tests__/schema.test.ts`
Expected: FAIL — cannot resolve `../schema`.

- [ ] **Step 3: Write the schema**

Create `src/data/schema.ts`:

```ts
import { z } from "zod";

export const vizTypeSchema = z.enum(["table", "bar", "line", "scatter"]);
export type VizType = z.infer<typeof vizTypeSchema>;

export const vizSchema = z.object({
  type: vizTypeSchema,
  x: z.string().nullable(),
  y: z.string().nullable(),
  color: z.string().nullable(),
});
export type Viz = z.infer<typeof vizSchema>;

export const dataSourceSchema = z.object({
  id: z.string(),
  path: z.string(),
  kind: z.enum(["csv", "parquet", "json"]),
});
export type DataSource = z.infer<typeof dataSourceSchema>;

export const dataCellSchema = z.object({
  id: z.string(),
  title: z.string(),
  sql: z.string(),
  viz: vizSchema,
});
export type DataCell = z.infer<typeof dataCellSchema>;

export const queryDocSchema = z.object({
  version: z.number(),
  sources: z.array(dataSourceSchema),
  cells: z.array(dataCellSchema),
  activeCell: z.string(),
});
export type QueryDoc = z.infer<typeof queryDocSchema>;
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- src/data/__tests__/schema.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/schema.ts src/data/__tests__/schema.test.ts
git commit -m "feat(data): query.json zod schema + tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Frontend canvas plugin + apps.ts registration

**Files:**
- Create: `editor/canvases/data/index.tsx`
- Modify: `editor/canvas.ts` (`resolveCanvas`)
- Modify: `editor/platform/apps.ts` (manifest + import)

**Interfaces:**
- Consumes: `queryDocSchema`/`QueryDoc` (Task 3); `CanvasPlugin` (`editor/canvas.ts`); `DataApp` (Task 5 — imported by `apps.ts` only).
- Produces: `dataCanvas: CanvasPlugin<QueryDoc>`; `resolveCanvas("data")` returns it.

> Task 4 and Task 5 both touch import wiring. Implement Task 5's `DataApp.tsx` file first OR stub the import. To keep tasks independently testable, this task creates a **minimal placeholder** `DataApp` import only if Task 5 isn't done yet. Recommended execution order: Task 5 before this task's `apps.ts` edit. The steps below assume `DataApp` exists (Task 5 done).

- [ ] **Step 1: Write the canvas plugin**

Create `editor/canvases/data/index.tsx`:

```tsx
import React from "react";
import { queryDocSchema, type QueryDoc } from "../../../src/data/schema";
import type {
  CanvasPlugin,
  CanvasRendererProps,
  CanvasInspectorProps,
  ConflictResolution,
} from "../../canvas";
import type { Selection } from "../../selection";

/**
 * The Data Explorer canvas plugin. Sibling to musicCanvas/brainstormCanvas.
 *
 * `DataApp` is the app Root (registered in apps.ts) and owns its own layout
 * (agent panel + SQL/chart canvas) — it does NOT mount through the kinetic
 * EditorView. So Renderer/Inspector/Timeline are substrate-shaped stubs.
 * Unlike Brainstorm, the doc is real: `parse` validates query.json and
 * `resolveConflict` re-applies the user's live cell edits over the agent's
 * on-disk version (mirrors Pulse's mixer merge).
 */
const RendererStub: React.FC<CanvasRendererProps<QueryDoc>> = () => null;
const InspectorStub: React.FC<CanvasInspectorProps<QueryDoc>> = () => null;

export const dataCanvas: CanvasPlugin<QueryDoc> = {
  id: "data",
  docFilename: "query.json",
  parse: (raw) => queryDocSchema.parse(raw),
  durationInFrames: () => 1,
  resolveConflict: (saved, agent, user): ConflictResolution<QueryDoc> => {
    // Agent's on-disk doc is the base; re-apply the user's live edits to the
    // active cell's sql/viz if they diverge from the saved baseline, so an
    // agent edit doesn't stomp what the user is typing.
    const activeId = user.activeCell;
    const savedCell = saved.cells.find((c) => c.id === activeId);
    const userCell = user.cells.find((c) => c.id === activeId);
    const merged: QueryDoc = {
      ...agent,
      cells: agent.cells.map((c) => {
        if (c.id !== activeId || !userCell || !savedCell) return c;
        const userTouched =
          userCell.sql !== savedCell.sql ||
          JSON.stringify(userCell.viz) !== JSON.stringify(savedCell.viz);
        return userTouched ? { ...c, sql: userCell.sql, viz: userCell.viz } : c;
      }),
    };
    return { merged, prompt: "" };
  },
  pruneSelection: (_doc, sel) => sel as Selection,
  Renderer: RendererStub,
  Inspector: InspectorStub,
  Timeline: null,
};
```

- [ ] **Step 2: Register in `resolveCanvas`**

In `editor/canvas.ts`, add the import beside the others:

```ts
import { dataCanvas } from "./canvases/data";
```

And add the branch in `resolveCanvas` (before the kinetic fallback):

```ts
  if (appId === "data") return dataCanvas as CanvasPlugin<unknown>;
```

- [ ] **Step 3: Register the app manifest**

In `editor/platform/apps.ts`, add the import beside the others:

```ts
import { DataApp } from "../canvases/data/DataApp";
```

And append this entry to the `APPS` array (after `brainstorm`, before `voxel`):

```ts
  {
    id: "data",
    name: "Data Explorer",
    blurb: "Agent-native local data exploration",
    description:
      "Load local CSV, Parquet, or JSON and explore it through a live SQL + chart canvas. DuckDB runs in-process — no server, no cloud. The agent writes and refines SQL and picks charts by editing query.json; you tweak the query and see results re-render instantly.",
    creator: "altramanera",
    version: "0.1.0",
    tokens: 0,
    files: 9,
    loc: 900,
    rating: 0,
    ratingCount: 0,
    tags: ["data", "sql", "agent-native"],
    hue: 48,
    status: "available",
    Root: DataApp,
    releasedAt: "2026-06-22",
    sizeBytes: 2_000_000,
    category: "data",
  },
```

- [ ] **Step 4: Type-check + build**

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | tail -20`
Expected: no errors.
Run: `npm run build:editor 2>&1 | tail -15`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add editor/canvases/data/index.tsx editor/canvas.ts editor/platform/apps.ts
git commit -m "feat(data): canvas plugin + Data Explorer app manifest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: DataApp — sessions list + editor (SQL cell + result grid)

**Files:**
- Modify: `package.json` (add `@observablehq/plot`) — used in Task 6, installed here so the editor is built once.
- Create: `editor/canvases/data/DataApp.tsx`

**Interfaces:**
- Consumes: `Chat` (`editor/agent-chat/Chat`), `Terminal` (`editor/terminal`), `isTauri` (`editor/runtime`), `QueryDoc`/`queryDocSchema` (Task 3), Tauri commands from Task 1 (`data_open_source`, `data_run_sql`, `data_schema`), and existing `projects_list/create/open/delete`, `load_doc`, `save_doc`.
- Produces: `export const DataApp: React.FC<{ onExit: () => void }>` (consumed by `apps.ts` in Task 4).

> Modeled closely on `editor/canvases/brainstorm/BrainstormApp.tsx`. Reuse its `SessionsList` (renamed clone of `BoardsList`) and its Chat/Terminal switcher verbatim, swapping `canvas: "brainstorm"` → `canvas: "data"` and copy.

- [ ] **Step 1: Install Observable Plot**

Run: `npm install @observablehq/plot`
Expected: `package.json` gains `@observablehq/plot`; lockfile updated.

- [ ] **Step 2: Write `DataApp.tsx`**

Create `editor/canvases/data/DataApp.tsx`. The result-cell `QueryResult` type mirrors Task 1's command return:

```tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "../../runtime";
import { Chat, type ChatHandle } from "../../agent-chat/Chat";
import { Terminal } from "../../terminal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Play } from "../../icons";
import { queryDocSchema, type QueryDoc, type DataSource } from "../../../src/data/schema";
import { ChartView } from "./Chart";

type ProjectMeta = { name: string; path: string; lastOpened?: string };
type ViewMode = "terminal" | "chat";
type ResultTab = "grid" | "chart";

type Column = { name: string; type: string };
type QueryResult = {
  columns: Column[];
  rows: Array<Array<string | number | boolean | null>>;
  rowCount: number;
  truncated: boolean;
};

const agentLabelFor = (id: string): string =>
  id === "codex" ? "Codex" : id === "gemini" ? "Gemini" : "Claude";

const SessionsList: React.FC<{ onOpen: (m: ProjectMeta) => void }> = ({ onOpen }) => {
  const [items, setItems] = useState<ProjectMeta[]>([]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!isTauri()) return setItems([]);
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      setItems(await invoke<ProjectMeta[]>("projects_list", { canvas: "data" }));
    } catch (e) {
      setError(`Failed to list: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const open = useCallback(async (meta: ProjectMeta) => {
    if (!isTauri()) return onOpen(meta);
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("project_open", { path: meta.path });
      onOpen(meta);
    } catch (e) { setError(`Open failed: ${(e as Error).message}`); }
  }, [onOpen]);

  const create = useCallback(async () => {
    if (!isTauri()) return;
    setBusy(true);
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const meta = await invoke<ProjectMeta>("projects_create", {
        name: newName.trim() || "Data Session", canvas: "data",
      });
      setNewName("");
      await open(meta);
    } catch (e) { setError(`Create failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }, [newName, open]);

  const remove = useCallback(async (path: string) => {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    try { await invoke("project_delete", { path }); await refresh(); }
    catch (e) { setError(`Delete failed: ${(e as Error).message}`); }
  }, [refresh]);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 p-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Data sessions</h1>
        <p className="text-sm text-muted-foreground">
          Open a session to explore data with the agent, or start a new one.
        </p>
      </div>
      <div className="flex gap-2">
        <Input value={newName} onChange={(e) => setNewName(e.target.value)}
          placeholder="New session name…"
          onKeyDown={(e) => { if (e.key === "Enter") void create(); }} />
        <Button onClick={create} disabled={busy}><Plus className="size-4" />New session</Button>
      </div>
      {error ? <div className="text-sm text-destructive">{error}</div> : null}
      <div className="flex flex-1 flex-col gap-2 overflow-auto">
        {items.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No sessions yet. Create your first one above.
          </div>
        ) : items.map((b) => (
          <div key={b.path}
            className="group flex items-center justify-between rounded-lg border border-border bg-card p-3 hover:bg-accent">
            <button className="flex-1 text-left" onClick={() => void open(b)} title="Open">
              <div className="text-sm font-medium text-foreground">{b.name}</div>
              <div className="text-xs text-muted-foreground">{b.path}</div>
            </button>
            <Button variant="ghost" size="icon-sm" onClick={() => void remove(b.path)}
              title="Delete" className="opacity-0 group-hover:opacity-100">
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};

const DataEditor: React.FC<{ project: ProjectMeta }> = ({ project }) => {
  const [doc, setDoc] = useState<QueryDoc | null>(null);
  const [schema, setSchema] = useState<Array<{ id: string; columns: Column[] }>>([]);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("terminal");
  const [resultTab, setResultTab] = useState<ResultTab>("grid");
  const [agentId, setAgentId] = useState<"claude" | "codex" | "gemini">("claude");
  const chatHandleRef = useRef<ChatHandle | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load query.json on open.
  useEffect(() => {
    void (async () => {
      if (!isTauri()) return;
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        const raw = await invoke<string>("load_doc");
        setDoc(queryDocSchema.parse(JSON.parse(raw)));
        const settings = await invoke<{ default_agent?: string }>("get_settings").catch(() => ({}));
        const id = settings?.default_agent;
        if (id === "claude" || id === "codex" || id === "gemini") setAgentId(id);
      } catch (e) { setError(`Load failed: ${(e as Error).message}`); }
    })();
  }, [project.path]);

  // Re-register all sources into the engine on open / when sources change,
  // then refresh schema for the sidebar.
  useEffect(() => {
    if (!doc || !isTauri()) return;
    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      for (const s of doc.sources) {
        await invoke("data_open_source",
          { projectPath: project.path, path: s.path, kind: s.kind }).catch(() => {});
      }
      try {
        setSchema(await invoke("data_schema", { projectPath: project.path }));
      } catch { /* ignore */ }
    })();
  }, [doc?.sources, project.path]);

  // Debounced save of query.json.
  const persist = useCallback((next: QueryDoc) => {
    setDoc(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (!isTauri()) return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_doc", { json: JSON.stringify(next, null, 2) }).catch(() => {});
    }, 400);
  }, []);

  const activeCell = doc?.cells.find((c) => c.id === doc.activeCell) ?? doc?.cells[0];

  const setSql = (sql: string) => {
    if (!doc || !activeCell) return;
    persist({ ...doc, cells: doc.cells.map((c) => c.id === activeCell.id ? { ...c, sql } : c) });
  };

  const run = useCallback(async () => {
    if (!activeCell || !isTauri()) return;
    setError(null);
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      setResult(await invoke<QueryResult>("data_run_sql",
        { projectPath: project.path, sql: activeCell.sql }));
    } catch (e) { setError(String(e)); setResult(null); }
  }, [activeCell, project.path]);

  const addSource = useCallback(async () => {
    if (!doc || !isTauri()) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: false,
      filters: [{ name: "Data", extensions: ["csv", "parquet", "json"] }] });
    if (!picked || typeof picked !== "string") return;
    const ext = picked.split(".").pop()?.toLowerCase();
    const kind: DataSource["kind"] = ext === "parquet" ? "parquet" : ext === "json" ? "json" : "csv";
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("data_open_source", { projectPath: project.path, path: picked, kind });
    const stem = picked.split("/").pop()?.split(".")[0] ?? "src";
    const id = stem.replace(/[^a-zA-Z0-9]/g, "_").replace(/^(\d)/, "_$1");
    persist({ ...doc, sources: [...doc.sources, { id, path: picked, kind }] });
  }, [doc, project.path, persist]);

  return (
    <div className="flex h-full min-h-0">
      {/* Left: agent panel */}
      <div className="flex w-[380px] flex-none flex-col border-r border-border">
        <div className="flex flex-none items-center gap-1 border-b border-border px-2 py-1">
          <Button size="sm" variant={viewMode === "terminal" ? "default" : "secondary"}
            onClick={() => setViewMode("terminal")}>Terminal</Button>
          <Button size="sm" variant={viewMode === "chat" ? "default" : "secondary"}
            onClick={() => setViewMode("chat")}>{`Chat · ${agentLabelFor(agentId)}`}</Button>
        </div>
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, display: viewMode === "terminal" ? "block" : "none" }}>
            <Terminal />
          </div>
          <div style={{ position: "absolute", inset: 0, display: viewMode === "chat" ? "block" : "none" }}>
            <Chat agentId={agentId} agentLabel={agentLabelFor(agentId)} cwd={project.path}
              onSwitchToTerminal={() => setViewMode("terminal")}
              onReady={(h) => { chatHandleRef.current = h; }} />
          </div>
        </div>
      </div>

      {/* Right: data canvas */}
      <div className="flex flex-1 min-h-0">
        {/* Sources sidebar */}
        <div className="flex w-56 flex-none flex-col border-r border-border">
          <div className="flex items-center justify-between border-b border-border p-2">
            <span className="text-xs font-medium text-muted-foreground">Sources</span>
            <Button size="icon-sm" variant="secondary" onClick={addSource} title="Add source">
              <Plus className="size-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-auto p-2 text-xs">
            {schema.length === 0 ? (
              <div className="text-muted-foreground">No sources. Add a CSV/Parquet/JSON.</div>
            ) : schema.map((s) => (
              <div key={s.id} className="mb-2">
                <div className="font-medium text-foreground">{s.id}</div>
                {s.columns.map((c) => (
                  <button key={c.name}
                    className="block w-full truncate text-left text-muted-foreground hover:text-foreground"
                    onClick={() => activeCell && setSql(`${activeCell.sql}${c.name}`)}
                    title={`${c.name} · ${c.type}`}>
                    {c.name} <span className="opacity-50">{c.type}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Cell: SQL editor + result */}
        <div className="flex flex-1 min-h-0 flex-col">
          <div className="flex items-center gap-2 border-b border-border p-2">
            <span className="text-sm font-medium text-foreground">{activeCell?.title ?? "Query"}</span>
            <Button size="sm" className="ml-auto" onClick={run} title="Run (Cmd+Enter)">
              <Play className="size-3.5" />Run
            </Button>
          </div>
          <textarea
            className="flex-none resize-none border-b border-border bg-background p-2 font-mono text-sm text-foreground outline-none"
            rows={5}
            value={activeCell?.sql ?? ""}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void run(); } }}
            spellCheck={false}
          />
          {error ? <div className="flex-none px-2 py-1 text-xs text-destructive">{error}</div> : null}
          <div className="flex flex-none items-center gap-1 border-b border-border px-2 py-1">
            <Button size="sm" variant={resultTab === "grid" ? "default" : "secondary"}
              onClick={() => setResultTab("grid")}>Grid</Button>
            <Button size="sm" variant={resultTab === "chart" ? "default" : "secondary"}
              onClick={() => setResultTab("chart")}>Chart</Button>
            {result?.truncated ? (
              <span className="ml-auto text-xs text-muted-foreground">showing first {result.rowCount} rows</span>
            ) : null}
          </div>
          <div className="flex-1 overflow-auto p-2">
            {!result ? (
              <div className="text-sm text-muted-foreground">Run a query to see results.</div>
            ) : resultTab === "grid" ? (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr>{result.columns.map((c) => (
                    <th key={c.name} className="border-b border-border px-2 py-1 font-medium text-foreground">{c.name}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i}>{row.map((cell, j) => (
                      <td key={j} className="border-b border-border/40 px-2 py-1 text-muted-foreground">{String(cell ?? "")}</td>
                    ))}</tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <ChartView viz={activeCell?.viz ?? { type: "table", x: null, y: null, color: null }}
                columns={result.columns.map((c) => c.name)} rows={result.rows} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const DataApp: React.FC<{ onExit: () => void }> = () => {
  const [project, setProject] = useState<ProjectMeta | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const un = await listen<ProjectMeta>("project://opened", (e) => setProject(e.payload));
      off = () => un();
    })();
    return () => { if (off) off(); };
  }, []);
  if (!project) return <SessionsList onOpen={setProject} />;
  return <DataEditor key={project.path} project={project} />;
};
```

> Before writing, verify icon names exist in `editor/icons`: `Plus`, `Trash2` are used by BrainstormApp (confirmed). Check `Play` exists; if not, use an available run icon (e.g. `ChevronRight`) — grep `editor/icons` and substitute.

- [ ] **Step 3: Type-check (ChartView import will fail until Task 6)**

Task 6 creates `editor/canvases/data/Chart.tsx`. To keep this task green independently, create a **temporary stub** `Chart.tsx` now (Task 6 replaces it):

```tsx
import React from "react";
import type { Viz } from "../../../src/data/schema";
export const ChartView: React.FC<{ viz: Viz; columns: string[]; rows: Array<Array<unknown>> }> = () =>
  <div className="text-sm text-muted-foreground">Chart coming in the next step.</div>;
```

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | tail -20`
Expected: no errors (this requires Task 4's `apps.ts` import to resolve — do Task 4 Step 3 after this file exists, or it will error on the missing `DataApp`).

- [ ] **Step 4: Build the editor**

Run: `npm run build:editor 2>&1 | tail -15`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json editor/canvases/data/DataApp.tsx editor/canvases/data/Chart.tsx
git commit -m "feat(data): DataApp sessions list + SQL cell + result grid

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Chart view — Observable Plot from viz spec

**Files:**
- Create (replace stub): `editor/canvases/data/Chart.tsx`
- Create: `editor/canvases/data/__tests__/chart.test.ts`

**Interfaces:**
- Consumes: `Viz` (Task 3), `@observablehq/plot` (installed Task 5).
- Produces: `vizToPlot(viz, columns, rows) -> { kind: "table" } | { kind: "plot"; data: object[]; markType: "bar"|"line"|"scatter"; x: string; y: string; color?: string } | { kind: "hint"; message: string }` and `ChartView` React component.

- [ ] **Step 1: Write the failing mapping test**

Create `editor/canvases/data/__tests__/chart.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { vizToPlot } from "../Chart";

const cols = ["region", "total"];
const rows = [["west", 10], ["east", 20]];

describe("vizToPlot", () => {
  it("returns table kind for table viz", () => {
    const r = vizToPlot({ type: "table", x: null, y: null, color: null }, cols, rows);
    expect(r.kind).toBe("table");
  });

  it("maps a bar viz to plot data keyed by column name", () => {
    const r = vizToPlot({ type: "bar", x: "region", y: "total", color: null }, cols, rows);
    expect(r.kind).toBe("plot");
    if (r.kind === "plot") {
      expect(r.markType).toBe("bar");
      expect(r.x).toBe("region");
      expect(r.y).toBe("total");
      expect(r.data[0]).toEqual({ region: "west", total: 10 });
    }
  });

  it("returns a hint when x/y columns are missing from the result", () => {
    const r = vizToPlot({ type: "bar", x: "missing", y: "total", color: null }, cols, rows);
    expect(r.kind).toBe("hint");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- editor/canvases/data/__tests__/chart.test.ts`
Expected: FAIL — `vizToPlot` not exported (current Chart.tsx is the stub).

- [ ] **Step 3: Replace `Chart.tsx` with the real implementation**

Replace `editor/canvases/data/Chart.tsx`:

```tsx
import React, { useEffect, useRef } from "react";
import * as Plot from "@observablehq/plot";
import type { Viz } from "../../../src/data/schema";

type Row = Array<string | number | boolean | null | unknown>;

export type PlotPlan =
  | { kind: "table" }
  | { kind: "hint"; message: string }
  | {
      kind: "plot";
      data: Record<string, unknown>[];
      markType: "bar" | "line" | "scatter";
      x: string;
      y: string;
      color?: string;
    };

/** Decide how to render a result for a given viz spec. Pure — unit-tested. */
export function vizToPlot(viz: Viz, columns: string[], rows: Row[]): PlotPlan {
  if (viz.type === "table") return { kind: "table" };
  if (!viz.x || !viz.y || !columns.includes(viz.x) || !columns.includes(viz.y)) {
    return { kind: "hint", message: "Pick x and y columns present in the result." };
  }
  const markType = viz.type; // bar | line | scatter
  const data = rows.map((r) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((c, i) => { obj[c] = r[i]; });
    return obj;
  });
  const plan: PlotPlan = { kind: "plot", data, markType, x: viz.x, y: viz.y };
  if (viz.color && columns.includes(viz.color)) plan.color = viz.color;
  return plan;
}

function buildPlot(plan: Extract<PlotPlan, { kind: "plot" }>): (HTMLElement | SVGSVGElement) {
  const opts = { x: plan.x, y: plan.y, ...(plan.color ? { fill: plan.color, stroke: plan.color } : {}) };
  const mark =
    plan.markType === "bar" ? Plot.barY(plan.data, { x: plan.x, y: plan.y, ...(plan.color ? { fill: plan.color } : {}) })
    : plan.markType === "line" ? Plot.line(plan.data, { x: plan.x, y: plan.y, ...(plan.color ? { stroke: plan.color } : {}) })
    : Plot.dot(plan.data, { x: plan.x, y: plan.y, ...(plan.color ? { stroke: plan.color } : {}) });
  return Plot.plot({ marks: [mark], width: 640, height: 360, marginLeft: 60, marginBottom: 50, style: { background: "transparent", color: "currentColor" } });
}

export const ChartView: React.FC<{ viz: Viz; columns: string[]; rows: Row[] }> = ({ viz, columns, rows }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const plan = vizToPlot(viz, columns, rows);
  useEffect(() => {
    if (plan.kind !== "plot" || !ref.current) return;
    const node = buildPlot(plan);
    ref.current.innerHTML = "";
    ref.current.append(node);
    return () => { if (ref.current) ref.current.innerHTML = ""; };
  }, [JSON.stringify(plan)]);
  if (plan.kind === "table") return <div className="text-sm text-muted-foreground">Switch viz type to chart in the cell.</div>;
  if (plan.kind === "hint") return <div className="text-sm text-muted-foreground">{plan.message}</div>;
  return <div ref={ref} className="text-foreground" />;
};
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- editor/canvases/data/__tests__/chart.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Full verification**

Run: `npm test` → all pass.
Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | tail -20` → no errors.
Run: `npm run build:editor 2>&1 | tail -15` → build succeeds.
Run: `cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10` → Finished.

- [ ] **Step 6: Commit**

```bash
git add editor/canvases/data/Chart.tsx editor/canvases/data/__tests__/chart.test.ts
git commit -m "feat(data): Observable Plot chart view from viz spec

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** Backend engine (Task 1) ✓; DataCanvas detection + seed + skill bundle (Task 2) ✓; query.json schema (Task 3) ✓; frontend plugin + manifest + resolveCanvas (Task 4) ✓; DataApp sessions list + SQL cell + grid (Task 5) ✓; chart view (Task 4 of spec / Task 6 here) ✓; doc-driven agent access via skill + query.json editing ✓ (no MCP). Out-of-scope items (full properties-panel viz controls, automatic `last_result.json`, source staging) are documented in the spec as steps 5–7 and intentionally excluded from this slice — noted, not gaps.

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. The two "verify icon name / adapt crate method" notes are explicit fallback instructions with a concrete check, not placeholders.

**Type consistency:** `QueryResult { columns, rows, rowCount, truncated }` matches between Task 1 (Rust `#[serde(rename_all="camelCase")]`) and Task 5 (`QueryResult` TS type). `Viz`/`QueryDoc`/`DataSource` from Task 3 used consistently in Tasks 4–6. `vizToPlot` signature in Task 6 test matches its implementation. `dataCanvas`/`DataApp`/`ChartView` names consistent across tasks. `data_open_source`/`data_run_sql`/`data_schema` param names (`projectPath`, `path`, `kind`, `sql`) consistent between Rust commands and `invoke` calls.

**Task-ordering note (important for execution):** Tasks 4 and 5 have a circular import at the wiring level (`apps.ts` imports `DataApp`; `DataApp` imports `Chart`). Execute in this order to keep each `tsc`/build green: **Task 1 → 2 → 3 → 5 (incl. Chart stub) → 4 → 6**. Task 5's stub `Chart.tsx` lets Task 4's build pass; Task 6 replaces the stub. Each commit remains independently green in that order.
