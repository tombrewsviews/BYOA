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
