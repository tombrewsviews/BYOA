# Brainstorm Canvas — agent reads the selected elements

**Date:** 2026-07-26
**Status:** Approved design, pending implementation plan

## Problem

The embedded agent can already read the *whole* board (`describe_scene`,
`get_canvas_screenshot`, `query_elements`) but has no notion of what the user
currently has **selected** on the canvas. There's no way to select a few
elements and ask "what's wrong with this flow?" or "make these blue" and have
the agent know which elements "these" refers to — the user has to describe
them in words instead.

We want: select elements on the board, ask a question or request a change in
chat, and have the agent receive exactly which elements were selected (type,
position/size, and any text/label) as part of that turn.

## Key constraint — board and chat are separate windows

The board (Excalidraw) and the agent chat panel are **different Tauri
windows on different origins** (`docs/superpowers/specs/2026-07-08-*` /
`brainstorm_canvas.rs` — WKWebView partitions cross-origin iframe storage, so
the board was deliberately split into its own `WebviewUrl::External` window).
Selection is pure in-browser Excalidraw state (`appState.selectedElementIds`)
living inside the board window; today it never leaves that window. Getting it
into a chat turn means routing it through the canvas server (`server.js`),
the same way board *edits* already cross that boundary via
`/api/elements/sync` + the WebSocket broadcast.

## Vendoring constraint

`apps/brainstorm/src-tauri/resources/canvas-server/` vendors a third-party
package (`mcp-excalidraw-server`, upstream `yctimlin/mcp_excalidraw`) as
**compiled output only** — no TypeScript source is checked into this repo.
Two different files, two different risk profiles:

- **`dist/server.js` and `dist/index.js`** are plain, readable `tsc` output
  (not minified) — editing them directly is no different from editing any
  other JS file, just without a `.ts` source of truth to regenerate from.
  These will be hand-patched in place.
- **`dist/frontend/assets/index-*.js`** is a minified Vite/React bundle with
  no vendored source, no exposed globals, and (confirmed by inspecting the
  bundle) no per-element DOM identity in production builds — Excalidraw only
  stamps `data-id` on element nodes when built with `MODE === "test"`
  (`po()` gate in the bundle), so a DOM-scraping bridge that reads selection
  from outside React was tried and ruled out: there is nothing reliable to
  scrape. Reading `appState.selectedElementIds` requires either the
  `<Excalidraw onChange>` callback or the imperative
  `excalidrawAPI.getAppState()` — both exist only inside the React tree, so
  *some* rebuild of the frontend bundle is unavoidable for live push-on-select.

  Adopting upstream's current source (`1.1.0`) wholesale is still rejected —
  it's a substantially different rewrite from whatever produced our vendored
  `1.0.7` build, and risks silently changing unrelated frontend behavior
  (font loading, export, sync-on-change). Instead: write a small,
  **self-authored** replacement `App.tsx`/`main.tsx`/`vite.config.ts` that
  mounts `<Excalidraw>` the same way the current bundle does — same
  `EXCALIDRAW_ASSET_PATH`/font-serving path (`/assets/fonts`, already served
  by `server.js`), same debounced `onChange` → `/api/elements/sync` behavior
  (read from the current bundle's call sites, not upstream's) — plus one
  addition: a second debounced call in `onChange` that reads
  `appState.selectedElementIds` and posts to the new `/api/selection`
  endpoint. Built with the already-vendored `@excalidraw/excalidraw`/`vite`
  dependencies. This is authored and reviewed in full, so its behavior can be
  verified directly against the current bundle rather than trusted from
  upstream.

  **Fallback if this proves too lossy to verify safely:** descope to
  shipping `get_selected_elements`/`/api/selection` without automatic
  live push, and add a `select_elements(ids)` MCP tool the agent calls after
  the user names/describes the elements in words — no frontend rebuild at
  all. This is a strictly smaller version of the same architecture, not a
  different one, so it can be adopted mid-implementation without redoing
  earlier tasks (canvas-server endpoint + MCP tool tasks are unaffected
  either way).

## Decisions (locked)

| Decision | Choice |
|---|---|
| Delivery model | **Auto-attach to prompt.** Whenever the user sends a chat message while the board has a non-empty selection, the app reads the current selection and includes it as context in that turn — no extra step. |
| Agent re-fetch | **Also expose an MCP tool** (`get_selected_elements`) so the agent can re-fetch the live/full selection mid-turn (e.g. after it edits something, or if the user's phrasing implies re-checking), not just rely on the one-shot text block. |
| Element content included | **Type, position/size, and text/label** — for text/sticky elements, the text; for shapes, type + x/y/width/height + any bound text label. Not the full raw Excalidraw JSON (too noisy/token-heavy), not text-only (loses layout info the agent needs for spatial reasoning). |
| Capture timing | **Continuous live sync.** The board pushes its selection to the canvas server on every selection change, mirroring how it already pushes element edits via `/api/elements/sync`. Chat reads whatever the latest selection is at send time — selection can be made before or during composing. |
| UI indicator | **Selection chip above the composer.** Shows a live count + short preview (e.g. `3 selected: "Login flow", rectangle, arrow`) whenever the board's selection is non-empty. Confirms to the user what context will be sent. |
| Selection scope per turn | **One-shot, no explicit clear.** The context attached to a turn is whatever was selected when Send was clicked; there's no separate "detach" action. The chip simply reflects the board's live selection, which naturally clears when the user deselects on the board itself. |
| Edit permission | **No new permission model.** Selection is just extra context on top of existing prompted-mode behavior — the agent may already call `update_element`/`delete_element` when asked in prompted mode; the response's element ids are drawn from the selection block. Watch mode is unaffected (already forced read-only; selection sync still happens but the watch prompt doesn't include it, since watch turns aren't a place the user is actively asking about a selection). |

## Architecture

### 1. Canvas server (`server.js`) — new selection state + endpoint

Add an in-memory `let currentSelection = { elementIds: [], updatedAt: null }`
next to the existing `elements`/`files` maps.

- `POST /api/selection` — body `{ elementIds: string[] }`. Replaces
  `currentSelection`, broadcasts `{ type: 'selection_changed', elementIds,
  updatedAt }` over the WebSocket (same `broadcast()` helper used by every
  other mutation). Mirrors the shape/logging style of the existing
  `/api/elements/sync` handler.
- `GET /api/selection` — returns `{ elementIds, updatedAt }`. Used by the
  chat window (no WS connection needed there) and by the MCP tool.

No changes to the existing element storage/broadcast logic — this is
additive.

### 2. Frontend bundle — push selection on change

The current bundle's `onChange` handler (`() => T()`, a debounced call into
the existing element-sync function) ignores Excalidraw's
`(elements, appState, files)` callback arguments entirely. The patch adds a
second, independently-debounced call that reads `appState.selectedElementIds`
(an object keyed by id) and `POST`s `Object.keys(selectedElementIds)` to
`/api/selection` whenever it changes (shallow-compared against the last-sent
set to avoid redundant posts on unrelated edits). Rebuilt as a new Vite bundle
replacing `dist/frontend/assets/index-*.js` + updating the hashed filename
reference in `dist/frontend/index.html`.

### 3. MCP server (`index.js`) — new tool + fix to dead state

The existing `sceneState.selectedElements` (`index.js:136`) is dead code —
initialized once, never populated, never read except by the already-broken
`get_resource("scene")` branch. Replace that branch's `selectedElements`
field with a live fetch, and add a dedicated tool:

- **`get_selected_elements`** (no args) — `GET`s `/api/selection` from
  `EXPRESS_SERVER_URL`, then `GET /api/elements` and filters to the returned
  ids (same pattern as `query_elements`'s existing element-fetch code). Returns
  the full element objects for whatever's currently selected. If nothing is
  selected, returns an empty list — the agent can tell the user nothing is
  selected rather than guessing.
- `get_resource({ resource: "scene" })`'s `selectedElements` field now
  reflects the real thing (fetched the same way) instead of always `[]`.

### 4. App shell — thread `canvasUrl` into `Chat`, auto-attach on send

- `BrainstormApp.tsx`: `Chat` already isn't given `canvasUrl` today (only
  `watch.ts` and `persistence.ts` get it). Add a `canvasUrl?: string` prop to
  `Chat` and pass the existing `canvasUrl` state through.
- `Chat.tsx`: on `send()`, before calling `composePrompt`, if `canvasUrl` is
  set, `GET /api/selection` then `GET /api/elements` (filtered to those ids —
  same shape the new MCP tool returns) and format a compact context block:

  ```
  [selected on board]
  1. rectangle (id: abc123) at (120, 80), 200×100 — "Login flow"
  2. text (id: def456) at (140, 200) — "needs OAuth"
  ...
  ```

  prepended to the prompt (same place `composePrompt`'s `@path` refs are
  prepended today). If the fetch fails or the selection is empty, no block is
  added — behaves exactly as today.
- Watch-origin (`origin === "watch"`) turns skip this block entirely — watch
  prompts are fixed observation text, unrelated to an active user selection.
- `Composer.tsx`: new selection-chip row rendered above the textarea,
  sourced from a small `useSelectionSummary(canvasUrl)` hook (poll
  `/api/selection` + `/api/elements` on a WebSocket `selection_changed`
  message, same subscribe pattern `watch.ts` already uses for element
  broadcasts). Purely presentational — clicking Send doesn't consume/clear
  anything beyond what naturally happens when the user deselects on the
  board.

### 5. Skill manual (`SKILL.md`)

Add a short section documenting the new `[selected on board]` prompt block
and the `get_selected_elements` tool, so the agent knows: the ids in that
block are directly usable with `update_element`/`delete_element` without
re-querying, and it may call `get_selected_elements` if it needs fuller
detail or the selection may have changed mid-turn.

## Error handling

- Canvas server unreachable when composing a selection block: the fetch is
  wrapped in try/catch; on failure, silently omit the block (matches
  `watch.ts`'s existing "canvas server unreachable — skip" pattern
  throughout).
- Empty selection: no block, no chip — the common case (nothing selected)
  costs one cheap `GET` per send.
- Stale ids (selected, then deleted before send): `/api/elements` naturally
  won't return a deleted id; the block simply lists whatever's still present.

## Testing

- `server.js`: unit-test-equivalent manual check — `POST /api/selection`
  then `GET /api/selection` round-trips; WS broadcast fires.
- `index.js`: `get_selected_elements` returns `[]` on empty selection, and
  the right filtered element list otherwise.
- Frontend patch: manual check in the running app — selecting elements in
  the board window causes `/api/selection` to update (visible via the chip
  in the chat window).
- `Chat.tsx`/`Composer.tsx`: existing Vitest setup in
  `apps/brainstorm/src/agent-chat/__tests__` — add cases for the new
  selection-block formatting function (pure function, easy to unit test) and
  the chip's empty/non-empty rendering.
