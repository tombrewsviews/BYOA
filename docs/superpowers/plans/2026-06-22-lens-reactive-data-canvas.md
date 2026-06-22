# Lens — Reactive Data Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Data Explorer (app id `data`) into **Lens**: a reactive node-graph data canvas where nodes are source / SQL / semantic-AI / chart, wired into a live DAG that the agent and human co-author, with semantic ops running locally through the user's own agent CLI.

**Architecture:** The artifact `query.json` becomes a v2 graph (nodes + edges). A backend evaluator computes node results in topological order over DuckDB, recomputing only the dirty subgraph; SQL nodes reference upstream via `{{nodeId}}` view templating; semantic nodes shell out to `claude -p` (batched, capped) and add an AI-derived column that downstream nodes consume. The frontend is a React Flow canvas + per-node properties inspector; both round-trip every field through `query.json`.

**Tech Stack:** Rust + Tauri 2, `duckdb` crate (already added, bundled), React + TypeScript, zod v4, `@xyflow/react` (React Flow 12), `@observablehq/plot` (already installed), vitest.

## Global Constraints

- Branch: `feat/duckdb-data-explorer` (continues). Commit per task.
- App id / canvas id / Rust canvas id stay `"data"`; doc filename stays `query.json` (content is now a v2 graph). `for_project` detection unchanged.
- Graph doc `version: 2`. Node kinds exactly: `source | sql | semantic | chart`. Semantic ops exactly: `filter | classify | extract | label`.
- SQL nodes reference upstream results by the token `{{nodeId}}` (double braces). At evaluation each upstream result is a temp view named exactly the node id.
- Semantic ops run via the user's agent CLI (`claude -p --output-format json`), batched into ONE call per node evaluation, capped at `sampleLimit` rows (default 50, hard max 200). NO API keys, NO network beyond what the user's own CLI does. NO new credentials.
- VSS / vector embeddings are OUT OF SCOPE.
- Result grid / row cap stays 5000 (from prior work, in `data.rs`).
- macOS only.
- Reactivity = recompute only the dirty node and everything downstream of it.
- Display name is "Lens"; the app manifest `name` becomes "Lens".
- Verify before each commit: `cargo check --manifest-path src-tauri/Cargo.toml`, `npx tsc -p tsconfig.json --noEmit`, `npm test`, and (for frontend tasks) `npm run build:editor`.

## File Structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `src/data/schema.ts` | Rewrite | v2 graph zod schema (nodes/edges) + types + v1→v2 migration |
| `src/data/__tests__/schema.test.ts` | Rewrite | v2 schema + migration tests |
| `src/data/evaluator.ts` | Create | pure topology: toposort, dirty-subgraph, cycle detect, `{{id}}` token extraction |
| `src/data/__tests__/evaluator.test.ts` | Create | topology unit tests |
| `src-tauri/src/data.rs` | Modify | add `data_evaluate` command (source+sql nodes, view templating, materialization, last_result.json) |
| `src-tauri/src/data_semantic.rs` | Create | semantic op: prompt build + agent-CLI spawn + JSON parse |
| `src-tauri/src/lib.rs` | Modify | `mod data_semantic;` + register `data_evaluate` |
| `package.json` | Modify | add `@xyflow/react` |
| `editor/canvases/data/DataApp.tsx` | Rewrite | Root: sessions list + 3-pane editor (agent / graph / inspector) |
| `editor/canvases/data/GraphCanvas.tsx` | Create | React Flow node-graph bound to query.json |
| `editor/canvases/data/nodeTypes.tsx` | Create | node card components per kind |
| `editor/canvases/data/Inspector.tsx` | Create | per-node properties panel |
| `editor/canvases/data/Chart.tsx` | Keep | Observable Plot (reused as-is; consumed by chart node preview) |
| `editor/canvases/data/index.tsx` | Modify | plugin `parse` uses v2 schema + migration; resolveConflict on graph |
| `editor/platform/apps.ts` | Modify | manifest `name` → "Lens", blurb/description updated |
| `src-tauri/templates/seed-query.json` | Rewrite | v2 seed graph (one source placeholder) |
| `src-tauri/skills/data/SKILL.md` | Rewrite | teach graph schema, `{{id}}`, semantic ops |
| `src-tauri/src/canvas.rs` | Modify | `DataCanvas::summarise` counts `nodes` not `cells` |

---

## Task 1: v2 graph schema + migration

**Files:**
- Rewrite: `src/data/schema.ts`
- Rewrite: `src/data/__tests__/schema.test.ts`

**Interfaces:**
- Produces:
  - `graphDocSchema` (zod) and types `GraphDoc`, `GraphNode`, `GraphEdge`, `NodeKind`, `SourceSpec`, `SemanticSpec`, `SemanticOp`, `ChartSpec`, `ChartType`.
  - `NodeKind = "source"|"sql"|"semantic"|"chart"`; `SemanticOp = "filter"|"classify"|"extract"|"label"`; `ChartType = "table"|"bar"|"line"|"scatter"`.
  - `GraphNode = { id:string; kind:NodeKind; title:string; ui:{x:number;y:number}; source?:SourceSpec; sql?:string; semantic?:SemanticSpec; chart?:ChartSpec }`
  - `SourceSpec = { path:string; fileKind:"csv"|"parquet"|"json" }`
  - `SemanticSpec = { op:SemanticOp; inputColumn:string; outputColumn:string; instruction:string; labels:string[]; sampleLimit:number }`
  - `ChartSpec = { type:ChartType; x:string|null; y:string|null; color:string|null }`
  - `GraphEdge = { from:string; to:string }`
  - `GraphDoc = { version:2; nodes:GraphNode[]; edges:GraphEdge[]; selected:string|null }`
  - `migrateToV2(raw:unknown): GraphDoc` — lifts a v1 `{version:1,sources,cells,activeCell}` doc into a graph (each source → source node, each cell → a sql node + a chart node wired source→sql→chart), and passes a v2 doc through unchanged.

- [ ] **Step 1: Write the failing tests**

Rewrite `src/data/__tests__/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { graphDocSchema, migrateToV2 } from "../schema";

const v2doc = {
  version: 2,
  nodes: [
    { id: "n1", kind: "source", title: "Reviews",
      source: { path: "data/r.csv", fileKind: "csv" }, ui: { x: 0, y: 0 } },
    { id: "n2", kind: "semantic", title: "Sentiment",
      semantic: { op: "classify", inputColumn: "body", outputColumn: "sent",
        instruction: "Classify sentiment.", labels: ["pos", "neg"], sampleLimit: 50 },
      ui: { x: 300, y: 0 } },
  ],
  edges: [{ from: "n1", to: "n2" }],
  selected: "n2",
};

describe("graphDocSchema", () => {
  it("parses a v2 graph", () => {
    const d = graphDocSchema.parse(v2doc);
    expect(d.nodes).toHaveLength(2);
    expect(d.nodes[1].semantic?.op).toBe("classify");
    expect(d.edges[0]).toEqual({ from: "n1", to: "n2" });
  });

  it("rejects an unknown node kind", () => {
    expect(() => graphDocSchema.parse({
      version: 2, nodes: [{ id: "x", kind: "frobnicate", title: "x", ui: { x: 0, y: 0 } }],
      edges: [], selected: null,
    })).toThrow();
  });

  it("rejects an unknown semantic op", () => {
    expect(() => graphDocSchema.parse({
      version: 2,
      nodes: [{ id: "x", kind: "semantic", title: "x", ui: { x: 0, y: 0 },
        semantic: { op: "translate", inputColumn: "a", outputColumn: "b",
          instruction: "", labels: [], sampleLimit: 10 } }],
      edges: [], selected: null,
    })).toThrow();
  });
});

describe("migrateToV2", () => {
  it("passes a v2 doc through unchanged", () => {
    expect(migrateToV2(v2doc).version).toBe(2);
    expect(migrateToV2(v2doc).nodes).toHaveLength(2);
  });

  it("lifts a v1 doc into source->sql->chart nodes", () => {
    const v1 = {
      version: 1,
      sources: [{ id: "sales", path: "data/s.csv", kind: "csv" }],
      cells: [{ id: "c1", title: "T", sql: "SELECT * FROM sales",
        viz: { type: "bar", x: "region", y: "total", color: null } }],
      activeCell: "c1",
    };
    const g = migrateToV2(v1);
    expect(g.version).toBe(2);
    const kinds = g.nodes.map((n) => n.kind).sort();
    expect(kinds).toEqual(["chart", "source", "sql"]);
    // there is at least one edge chain connecting them
    expect(g.edges.length).toBeGreaterThanOrEqual(2);
  });

  it("migrates an empty v1 doc to an empty graph", () => {
    const g = migrateToV2({ version: 1, sources: [], cells: [], activeCell: "" });
    expect(g.version).toBe(2);
    expect(g.nodes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npm test -- src/data/__tests__/schema.test.ts`
Expected: FAIL — `graphDocSchema` / `migrateToV2` not exported.

- [ ] **Step 3: Rewrite the schema**

Rewrite `src/data/schema.ts`:

```ts
import { z } from "zod";

export const nodeKindSchema = z.enum(["source", "sql", "semantic", "chart"]);
export type NodeKind = z.infer<typeof nodeKindSchema>;

export const semanticOpSchema = z.enum(["filter", "classify", "extract", "label"]);
export type SemanticOp = z.infer<typeof semanticOpSchema>;

export const chartTypeSchema = z.enum(["table", "bar", "line", "scatter"]);
export type ChartType = z.infer<typeof chartTypeSchema>;

export const sourceSpecSchema = z.object({
  path: z.string(),
  fileKind: z.enum(["csv", "parquet", "json"]),
});
export type SourceSpec = z.infer<typeof sourceSpecSchema>;

export const semanticSpecSchema = z.object({
  op: semanticOpSchema,
  inputColumn: z.string(),
  outputColumn: z.string(),
  instruction: z.string(),
  labels: z.array(z.string()),
  sampleLimit: z.number(),
});
export type SemanticSpec = z.infer<typeof semanticSpecSchema>;

export const chartSpecSchema = z.object({
  type: chartTypeSchema,
  x: z.string().nullable(),
  y: z.string().nullable(),
  color: z.string().nullable(),
});
export type ChartSpec = z.infer<typeof chartSpecSchema>;

export const graphNodeSchema = z.object({
  id: z.string(),
  kind: nodeKindSchema,
  title: z.string(),
  ui: z.object({ x: z.number(), y: z.number() }),
  source: sourceSpecSchema.optional(),
  sql: z.string().optional(),
  semantic: semanticSpecSchema.optional(),
  chart: chartSpecSchema.optional(),
});
export type GraphNode = z.infer<typeof graphNodeSchema>;

export const graphEdgeSchema = z.object({ from: z.string(), to: z.string() });
export type GraphEdge = z.infer<typeof graphEdgeSchema>;

export const graphDocSchema = z.object({
  version: z.literal(2),
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  selected: z.string().nullable(),
});
export type GraphDoc = z.infer<typeof graphDocSchema>;

/** Lift a v1 {sources,cells} doc into a v2 graph; pass v2 through unchanged. */
export function migrateToV2(raw: unknown): GraphDoc {
  const obj = raw as { version?: number };
  if (obj?.version === 2) return graphDocSchema.parse(raw);

  // v1 shape
  const v1 = raw as {
    sources?: Array<{ id: string; path: string; kind: "csv" | "parquet" | "json" }>;
    cells?: Array<{ id: string; title: string; sql: string;
      viz: { type: ChartType; x: string | null; y: string | null; color: string | null } }>;
  };
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let y = 0;
  const sourceIds = (v1.sources ?? []).map((s) => {
    const id = `src_${s.id}`;
    nodes.push({ id, kind: "source", title: s.id,
      source: { path: s.path, fileKind: s.kind }, ui: { x: 0, y } });
    y += 140;
    return id;
  });
  (v1.cells ?? []).forEach((c, i) => {
    const sqlId = `sql_${c.id}`;
    const chartId = `chart_${c.id}`;
    nodes.push({ id: sqlId, kind: "sql", title: c.title, sql: c.sql,
      ui: { x: 300, y: i * 140 } });
    nodes.push({ id: chartId, kind: "chart", title: `${c.title} chart`,
      chart: c.viz, ui: { x: 600, y: i * 140 } });
    // wire every source into the first sql cell (best-effort lineage)
    sourceIds.forEach((sid) => edges.push({ from: sid, to: sqlId }));
    edges.push({ from: sqlId, to: chartId });
  });
  return { version: 2, nodes, edges, selected: nodes[0]?.id ?? null };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- src/data/__tests__/schema.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/schema.ts src/data/__tests__/schema.test.ts
git commit -m "feat(lens): v2 graph schema + v1->v2 migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Pure evaluator topology

**Files:**
- Create: `src/data/evaluator.ts`
- Create: `src/data/__tests__/evaluator.test.ts`

**Interfaces:**
- Consumes: `GraphDoc`, `GraphNode` (Task 1).
- Produces:
  - `topoOrder(doc: GraphDoc): string[]` — node ids in dependency order; throws `Error("cycle detected")` if the graph has a cycle.
  - `dirtySubgraph(doc: GraphDoc, changedId: string): string[]` — `changedId` plus all transitively-downstream node ids, in topo order.
  - `upstreamIds(doc: GraphDoc, nodeId: string): string[]` — direct upstream node ids (edges where `to === nodeId`), in stable order.
  - `sqlTokenRefs(sql: string): string[]` — node ids referenced via `{{id}}` tokens, de-duplicated, in first-seen order.

- [ ] **Step 1: Write the failing tests**

Create `src/data/__tests__/evaluator.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { topoOrder, dirtySubgraph, upstreamIds, sqlTokenRefs } from "../evaluator";
import type { GraphDoc } from "../schema";

const doc: GraphDoc = {
  version: 2,
  nodes: [
    { id: "a", kind: "source", title: "A", ui: { x: 0, y: 0 } },
    { id: "b", kind: "sql", title: "B", sql: "SELECT * FROM {{a}}", ui: { x: 1, y: 0 } },
    { id: "c", kind: "chart", title: "C", ui: { x: 2, y: 0 } },
  ],
  edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
  selected: null,
};

describe("topoOrder", () => {
  it("orders dependencies before dependents", () => {
    expect(topoOrder(doc)).toEqual(["a", "b", "c"]);
  });
  it("throws on a cycle", () => {
    const cyclic: GraphDoc = { ...doc,
      edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }] };
    expect(() => topoOrder(cyclic)).toThrow(/cycle/i);
  });
});

describe("dirtySubgraph", () => {
  it("returns changed node + all downstream in topo order", () => {
    expect(dirtySubgraph(doc, "b")).toEqual(["b", "c"]);
  });
  it("a leaf change is just itself", () => {
    expect(dirtySubgraph(doc, "c")).toEqual(["c"]);
  });
  it("a root change is the whole chain", () => {
    expect(dirtySubgraph(doc, "a")).toEqual(["a", "b", "c"]);
  });
});

describe("upstreamIds", () => {
  it("returns direct upstreams", () => {
    expect(upstreamIds(doc, "b")).toEqual(["a"]);
    expect(upstreamIds(doc, "a")).toEqual([]);
  });
});

describe("sqlTokenRefs", () => {
  it("extracts {{id}} refs, de-duplicated, first-seen order", () => {
    expect(sqlTokenRefs("SELECT * FROM {{a}} JOIN {{b}} ON 1 JOIN {{a}} x"))
      .toEqual(["a", "b"]);
  });
  it("returns empty for plain sql", () => {
    expect(sqlTokenRefs("SELECT 1")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `npm test -- src/data/__tests__/evaluator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/data/evaluator.ts`:

```ts
import type { GraphDoc } from "./schema";

/** Direct upstream node ids of `nodeId` (edges whose `to` is nodeId). */
export function upstreamIds(doc: GraphDoc, nodeId: string): string[] {
  return doc.edges.filter((e) => e.to === nodeId).map((e) => e.from);
}

/** Direct downstream node ids (edges whose `from` is nodeId). */
function downstreamIds(doc: GraphDoc, nodeId: string): string[] {
  return doc.edges.filter((e) => e.from === nodeId).map((e) => e.to);
}

/** Topologically sort node ids; throws on a cycle. Kahn's algorithm. */
export function topoOrder(doc: GraphDoc): string[] {
  const ids = doc.nodes.map((n) => n.id);
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const e of doc.edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  const out: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(id);
    for (const d of downstreamIds(doc, id)) {
      const n = (indeg.get(d) ?? 0) - 1;
      indeg.set(d, n);
      if (n === 0) queue.push(d);
    }
  }
  if (out.length !== ids.length) throw new Error("cycle detected in graph");
  return out;
}

/** The changed node plus everything transitively downstream, in topo order. */
export function dirtySubgraph(doc: GraphDoc, changedId: string): string[] {
  const dirty = new Set<string>([changedId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of doc.edges) {
      if (dirty.has(e.from) && !dirty.has(e.to)) {
        dirty.add(e.to);
        grew = true;
      }
    }
  }
  return topoOrder(doc).filter((id) => dirty.has(id));
}

/** Node ids referenced via {{id}} tokens, de-duped, first-seen order. */
export function sqlTokenRefs(sql: string): string[] {
  const out: string[] = [];
  const re = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- src/data/__tests__/evaluator.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/evaluator.ts src/data/__tests__/evaluator.test.ts
git commit -m "feat(lens): pure evaluator topology (toposort, dirty subgraph, token refs)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Backend evaluator (source + sql nodes)

**Files:**
- Modify: `src-tauri/src/data.rs` (add `data_evaluate`; keep existing commands)
- Modify: `src-tauri/src/lib.rs` (register `data_evaluate`)
- Modify: `src-tauri/src/canvas.rs` (`summarise` counts `nodes`)

**Interfaces:**
- Consumes: existing `with_conn`, `run_columns_of`, `value_to_json`, `resolve_path`, `read_fn`, `sanitize_id`, `Column`, `ROW_CAP` in `data.rs`.
- Produces: Tauri command
  `data_evaluate(projectPath: string, graphJson: string) -> EvalReport`
  where `EvalReport = { nodes: { [id]: NodeResult } }` and
  `NodeResult = { columns: {name,type}[], rows: JsonValue[][], rowCount: number, truncated: boolean, error: string | null }`.
  - For this task, **only `source` and `sql` nodes are evaluated**; `semantic` and `chart` nodes get a passthrough `NodeResult` equal to their single upstream's result (chart) or an `error: "semantic not yet implemented"` placeholder (semantic) — Task 4 replaces the semantic branch.
  - After evaluating, writes `<project>/.kinetic-studio/last_result.json` containing the same `EvalReport` (pretty JSON) so the agent can read pipeline state.

Notes for the implementer:
- Parse `graphJson` with `serde_json::Value` (do NOT add serde structs for the whole graph — read fields off the Value). This keeps the Rust side tolerant of frontend schema additions.
- Evaluate nodes in topological order. Implement a small Rust toposort over the `edges` array (Kahn's, mirroring the TS one). On a cycle, return `Err("cycle detected in graph")`.
- For each `source` node: `CREATE OR REPLACE VIEW "<nodeId>" AS SELECT * FROM <reader>('<abs>')`. The view is named by NODE ID (quoted), not file stem — so downstream `{{nodeId}}` resolves. Then `run_columns_of` for the NodeResult (LIMIT 0 over the node view), and run `SELECT * FROM "<nodeId>" LIMIT <ROW_CAP>` for rows.
- For each `sql` node: substitute every `{{id}}` token in the SQL with `"id"` (the quoted upstream view name — upstream views already exist because we go in topo order), then `CREATE OR REPLACE VIEW "<nodeId>" AS <substituted-sql>`, then read columns + rows like a source. Token regex in Rust: replace `\{\{\s*([A-Za-z0-9_]+)\s*\}\}` with `"$1"`.
- Reuse the executed-statement column-reading pattern already in `data_run_sql` (read columns from the live `Rows` via `rows.as_ref()` AFTER `query()`), to avoid the schema-not-populated panic that was already fixed once.
- `chart` node result = copy of its single upstream's NodeResult (so the frontend can render it); if no upstream, empty result.
- `semantic` node result (this task) = `{ ...empty..., error: "semantic not yet implemented" }`.

- [ ] **Step 1: Write the failing smoke test**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/data.rs`:

```rust
#[test]
fn evaluate_source_then_sql_chain() {
    let dir = tempfile::tempdir().unwrap();
    let csv = dir.path().join("sales.csv");
    std::fs::write(&csv, "region,amount\nw,10\nw,5\ne,20\n").unwrap();
    let abs = csv.to_string_lossy().replace('\'', "''");

    // Build a graph: source(n1) -> sql(n2: aggregate)
    let graph = serde_json::json!({
        "version": 2,
        "nodes": [
            { "id": "n1", "kind": "source", "title": "S",
              "source": { "path": abs, "fileKind": "csv" }, "ui": {"x":0,"y":0} },
            { "id": "n2", "kind": "sql", "title": "Agg",
              "sql": "SELECT region, SUM(amount) AS total FROM {{n1}} GROUP BY 1 ORDER BY 1",
              "ui": {"x":1,"y":0} }
        ],
        "edges": [ { "from": "n1", "to": "n2" } ],
        "selected": null
    });

    let conn = duckdb::Connection::open_in_memory().unwrap();
    let report = evaluate_graph(&conn, dir.path(), &graph).unwrap();
    let n2 = report.get("n2").unwrap();
    assert_eq!(n2.columns.iter().map(|c| c.name.clone()).collect::<Vec<_>>(),
        vec!["region".to_string(), "total".to_string()]);
    assert_eq!(n2.row_count, 2); // e, w
    assert!(n2.error.is_none());
}
```

> The test calls a helper `evaluate_graph(conn, project_dir, &Value) -> Result<HashMap<String, NodeResult>, String>` — factor the real logic into this function so the Tauri command is a thin wrapper that also opens the connection via `with_conn`, serializes the report, and writes `last_result.json`. `NodeResult` must derive `serde::Serialize` and (for the test reading `.error`/`.row_count`/`.columns`) have public fields.

- [ ] **Step 2: Run to confirm fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml data::tests::evaluate 2>&1 | tail -20`
Expected: FAIL to compile — `evaluate_graph` / `NodeResult` not defined.

- [ ] **Step 3: Implement `NodeResult`, `evaluate_graph`, and the command**

Add to `src-tauri/src/data.rs` (after the existing structs / fns; the implementer writes the full bodies per the Notes above). Required shapes:

```rust
#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NodeResult {
    pub columns: Vec<Column>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
    pub truncated: bool,
    pub error: Option<String>,
}

/// Topologically sort node ids from a graph Value's `edges`. Err on cycle.
fn topo_order(nodes: &[serde_json::Value], edges: &[serde_json::Value]) -> Result<Vec<String>, String> {
    use std::collections::HashMap;
    let ids: Vec<String> = nodes.iter()
        .filter_map(|n| n.get("id").and_then(|v| v.as_str()).map(String::from)).collect();
    let mut indeg: HashMap<String, usize> = ids.iter().map(|id| (id.clone(), 0)).collect();
    let edge_pairs: Vec<(String, String)> = edges.iter().filter_map(|e| {
        Some((e.get("from")?.as_str()?.to_string(), e.get("to")?.as_str()?.to_string()))
    }).collect();
    for (_f, t) in &edge_pairs { *indeg.entry(t.clone()).or_insert(0) += 1; }
    let mut queue: Vec<String> = ids.iter().filter(|id| indeg[*id] == 0).cloned().collect();
    let mut out = Vec::new();
    while let Some(id) = queue.pop() {
        out.push(id.clone());
        for (f, t) in &edge_pairs {
            if f == &id {
                let e = indeg.get_mut(t).unwrap();
                *e -= 1;
                if *e == 0 { queue.push(t.clone()); }
            }
        }
    }
    if out.len() != ids.len() { return Err("cycle detected in graph".into()); }
    Ok(out)
}

/// Substitute {{id}} tokens with quoted view names.
fn substitute_tokens(sql: &str) -> String {
    // Replace {{ id }} -> "id"
    let mut result = String::with_capacity(sql.len());
    let bytes = sql.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if i + 1 < bytes.len() && bytes[i] == b'{' && bytes[i + 1] == b'{' {
            if let Some(close) = sql[i + 2..].find("}}") {
                let inner = sql[i + 2..i + 2 + close].trim();
                if !inner.is_empty() && inner.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                    result.push('"');
                    result.push_str(inner);
                    result.push('"');
                    i = i + 2 + close + 2;
                    continue;
                }
            }
        }
        result.push(bytes[i] as char);
        i += 1;
    }
    result
}

/// Read columns + capped rows from a view named `view_id`.
fn read_view(conn: &duckdb::Connection, view_id: &str) -> Result<(Vec<Column>, Vec<Vec<serde_json::Value>>, bool), String> {
    let sql = format!("SELECT * FROM \"{view_id}\" LIMIT {}", ROW_CAP + 1);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut rows_iter = stmt.query([]).map_err(|e| e.to_string())?;
    let columns: Vec<Column> = rows_iter.as_ref().map(columns_of).unwrap_or_default();
    let ncols = columns.len();
    let mut rows = Vec::new();
    let mut truncated = false;
    while let Some(row) = rows_iter.next().map_err(|e| e.to_string())? {
        if rows.len() >= ROW_CAP { truncated = true; break; }
        let mut out = Vec::with_capacity(ncols);
        for i in 0..ncols { out.push(value_to_json(row, i)); }
        rows.push(out);
    }
    Ok((columns, rows, truncated))
}

/// Evaluate source + sql nodes in topo order; chart=passthrough of upstream;
/// semantic=placeholder error (Task 4 replaces). Returns per-node results.
pub fn evaluate_graph(
    conn: &duckdb::Connection,
    project_dir: &std::path::Path,
    graph: &serde_json::Value,
) -> Result<std::collections::HashMap<String, NodeResult>, String> {
    use std::collections::HashMap;
    let empty: Vec<serde_json::Value> = vec![];
    let nodes = graph.get("nodes").and_then(|v| v.as_array()).unwrap_or(&empty);
    let edges = graph.get("edges").and_then(|v| v.as_array()).unwrap_or(&empty);
    let order = topo_order(nodes, edges)?;
    let by_id: HashMap<String, &serde_json::Value> = nodes.iter()
        .filter_map(|n| Some((n.get("id")?.as_str()?.to_string(), n))).collect();
    let upstream = |id: &str| -> Vec<String> {
        edges.iter().filter_map(|e| {
            let f = e.get("from")?.as_str()?; let t = e.get("to")?.as_str()?;
            if t == id { Some(f.to_string()) } else { None }
        }).collect()
    };
    let mut out: HashMap<String, NodeResult> = HashMap::new();
    for id in &order {
        let node = match by_id.get(id) { Some(n) => n, None => continue };
        let kind = node.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        let mut nr = NodeResult::default();
        let result: Result<(), String> = (|| {
            match kind {
                "source" => {
                    let src = node.get("source").ok_or("source node missing source spec")?;
                    let path = src.get("path").and_then(|v| v.as_str()).ok_or("source missing path")?;
                    let file_kind = src.get("fileKind").and_then(|v| v.as_str()).unwrap_or("csv");
                    let reader = read_fn(file_kind)?;
                    let abs = resolve_path(&project_dir.to_string_lossy(), path);
                    let abs_str = abs.to_string_lossy().replace('\'', "''");
                    conn.execute_batch(&format!(
                        "CREATE OR REPLACE VIEW \"{id}\" AS SELECT * FROM {reader}('{abs_str}');"
                    )).map_err(|e| e.to_string())?;
                }
                "sql" => {
                    let raw_sql = node.get("sql").and_then(|v| v.as_str()).unwrap_or("");
                    let sub = substitute_tokens(raw_sql);
                    conn.execute_batch(&format!("CREATE OR REPLACE VIEW \"{id}\" AS {sub};"))
                        .map_err(|e| e.to_string())?;
                }
                "chart" => {
                    // passthrough: alias the single upstream's view
                    if let Some(up) = upstream(id).first() {
                        conn.execute_batch(&format!("CREATE OR REPLACE VIEW \"{id}\" AS SELECT * FROM \"{up}\";"))
                            .map_err(|e| e.to_string())?;
                    } else {
                        return Ok(()); // empty result
                    }
                }
                "semantic" => {
                    nr.error = Some("semantic not yet implemented".into());
                    return Ok(());
                }
                _ => { nr.error = Some(format!("unknown node kind: {kind}")); return Ok(()); }
            }
            let (columns, rows, truncated) = read_view(conn, id)?;
            nr.row_count = rows.len();
            nr.columns = columns;
            nr.rows = rows;
            nr.truncated = truncated;
            Ok(())
        })();
        if let Err(e) = result { nr.error = Some(e); }
        out.insert(id.clone(), nr);
    }
    Ok(out)
}

#[tauri::command]
pub fn data_evaluate(
    project_path: String,
    graph_json: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let graph: serde_json::Value = serde_json::from_str(&graph_json)
        .map_err(|e| format!("parse graph: {e}"))?;
    let project_dir = std::path::PathBuf::from(&project_path);
    let report = with_conn(&state.data_engine, &project_path, |conn| {
        evaluate_graph(conn, &project_dir, &graph)
    })?;
    let value = serde_json::json!({ "nodes": report });
    // Write last_result.json for the agent to perceive pipeline state.
    let meta = project_dir.join(".kinetic-studio");
    let _ = std::fs::create_dir_all(&meta);
    if let Ok(pretty) = serde_json::to_string_pretty(&value) {
        let _ = std::fs::write(meta.join("last_result.json"), pretty);
    }
    Ok(value)
}
```

- [ ] **Step 4: Register the command in lib.rs**

In `src-tauri/src/lib.rs`, add `data::data_evaluate,` to the `generate_handler!` list (next to the other `data::` commands).

- [ ] **Step 5: Update summarise in canvas.rs**

In `src-tauri/src/canvas.rs`, in `DataCanvas::summarise`, change the JSON key read from `"cells"` to `"nodes"`:

```rust
.and_then(|v| v.get("nodes").and_then(|b| b.as_array()).map(|a| a.len()))
```

- [ ] **Step 6: Run the smoke test + check**

Run: `cargo test --manifest-path src-tauri/Cargo.toml data::tests::evaluate 2>&1 | tail -20`
Expected: `evaluate_source_then_sql_chain` PASS.
Run: `cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10`
Expected: Finished, no errors.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/data.rs src-tauri/src/lib.rs src-tauri/src/canvas.rs
git commit -m "feat(lens): backend reactive evaluator (source + sql nodes, {{id}} templating)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Semantic node (agent-CLI op)

**Files:**
- Create: `src-tauri/src/data_semantic.rs`
- Modify: `src-tauri/src/lib.rs` (`mod data_semantic;`)
- Modify: `src-tauri/src/data.rs` (semantic branch in `evaluate_graph` calls into `data_semantic`)

**Interfaces:**
- Consumes: `NodeResult`, `Column` from `data.rs`.
- Produces (in `data_semantic.rs`), all pure except `run_semantic`:
  - `pub fn build_prompt(op: &str, instruction: &str, labels: &[String], input_col: &str, output_col: &str, rows: &[serde_json::Value]) -> String` — builds ONE batched prompt instructing the model to return a JSON array of `{ "<output_col>": value }` (or for `filter`, `{ "<output_col>": true|false }`), one per input row, in order.
  - `pub fn parse_response(text: &str, output_col: &str, n: usize) -> Result<Vec<serde_json::Value>, String>` — extracts the JSON array from the model's (possibly chatty) output, validates length `n`, returns the per-row output values.
  - `pub fn run_semantic(input_values: Vec<serde_json::Value>, op: &str, instruction: &str, labels: &[String], input_col: &str, output_col: &str) -> Result<Vec<serde_json::Value>, String>` — builds the prompt, spawns `claude -p --output-format text <prompt>` (env inherited like agent_chat.rs; stdin null), captures stdout, calls `parse_response`. On spawn failure returns a clear `Err`.

Notes:
- The semantic branch in `evaluate_graph` (replacing the placeholder): take the single upstream's NodeResult; slice its rows to `sampleLimit` (clamp 1..=200, default 50); pull the `inputColumn` value from each row (by matching the upstream column index for `inputColumn`); call `run_semantic`; then build a NEW result = upstream rows (the sampled subset) with the `outputColumn` appended as an extra column; for `filter`, keep only rows whose output is truthy. Materialize is NOT required for the slice (downstream of semantic can read the NodeResult directly in the UI); but to keep SQL-after-semantic working, also `CREATE OR REPLACE VIEW "<id>"` from a VALUES list of the augmented rows IF feasible — for this slice, skip the view for semantic (document it) and have a chart/sql node downstream of a semantic node show "connect to a source or sql node" if it can't find a view. Keep the slice honest: semantic output is visible on the node + in `last_result.json`; SQL-on-semantic is a later refinement.
- Use `std::process::Command::new("claude")` with args `["-p", "--output-format", "text", &prompt]`, inherit env, `stdin(null)`, capture `output()`. (Matching agent_chat.rs's env-inherit so auth resolves.)

- [ ] **Step 1: Write failing tests for the pure functions**

Create `src-tauri/src/data_semantic.rs` test module first — but since the module doesn't exist, create the file with a stub + tests:

```rust
//! Semantic (AI) data operators — run a batched op over sampled rows via the
//! user's own agent CLI (claude -p). BYOA, no new credentials.

use serde_json::Value;

pub fn build_prompt(
    op: &str, instruction: &str, labels: &[String],
    input_col: &str, output_col: &str, rows: &[Value],
) -> String {
    let mut s = String::new();
    s.push_str("You are a precise data operator. ");
    match op {
        "classify" => {
            s.push_str(&format!(
                "Classify each item. Allowed labels: {}. ", labels.join(", ")));
        }
        "filter" => {
            s.push_str("Decide for each item whether it matches the instruction (true/false). ");
        }
        "extract" => { s.push_str("Extract the requested value from each item. "); }
        "label" => { s.push_str("Produce a short label for each item. "); }
        _ => { s.push_str("Process each item. "); }
    }
    s.push_str(&format!("Instruction: {instruction}\n"));
    s.push_str(&format!(
        "Input column: {input_col}. For EACH of the {} items below, return one JSON object \
         {{\"{output_col}\": <value>}}",
        rows.len()));
    if op == "filter" { s.push_str(" where <value> is a boolean"); }
    s.push_str(&format!(
        ". Return ONLY a JSON array of exactly {} objects, in the same order, no prose.\n\nItems:\n",
        rows.len()));
    for (i, r) in rows.iter().enumerate() {
        let v = r.get(input_col).cloned().unwrap_or(Value::Null);
        s.push_str(&format!("{}. {}\n", i + 1, v));
    }
    s
}

pub fn parse_response(text: &str, output_col: &str, n: usize) -> Result<Vec<Value>, String> {
    let start = text.find('[').ok_or("no JSON array in model output")?;
    let end = text.rfind(']').ok_or("no JSON array end in model output")?;
    if end < start { return Err("malformed JSON array in model output".into()); }
    let arr: Vec<Value> = serde_json::from_str(&text[start..=end])
        .map_err(|e| format!("parse model JSON: {e}"))?;
    if arr.len() != n {
        return Err(format!("model returned {} items, expected {}", arr.len(), n));
    }
    Ok(arr.into_iter()
        .map(|o| o.get(output_col).cloned().unwrap_or(Value::Null))
        .collect())
}

pub fn run_semantic(
    input_values: Vec<Value>, op: &str, instruction: &str, labels: &[String],
    input_col: &str, output_col: &str,
) -> Result<Vec<Value>, String> {
    // Wrap each input value as an object keyed by input_col so build_prompt is uniform.
    let rows: Vec<Value> = input_values.into_iter()
        .map(|v| serde_json::json!({ input_col: v })).collect();
    let n = rows.len();
    if n == 0 { return Ok(vec![]); }
    let prompt = build_prompt(op, instruction, labels, input_col, output_col, &rows);

    let mut cmd = std::process::Command::new("claude");
    cmd.args(["-p", "--output-format", "text", &prompt]);
    for (k, v) in std::env::vars() { cmd.env(k, v); }
    cmd.stdin(std::process::Stdio::null());
    let output = cmd.output()
        .map_err(|e| format!("could not run the agent CLI (claude): {e}. Is it installed?"))?;
    if !output.status.success() {
        return Err(format!("agent CLI failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    parse_response(&text, output_col, n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn build_prompt_includes_labels_and_count() {
        let rows = vec![json!({"body": "great"}), json!({"body": "awful"})];
        let p = build_prompt("classify", "sentiment", &["pos".into(), "neg".into()],
            "body", "sent", &rows);
        assert!(p.contains("pos, neg"));
        assert!(p.contains("exactly 2 objects"));
        assert!(p.contains("great"));
        assert!(p.contains("\"sent\""));
    }

    #[test]
    fn parse_response_extracts_values_in_order() {
        let text = "Sure! Here you go:\n[{\"sent\":\"pos\"},{\"sent\":\"neg\"}]\nDone.";
        let vals = parse_response(text, "sent", 2).unwrap();
        assert_eq!(vals, vec![json!("pos"), json!("neg")]);
    }

    #[test]
    fn parse_response_rejects_wrong_count() {
        let text = "[{\"sent\":\"pos\"}]";
        assert!(parse_response(text, "sent", 2).is_err());
    }
}
```

- [ ] **Step 2: Register module + run tests (fail→pass)**

In `src-tauri/src/lib.rs` add `mod data_semantic;` near the other `mod` lines.
Run: `cargo test --manifest-path src-tauri/Cargo.toml data_semantic:: 2>&1 | tail -15`
Expected: 3 tests PASS (the module above is already complete, so this is green on first run — that's fine; the pure functions are the deliverable).

- [ ] **Step 3: Wire the semantic branch in `evaluate_graph`**

In `src-tauri/src/data.rs`, replace the semantic placeholder branch with a real one that: finds the single upstream NodeResult already computed in `out`; locates `inputColumn`'s index in the upstream columns; collects up to `sampleLimit` (clamp 1..=200) input values; calls `crate::data_semantic::run_semantic(...)`; builds `nr.columns` = upstream columns + `{ name: outputColumn, type: "VARCHAR" }`, `nr.rows` = the sampled upstream rows each with the op output appended (for `filter`, keep only truthy). On any error set `nr.error`. (The implementer writes this against the `out: HashMap<String, NodeResult>` already in scope; read the semantic spec fields off the node Value.)

```rust
"semantic" => {
    let spec = node.get("semantic").ok_or("semantic node missing spec")?;
    let op = spec.get("op").and_then(|v| v.as_str()).unwrap_or("label");
    let instruction = spec.get("instruction").and_then(|v| v.as_str()).unwrap_or("");
    let input_col = spec.get("inputColumn").and_then(|v| v.as_str()).unwrap_or("");
    let output_col = spec.get("outputColumn").and_then(|v| v.as_str()).unwrap_or("result");
    let labels: Vec<String> = spec.get("labels").and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let sample_limit = spec.get("sampleLimit").and_then(|v| v.as_u64()).unwrap_or(50)
        .clamp(1, 200) as usize;
    let up_id = upstream(id).into_iter().next().ok_or("semantic node needs an upstream")?;
    let up = out.get(&up_id).ok_or("upstream not evaluated")?;
    let col_idx = up.columns.iter().position(|c| c.name == input_col)
        .ok_or_else(|| format!("input column '{input_col}' not in upstream"))?;
    let take = up.rows.len().min(sample_limit);
    let input_values: Vec<serde_json::Value> =
        up.rows.iter().take(take).map(|r| r[col_idx].clone()).collect();
    let outputs = crate::data_semantic::run_semantic(
        input_values, op, instruction, &labels, input_col, output_col)?;
    let mut cols = up.columns.clone();
    cols.push(Column { name: output_col.to_string(), r#type: "VARCHAR".to_string() });
    let mut rows = Vec::new();
    for (i, r) in up.rows.iter().take(take).enumerate() {
        let o = outputs.get(i).cloned().unwrap_or(serde_json::Value::Null);
        if op == "filter" {
            let keep = o.as_bool().unwrap_or(false);
            if !keep { continue; }
        }
        let mut row = r.clone();
        row.push(o);
        rows.push(row);
    }
    nr.row_count = rows.len();
    nr.columns = cols;
    nr.rows = rows;
    return Ok(());
}
```

> Note: this branch must run AFTER upstreams (guaranteed by topo order) and BEFORE the generic `read_view` tail — so it `return Ok(())`s itself, like the chart-no-upstream early return.

- [ ] **Step 4: Verify**

Run: `cargo test --manifest-path src-tauri/Cargo.toml data 2>&1 | tail -20`
Expected: all `data::` and `data_semantic::` tests pass (the source→sql smoke test still green; semantic pure-fn tests green). The live `claude` call is NOT tested here (no network in tests) — only the pure prompt/parse paths.
Run: `cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10` → Finished.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/data_semantic.rs src-tauri/src/lib.rs src-tauri/src/data.rs
git commit -m "feat(lens): semantic AI nodes via the user's agent CLI (batched, capped)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: React Flow canvas + DataApp 3-pane rewrite

**Files:**
- Modify: `package.json` (add `@xyflow/react`)
- Rewrite: `editor/canvases/data/DataApp.tsx`
- Create: `editor/canvases/data/GraphCanvas.tsx`
- Create: `editor/canvases/data/nodeTypes.tsx`
- Modify: `editor/canvases/data/index.tsx` (parse via `migrateToV2`; resolveConflict on graph)

**Interfaces:**
- Consumes: `GraphDoc`/`graphDocSchema`/`migrateToV2` (Task 1); `data_evaluate` command (Task 3/4) returning `{ nodes: { [id]: NodeResult } }`; `Chat`/`Terminal`/`isTauri`; `projects_*`, `load_doc`, `save_doc`.
- Produces: `export const DataApp` (consumed by apps.ts); `GraphCanvas` (React Flow) emitting node-move / edge-add / select / add-node events up to DataApp which mutates the `GraphDoc` and persists.

This is the integration task. Detailed implementer guidance:
- Install: `npm install @xyflow/react`. Import its CSS: `import "@xyflow/react/dist/style.css";` in GraphCanvas.
- `DataApp` keeps the `SessionsList` entry screen (rename copy to "Lens") and the `DataEditor` becomes a 3-pane flex: left agent panel (Chat/Terminal switch, verbatim from current DataApp), center `GraphCanvas`, right `Inspector` (Task 6 — for THIS task, render a placeholder `<div>` where the Inspector will go, so the task builds independently; Task 6 replaces it).
- `DataEditor` owns `doc: GraphDoc` state, loaded via `load_doc` → `migrateToV2(JSON.parse(raw))`. Debounced `save_doc` on change (same 400ms pattern as before). After load and after any structural change, call `data_evaluate({projectPath, graphJson: JSON.stringify(doc)})` and store the `report.nodes` map; pass each node its `NodeResult` for the card preview.
- `GraphCanvas` maps `doc.nodes` → React Flow nodes (id, position from `ui`, `data: { node, result }`) and `doc.edges` → React Flow edges. Use a single custom node type rendered by `nodeTypes.tsx` (one component that switches on `node.kind` for the card body). Wire callbacks: `onNodesChange` (persist position back to `ui` on drag-stop), `onConnect` (add an edge to the doc, re-evaluate), `onNodeClick` (set `doc.selected`). An "Add node" toolbar (buttons: + Source, + SQL, + Semantic, + Chart) appends a new node at an offset position with sensible defaults and selects it.
- New-node defaults: source `{path:"",fileKind:"csv"}`; sql `{sql:"SELECT * FROM {{upstream}}"}`; semantic `{op:"classify",inputColumn:"",outputColumn:"result",instruction:"",labels:[],sampleLimit:50}`; chart `{type:"table",x:null,y:null,color:null}`.
- The node card (`nodeTypes.tsx`) shows: kind icon + title, then a compact preview — for a node with a `result`: `{rowCount} rows` and the first column names; if `result.error`, show it in red; if no result yet, "not run". Add React Flow `<Handle>` source/target so edges can be drawn.
- `index.tsx`: change `parse` to `migrateToV2(raw)`; change the `Doc` type to `GraphDoc`; `resolveConflict` re-applies the user's `selected` + the selected node's `ui` position + (if the user edited it) the selected node's spec over the agent's doc — keep it simple: agent doc is base, re-apply `user.selected` and the user's position for the selected node. Empty prompt.

- [ ] **Step 1: Install React Flow**

Run: `npm install @xyflow/react`
Expected: added to package.json + lockfile.

- [ ] **Step 2: Write GraphCanvas + nodeTypes + DataApp**

(Full code authored by the implementer per the guidance above; the three files must compile and DataApp must export correctly. Reuse the existing DataApp's `SessionsList`, Chat/Terminal switcher, and load/save/debounce code verbatim — only the right two panes change from grid+chart to graph+inspector-placeholder.)

- [ ] **Step 3: Verify types + build**

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | tail -20` → no errors.
Run: `npm run build:editor 2>&1 | tail -15` → build succeeds.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json editor/canvases/data/DataApp.tsx \
  editor/canvases/data/GraphCanvas.tsx editor/canvases/data/nodeTypes.tsx \
  editor/canvases/data/index.tsx
git commit -m "feat(lens): React Flow node-graph canvas + 3-pane DataApp

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Per-node properties Inspector

**Files:**
- Create: `editor/canvases/data/Inspector.tsx`
- Modify: `editor/canvases/data/DataApp.tsx` (mount `Inspector` in the right pane in place of the placeholder)

**Interfaces:**
- Consumes: `GraphDoc`, `GraphNode`, the per-kind specs (Task 1); the selected node's `NodeResult` (for column pickers); `@observablehq/plot` `ChartView` (existing `Chart.tsx`) for chart-node live preview.
- Produces: `export const Inspector: React.FC<{ doc: GraphDoc; result: NodeResult | null; onChange: (next: GraphDoc) => void }>`.

Detailed guidance:
- Renders the inspector for `doc.selected`. If none, "Select a node."
- Per kind:
  - **source:** path (with a "Choose file…" dialog button → `@tauri-apps/plugin-dialog` `open`, infer fileKind from extension, write `source.path/fileKind`), and the node's result schema (columns + types) + row count read-only.
  - **sql:** a `<textarea>` for `sql` (writes back); a hint listing upstream node ids (from `doc.edges` where `to===selected`) to reference as `{{id}}`; if the node has a result, list its columns.
  - **semantic:** op `<select>` (filter/classify/extract/label); input-column `<select>` populated from the upstream node's result columns; output-column text; instruction `<textarea>`; labels (comma-separated input ↔ string[]); sampleLimit number. All write back into `node.semantic`.
  - **chart:** type `<select>` (table/bar/line/scatter); x/y/color `<select>`s populated from the node's result columns; and a live `ChartView` preview using the node's result rows.
- Every edit calls `onChange(nextDoc)` where the selected node is replaced with the edited copy. DataApp's `onChange` persists + re-evaluates.

- [ ] **Step 1: Write Inspector.tsx + mount it**

(Implementer authors the full component per guidance; replace the Task-5 placeholder in DataApp with `<Inspector doc={doc} result={results[doc.selected ?? ""] ?? null} onChange={persist} />`.)

- [ ] **Step 2: Verify**

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | tail -20` → no errors.
Run: `npm run build:editor 2>&1 | tail -15` → build succeeds.
Run: `npm test` → all pass.

- [ ] **Step 3: Commit**

```bash
git add editor/canvases/data/Inspector.tsx editor/canvases/data/DataApp.tsx
git commit -m "feat(lens): per-node properties inspector (source/sql/semantic/chart)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Skill bundle, seed graph, manifest copy

**Files:**
- Rewrite: `src-tauri/templates/seed-query.json` (v2 seed graph)
- Rewrite: `src-tauri/skills/data/SKILL.md`
- Modify: `src-tauri/src/canvases/data.rs` (CLAUDE.md copy)
- Modify: `editor/platform/apps.ts` (`name` → "Lens", blurb/description/tags)

**Interfaces:** none new; documentation + seed only.

- [ ] **Step 1: Rewrite the seed graph**

Rewrite `src-tauri/templates/seed-query.json`:

```json
{
  "version": 2,
  "nodes": [
    {
      "id": "n1",
      "kind": "source",
      "title": "Add a data source",
      "source": { "path": "", "fileKind": "csv" },
      "ui": { "x": 60, "y": 80 }
    }
  ],
  "edges": [],
  "selected": "n1"
}
```

- [ ] **Step 2: Rewrite the skill**

Rewrite `src-tauri/skills/data/SKILL.md`:

```markdown
---
name: lens
description: Operating manual for Lens — a reactive data canvas. Drive the pipeline by editing query.json (a node graph of source/SQL/semantic/chart nodes).
---

# Lens — reactive data canvas

You are inside a Lens project. The user explores data through a **reactive node
graph**: source → SQL → semantic(AI) → chart nodes, wired by edges. **You
collaborate by editing `./query.json`** (a graph); the canvas recomputes the
affected nodes and re-renders. After each run the app writes
`./.kinetic-studio/last_result.json` with every node's result (columns, sample
rows, row count, error) — read it to see the whole pipeline's state.

## The graph — `query.json`

```jsonc
{
  "version": 2,
  "nodes": [
    { "id": "n1", "kind": "source", "title": "Reviews",
      "source": { "path": "data/reviews.csv", "fileKind": "csv" }, "ui": { "x": 40, "y": 40 } },
    { "id": "n2", "kind": "sql", "title": "Recent",
      "sql": "SELECT * FROM {{n1}} WHERE date > '2026-01-01'", "ui": { "x": 340, "y": 40 } },
    { "id": "n3", "kind": "semantic", "title": "Sentiment",
      "semantic": { "op": "classify", "inputColumn": "body", "outputColumn": "sentiment",
        "instruction": "Classify the review sentiment.", "labels": ["positive","neutral","negative"],
        "sampleLimit": 50 }, "ui": { "x": 640, "y": 40 } },
    { "id": "n4", "kind": "chart", "title": "By sentiment",
      "chart": { "type": "bar", "x": "sentiment", "y": "count", "color": null }, "ui": { "x": 940, "y": 40 } }
  ],
  "edges": [ { "from": "n1", "to": "n2" }, { "from": "n2", "to": "n3" }, { "from": "n3", "to": "n4" } ],
  "selected": "n3"
}
```

## Node kinds

- **source** — a local file. `source.fileKind` ∈ csv | parquet | json.
- **sql** — DuckDB SQL. Reference an upstream node's result with the token
  `{{nodeId}}` (it becomes that node's view). Wire the upstream with an edge.
- **semantic** — an AI op over the upstream rows, run via the user's own agent
  CLI. `op` ∈ filter | classify | extract | label. `inputColumn` is the column
  fed to the model; `outputColumn` is the new column added. `labels` are the
  allowed classes (classify). `sampleLimit` caps how many rows are processed
  (≤200). It adds `outputColumn` to the data so downstream nodes can use it.
- **chart** — Observable Plot. `chart.type` ∈ table | bar | line | scatter;
  x/y/color are column names from the upstream result, or null.

## How to collaborate

- To build a pipeline: add nodes and connect them with edges. Edges define
  dependency and recompute order.
- SQL nodes MUST reference upstreams via `{{id}}` AND have an edge from that
  upstream — both are required.
- Choose a chart that fits the result shape (category+measure → bar; time
  series → line; two measures → scatter).
- Respect the user's edits: read `query.json` (and `last_result.json` for
  current results) before changing anything, so you build on their state.
- Keep SQL DuckDB-flavored. Do NOT INSTALL/LOAD remote extensions or hit the
  network. Semantic ops already use the local agent CLI — don't add API calls.
```

- [ ] **Step 3: Update CLAUDE.md copy**

In `src-tauri/src/canvases/data.rs`, replace the `CLAUDE_MD` const body to describe Lens (graph of source/sql/semantic/chart; edit query.json; `{{id}}` for sql upstreams; semantic op fields; read last_result.json). Keep the `.claude/skills/data/SKILL.md` pointer line.

- [ ] **Step 4: Update the manifest**

In `editor/platform/apps.ts`, in the `data` entry: set `name: "Lens"`, `blurb: "Agent-native reactive data canvas"`, and a `description` explaining the node graph (source/SQL/semantic-AI/chart, reactive, agent co-authors the pipeline, semantic ops run via your own agent CLI). Update `tags` to `["data", "reactive", "ai", "agent-native"]`.

- [ ] **Step 5: Verify**

Run: `cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10` → Finished.
Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | tail -10` → no errors.
Run: `npm run build:editor 2>&1 | tail -10` → build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/templates/seed-query.json src-tauri/skills/data/SKILL.md \
  src-tauri/src/canvases/data.rs editor/platform/apps.ts
git commit -m "feat(lens): seed graph, agent skill, Lens manifest copy

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** v2 graph artifact (Task 1) ✓; reactive evaluator / topology (Task 2 pure + Task 3 backend) ✓; `{{id}}` view templating (Task 3) ✓; semantic ops via agent CLI, batched + capped (Task 4) ✓; `last_result.json` agent perception (Task 3) ✓; React Flow node-graph canvas (Task 5) ✓; per-node properties panel incl. chart encoding controls (Task 6) ✓; Observable Plot reused (Task 6 via existing Chart.tsx) ✓; skill + seed + Lens manifest + v1→v2 migration (Tasks 1 & 7) ✓; VSS explicitly excluded (no task — correct). All spec sections map to a task.

**Placeholder scan:** Pure-code tasks (1,2,3,4) carry complete code. Integration tasks (5,6) give detailed authored-by-implementer guidance with exact interfaces, defaults, and callback contracts rather than full JSX — acceptable because they're large React integration files where the contract (props, state ownership, persist/evaluate loop) is the reviewable surface; the implementer subagent writes idiomatic JSX against the existing DataApp it's told to reuse. No TBD/TODO. The Task-5 Inspector placeholder and Task-6 replacement are an explicit, sequenced handoff (like the prior build's Chart stub), not a placeholder defect.

**Type consistency:** `GraphDoc`/`GraphNode`/`SemanticSpec`/`ChartSpec`/`NodeKind`/`SemanticOp` consistent across Tasks 1,2,5,6. `NodeResult { columns, rows, rowCount, truncated, error }` consistent between Rust (Task 3, camelCase serde) and the frontend consumers (Tasks 5,6). `data_evaluate(projectPath, graphJson)` param names consistent between Rust and invoke calls. `{{id}}` token convention consistent: TS `sqlTokenRefs` (Task 2), Rust `substitute_tokens` (Task 3), skill doc (Task 7). Semantic field names (`op`, `inputColumn`, `outputColumn`, `instruction`, `labels`, `sampleLimit`) consistent between schema (Task 1), evaluator branch (Task 4), inspector (Task 6), skill (Task 7).

**Execution order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 (linear; each task green before the next). Task 5 builds with an Inspector placeholder so it's independently green; Task 6 replaces it.
