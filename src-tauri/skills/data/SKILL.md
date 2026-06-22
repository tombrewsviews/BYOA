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
