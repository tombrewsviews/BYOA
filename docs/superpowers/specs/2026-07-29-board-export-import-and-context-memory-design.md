# Board export/import + on-board context memory — design

**Date:** 2026-07-29
**Status:** Approved

## Goal

Two independent features:

1. **Export / import a board as a file.** Export the live board to a standard
   `.excalidraw` file the user can upload to excalidraw.com (to view and share
   with others), and import such a file back into the app — into the current
   board or a newly created one.
2. **On-board context memory.** The agent records the critical context of a
   session (decisions, constraints, docs it was given) as text on the board, in
   a reserved region, and reads it back at the start of the next session. It
   doubles as human-readable documentation for anyone opening the board later.

## Miro: why file export is not offered

The user asked for a Miro file export requiring no OAuth token. **This is not
possible**, and the feature is therefore not built. Recorded here so the
question isn't reopened without the evidence:

- Miro imports exactly one format that yields editable native objects: `.rtb`,
  its own board backup. That format is **proprietary and undocumented** (no
  public spec, no writer library, no stability guarantee) and importing it is
  restricted to **paid teams**.
- The historical bridge — draw.io/`.vsdx` — is dead: draw.io removed VSDX
  export in March 2025.
- SVG/PNG import works on every plan but lands as a **flat, uneditable image**.
  Miro's own community request to make imported SVGs editable has been open
  since July 2020 with no commitment.

So the only route to *editable* Miro content is the REST API with an OAuth
token (`boards:write`). That path was validated (see below) and can be enabled
later, but it is token-gated by Miro's design and no local file format
substitutes for it.

**Validated for future use:** the Apache-2.0 `excalidraw-to-miro` converter was
evaluated against all five of the user's real boards via its dry-run API: 190
unit tests pass, and 4,100 elements converted with zero hard failures (97
"degraded" — arrows/lines with unbound endpoints that get snapped to the
nearest shape — and 1 skip, an image with missing file data). The user's boards
contain **no freedraw**, the one element type with no Miro equivalent. Note its
`preview` CLI subcommand is broken (`-i` is declared on both the root program
and the subcommand, so Commander consumes it at the root and the subcommand
always errors); the library API works and is what an integration would use.

## Feature 1 — Export / import

### Format

The on-disk `board.json` is already nearly `.excalidraw`. Comparing against a
real excalidraw.com file, the differences are:

| | `board.json` | `.excalidraw` |
|---|---|---|
| `type`, `version`, `elements`, `files` | same | same |
| `source` | `brainstorm-canvas` | `https://excalidraw.com` |
| `appState` | absent | `{ gridSize, viewBackgroundColor }` |
| `savedAt` | present (ours) | absent |

Export therefore adds `appState`, drops `savedAt`, and leaves the elements
untouched. Import does the reverse and tolerates both shapes.

### Export

Exports the **live scene**, not `board.json` — the file on disk lags by up to
the autosave debounce, and exporting what the user currently sees is the least
surprising behaviour. Reads `GET /api/elements` + `GET /api/files` (the same
pair `saveBoard` uses), wraps them in the `.excalidraw` envelope, and writes to
a user-chosen path via the Tauri dialog + fs plugins.

Default filename is the board's display name slugified, e.g.
`my-board.excalidraw`.

### Import

Reads a `.excalidraw` file and pushes it into the canvas server with the
**existing** restore path (`POST /api/files` then `POST /api/elements/sync`),
which `restoreBoard` already implements and which is covered by tests.

**Import always creates a NEW board.** The design originally offered "into this
board" as a second destination behind a confirm modal; that was dropped during
implementation. Replacing a live board's contents is irreversible from inside
the app (autosave overwrites `board.json` within ~1s, so there is no undo), and
the destination it protects is trivially reachable anyway — import as a new
board, then delete the old one, which *is* recoverable via the Trash. A confirm
modal is a poor substitute for an operation simply not being destructive.

Mechanically, import writes the scene to the new board's `board.json` via the
existing `save_doc` (after `project_open` makes it active) rather than pushing
to the canvas server: the board isn't open yet, and opening it runs
`restoreBoard`, which loads `board.json` into the canvas. Writing the file *is*
the import.

Validation happens in Rust before anything is created: parse JSON, require
`type === "excalidraw"` and an array `elements`. On failure the reason
propagates to the UI and nothing is written.

### Where it lives in the UI

- **Export** — the board view's second row (`BoardChrome`), right-aligned. The
  board is open there by definition, so the live scene is available. The
  canvas URL is lifted out of `BrainstormEditor` via an `onCanvasUrl` callback
  so the title-bar button can reach it; the callback fires with `null` on
  unmount so a stale URL can't outlive its board.
- **Import** — the boards list, next to `New board`, since import always
  creates a new board and needs none open.

### Verification

The export envelope was checked against a real excalidraw.com-saved file: the
top-level key sets are identical (`appState, elements, files, source, type,
version`).

The full round-trip was exercised against the user's live 197-element board:
exporting it and pushing the resulting file back through
`/api/elements/sync` returned 197 elements with **identical ids** and an
unchanged type breakdown (132 text, 37 rectangle, 28 arrow).

## Feature 2 — On-board context memory

### Why this is skill-only, with no app code

The board's authoritative state is the canvas server's in-memory scene;
`board.json` is a derived copy that autosave rewrites wholesale roughly once a
second. Anything the app wrote to a sidecar file would be either erased or
invisible to the agent. Memory must therefore *be canvas content*.

The agent already has every tool required — `create_element` to write,
`query_elements` to retrieve, `describe_scene` to survey. The missing piece is
instructions, not code. Skill-only also means it applies to all three agents
(Claude, Codex, Gemini) at once and ships without a rebuild.

### The reserved region

Memory lives at **`x < -2000`**, left of the drawing area. This single
convention makes both halves work:

- **Retrieval is a bounding-box query.** `/api/elements/search` already accepts
  `x_min`/`x_max`/`y_min`/`y_max`, so the agent fetches precisely the memory
  region instead of scanning a board that may hold thousands of elements.
- **No collision** with the user's drawing, at any board size.

It is a **convention, not an enforced boundary** — nothing prevents drawing
there. Enforcement is deliberately not built; if it becomes a real problem, a
guard is a later change.

### Format

A titled column: a heading element `📌 Context Memory`, then dated entries
newest-first, each a text element:

```
2026-07-29 — Board sharing
Decision: ship .excalidraw file export; Miro needs OAuth (no local
format gives editable objects).
Constraint: canvas server must stay on 127.0.0.1 (no auth).
```

Plain text on the canvas, so a human opening the board reads the project's
history with no tooling — satisfying the documentation goal for free.

### Behaviour

- **On session start**, before acting, query the memory region and read it.
- **Append an entry** when something durable is established: a decision, a
  constraint, a summary of a doc handed to the agent, a resolved open question.
- **Not every turn.** The failure mode is a junk drawer: an agent that logs
  everything makes the region useless and clutters the board. The instruction
  is written around *what earns a place*, not *write things down*.
- **Watch mode stays read-only.** The skill forbids canvas edits while the user
  is thinking; memory writes are no exception.
- **Never write `@agent`** into a memory entry — the existing skill rule; such
  text re-triggers the agent on the next tick.

### Interaction with export

Export sends the whole board, memory column included — the context travels with
the work, which is the intended behaviour for both the excalidraw.com share and
any future Miro push. No filtering is applied.

## Testing

**Rust:** `.excalidraw` envelope round-trips (export→import preserves element
count and ids); import rejects malformed JSON, a wrong `type`, and a
non-array `elements`; export of an empty board produces a valid file.

**Frontend:** export invokes the command with the live scene; import into a new
board creates then populates it; import into the current board is gated by the
confirm modal; a rejected file surfaces its reason and syncs nothing.

**Skill:** no automated test — it is prose. Verified by inspection.

## Out of scope

Miro export (see above). Live collaboration or any exposure of the canvas
server beyond loopback. Memory compaction/pruning as the region grows.
Enforcement of the reserved region.
