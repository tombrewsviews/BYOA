# Lens — reactive agent-authored data canvas (Data Explorer, reimagined)

**Date:** 2026-06-22
**Branch:** continues on `feat/duckdb-data-explorer` (the app keeps id `data`)
**Supersedes:** `2026-06-22-duckdb-data-explorer-design.md` (the SQL-box version)

> Brainstormed and decided solo at the user's explicit instruction ("don't ask
> me questions, rethink and refactor"). This document records the reasoning so
> the decisions are auditable.

## Why the first version fell short

The DuckDB Data Explorer was a SQL box + a result grid + a chart. The agent's
only verb was "write better SQL." That is a chatbot with a database bolted on —
it fails the platform's defining pattern: a **living artifact** the agent and
human co-manipulate, a **properties panel both read and write**, and an engine
that makes the loop feel alive. A query string is not a living artifact.

## The idea — connecting dots that haven't been connected

Four local-first, cutting-edge ideas, each individually agent-friendly, fused
into one artifact for the first time:

1. **DuckDB** — instant local analytical engine over any file (we have it).
2. **Reactive dataflow** (Observable / Marimo lineage) — cells form a directed
   acyclic graph. Change one node and everything downstream recomputes. The
   artifact is a **graph**, not a script.
3. **Semantic operators** (the "LOTUS" / semantic-SQL research line, 2024–25) —
   LLM-powered operators as first-class data ops: filter / classify / extract /
   label rows by *meaning*, not by `WHERE`. Run **locally through the user's own
   agent CLI** (`claude -p`), so: no new credentials, BYOA, offline-capable.
4. **Agent-as-graph-author** — the agent doesn't just edit query text; it edits
   the **graph topology** (adds nodes, wires edges, sets each node's props).

**The unconnected dot:** a reactive node-graph data canvas where a node can be a
**source**, a **SQL transform**, a **semantic (AI) transform**, or a **chart** —
all wired into a live DAG — and both the agent and the human edit the graph and
each node's properties. Nobody has shipped this as a local-first desktop app.

**Name:** **Lens** (display name "Lens"; app id stays `data` for substrate
compatibility — the seed marker stays `query.json` but its content is now a
graph).

## The artifact — `query.json` becomes a reactive graph (`graph.json` content)

We keep the filename `query.json` (so `for_project` detection and all the Rust
wiring built in the previous tasks still work) but its *content* is now a graph:

```jsonc
{
  "version": 2,
  "nodes": [
    { "id": "n1", "kind": "source", "title": "Reviews",
      "source": { "path": "data/reviews.csv", "fileKind": "csv" },
      "ui": { "x": 40, "y": 40 } },

    { "id": "n2", "kind": "sql", "title": "Recent",
      "sql": "SELECT * FROM {{n1}} WHERE date > '2026-01-01'",
      "ui": { "x": 340, "y": 40 } },

    { "id": "n3", "kind": "semantic", "title": "Sentiment",
      "semantic": {
        "op": "classify",
        "inputColumn": "body",
        "outputColumn": "sentiment",
        "instruction": "Classify the review sentiment.",
        "labels": ["positive", "neutral", "negative"],
        "sampleLimit": 50
      },
      "ui": { "x": 640, "y": 40 } },

    { "id": "n4", "kind": "chart", "title": "By sentiment",
      "chart": { "type": "bar", "x": "sentiment", "y": "count", "color": null },
      "ui": { "x": 940, "y": 40 } }
  ],
  "edges": [
    { "from": "n1", "to": "n2" },
    { "from": "n2", "to": "n3" },
    { "from": "n3", "to": "n4" }
  ],
  "selected": "n3"
}
```

- **Edges define dependency.** A node's inputs are its upstream nodes. SQL nodes
  reference upstream by `{{nodeId}}` (templated into a DuckDB view/CTE name at
  run time). A chart/semantic node takes its single upstream's result as input.
- **`{{nodeId}}` templating** is how the graph wires into SQL: at evaluation,
  each upstream result is registered as a temp view named after the node id, and
  `{{n1}}` is substituted with `"n1"`. This makes the graph topology *real* —
  rewire an edge and the SQL resolves to a different upstream automatically.
- Both agent and human edit this file / the panel; the canvas recomputes the
  affected subgraph.

## The engine — reactive evaluator over DuckDB + the agent CLI

A backend **evaluator** computes node results in topological order, recomputing
only the nodes downstream of a change (reactive, not full-rebuild):

- **source node** → register/refresh the DuckDB view (reuses the existing
  `data_open_source` logic).
- **sql node** → register each upstream result as a temp view named by node id,
  substitute `{{id}}` tokens, run via the existing `data_run_sql` path,
  materialize the result as a new temp view named by *this* node's id so
  downstream nodes can consume it.
- **semantic node** → take the upstream result (capped to `sampleLimit` rows),
  build ONE batched prompt ("Here are N rows; for each, do X; return JSON
  array"), invoke the **user's agent CLI** (`claude -p --output-format json`)
  via the same spawn pattern as `agent_chat.rs`, parse the JSON back, and add
  the `outputColumn` to the rows. Materialize as a temp view so SQL/chart nodes
  downstream can use the AI-derived column. This is the headline capability —
  **AI columns become real data the rest of the pipeline operates on.**
- **chart node** → terminal; its upstream result feeds Observable Plot (reuse
  the `vizToPlot` work from the previous build).

The evaluator is the heart. It is a pure-ish function `evaluate(graph,
dirtyNodeId) -> Map<nodeId, NodeResult>` plus the DuckDB/agent side effects,
fully unit-testable on the topology logic (toposort, dirty-subgraph, cycle
detection) independent of the engine.

### Why semantic ops via the agent CLI (not an API key, not a local model)

- BYOA is the platform's whole thesis — the user already has `claude` installed
  and authenticated. Shelling out to `claude -p` reuses that. **No new secrets.**
- Local embedding models / DuckDB-VSS were evaluated and **rejected**: the
  bundled `duckdb` crate ships no VSS extension, and loading remote extensions
  violates the offline/local-first rule. Vector search is therefore **out of
  scope** (a future, separate spec if ever wanted).
- Cost/latency is bounded by `sampleLimit` (default 50, hard cap 200) and a
  single batched call per semantic-node evaluation — not one call per row.

## The canvas (main stage)

A **node-graph editor** — the living artifact:

- Nodes are draggable cards (position persisted in `ui.x/y`); edges are drawn
  between them. Node card shows: title, kind icon, a compact result preview
  (row count + a 3-row sparkline/peek), and a run/refresh affordance.
- Clicking a node selects it (`selected` in the doc) and populates the
  properties panel. Wiring is done by dragging from a node's output port to
  another node's input port (creates an edge; the evaluator re-runs downstream).
- A node's stale/running/error state is shown on the card (border color +
  spinner), so the reactive recompute is visible.
- Built with **React Flow** (`@xyflow/react`) — the cutting-edge,
  battle-tested node-graph lib; far less custom code than hand-rolling pan/zoom/
  edges, and its controlled model (nodes/edges as state) maps cleanly to our
  `graph.json`.

## The properties panel (real, finally)

The right-side inspector, **per selected node**, both human- and agent-editable
(every field round-trips through `query.json`):

- **source:** file path (+ "replace file" dialog), detected schema (columns +
  types), row count.
- **sql:** a SQL editor + the list of available upstream node ids to reference
  as `{{id}}`, and the upstream columns (click to insert).
- **semantic:** the op (filter / classify / extract / label), input column,
  output column name, the natural-language instruction, labels (for classify),
  and `sampleLimit`. **This is where human and agent most visibly co-operate:**
  the human tweaks the instruction; the agent reads it and refines it, or the
  agent authors a new semantic node and the human adjusts the labels.
- **chart:** type + x/y/color encoding (the viz controls deferred in v1 — now
  in scope), choosing from the upstream node's actual columns.

## The agent integration (doc-driven, leveled up)

Same proven loop as Kinetic/the previous build: the agent edits `query.json`;
the canvas evaluates and re-renders. But the agent now operates on **graph
topology**: "add a semantic-classify node downstream of the Recent node, then a
bar chart of the sentiment counts" is three node inserts + two edges in
`query.json`. After each evaluation the backend writes
`.kinetic-studio/last_result.json` (per-node: schema + sample + rowcount +
error) so the agent perceives the *whole pipeline's* state without re-running —
this is the `last_result.json` capability deferred in v1, now delivered. The
skill bundle teaches the graph schema, the `{{id}}` convention, and the semantic
ops.

## How it reuses the substrate

- App id stays `data`; `for_project` detection (`query.json`) unchanged.
- `DataApp` Root is **rewritten** into the node-graph editor (agent panel left;
  React Flow canvas center; properties panel right) but keeps the sessions-list
  entry and the Chat/Terminal panel verbatim.
- Backend gains a `data_evaluate(graph_json)` command (the evaluator) alongside
  the existing `data_open_source` / `data_run_sql` / `data_schema`; the semantic
  path adds a `data_semantic_op` internal that shells to the agent CLI.
- The zod schema (`src/data/schema.ts`) is **rewritten** for the graph
  (`version: 2`); a tiny migration reads a v1 `{cells}` doc and lifts it into a
  one-source-one-sql-one-chart graph so old sessions still open.

## Build order (vertical slice → full)

1. **Graph schema + evaluator core (topology):** rewrite `src/data/schema.ts`
   to v2; pure TS evaluator module — toposort, dirty-subgraph, cycle detect —
   with thorough unit tests. No engine yet. (TS-only; `npm test`.)
2. **Backend evaluator:** `data_evaluate` in Rust — source + sql nodes with
   `{{id}}` view registration + downstream materialization; reuse Task-1 DuckDB
   code. Smoke test over a fixture. Writes `last_result.json`.
3. **Semantic node:** `data_semantic_op` shelling to `claude -p` (batched,
   sampleLimit-capped), JSON parse, add output column, materialize. Test the
   prompt-build + JSON-parse pure functions (mock the CLI).
4. **Canvas (React Flow):** node-graph editor wired to `query.json`; drag nodes,
   draw edges, see per-node state; select → panel.
5. **Properties panel:** per-kind inspectors (source / sql / semantic / chart),
   all writing back to `query.json`.
6. **Chart node + Observable Plot:** reuse `vizToPlot`; encoding controls from
   upstream columns.
7. **Agent skill + `last_result.json` loop + v1→v2 migration.**

Steps 1–4 are the vertical slice that proves the concept end-to-end (load a
file → SQL node → semantic classify node → chart, all reactive). 5–7 complete
it.

## Components & boundaries

| Unit | Responsibility |
|------|----------------|
| `src/data/schema.ts` | v2 graph zod schema + v1→v2 migration |
| `src/data/evaluator.ts` | pure topology: toposort, dirty set, cycle detect |
| `src-tauri/src/data.rs` | `data_evaluate`, `data_semantic_op`, existing cmds |
| `src-tauri/src/data_semantic.rs` | prompt build + agent-CLI spawn + JSON parse |
| `editor/canvases/data/DataApp.tsx` | Root: sessions list + 3-pane editor |
| `editor/canvases/data/GraphCanvas.tsx` | React Flow node-graph |
| `editor/canvases/data/nodes/*.tsx` | node card per kind |
| `editor/canvases/data/Inspector.tsx` | per-node properties panel |
| `editor/canvases/data/Chart.tsx` | Observable Plot (reused) |

## Testing & verification (per step)

`cargo check`/`cargo test`, `npx tsc --noEmit`, `npm test`, `npm run
build:editor` green at each step. Pure modules (evaluator topology, prompt
build, JSON parse, vizToPlot, schema + migration) carry real unit tests; the
engine and CLI spawn get smoke tests with fixtures/mocks.

## Risks / decisions

- **Semantic-op latency/cost** — bounded by one batched, sampleLimit-capped CLI
  call per node evaluation; node shows a spinner; results cache until inputs
  change. Not run on every keystroke — only on explicit run or upstream change.
- **Agent CLI availability** — if `claude` isn't installed/authed, semantic
  nodes surface a clear error on the card; SQL/chart/source nodes work
  regardless. Detected via the existing `detect_agents`.
- **Reactivity scope** — recompute only the dirty subgraph (downstream of the
  changed node), not the whole graph.
- **VSS / embeddings** — explicitly **out of scope** (engine doesn't bundle it;
  offline rule forbids remote extension load).
- **React Flow bundle weight** — accepted; it replaces far more hand-rolled
  canvas code and is the right tool.
- **Back-compat** — v1 `{cells}` docs migrate to a graph on open.
