# Brainstorm Canvas — agent reads the selected elements

**Date:** 2026-07-26
**Status:** Superseded — see
[the live-selection design](2026-07-26-brainstorm-live-selection-design.md),
which implements the real thing. This document is kept only for the
investigation record of why the first attempt was scoped down, and the
reasoning that turned out to be wrong.

## Problem

The embedded agent can already read the *whole* board (`describe_scene`,
`get_canvas_screenshot`, `query_elements`) but has no way to know which
elements the user means when they say "these" or "this flow" — the user has
to fully describe or re-identify elements in words every time.

We want: the user describes which elements they mean (in chat), and the
agent reliably resolves that description to the actual elements before
acting or answering, instead of guessing or asking the user to spell out ids.

## Investigation — why this isn't "read `appState.selectedElementIds`"

The obvious design is for the app to auto-attach whatever's currently
selected on the board to the next chat turn. That was the original plan
here, and it was abandoned after investigation. Recorded so the reasoning
isn't lost if this is revisited later.

**Board and chat are separate windows.** The board (Excalidraw) and the
agent chat panel are different Tauri windows on different origins
(`docs/superpowers/specs/2026-07-08-*` / `brainstorm_canvas.rs` — WKWebView
partitions cross-origin iframe storage, so the board was deliberately split
into its own `WebviewUrl::External` window). Selection
(`appState.selectedElementIds`) is pure in-browser Excalidraw state living
inside the board window; it never leaves that window today. Getting it into
a chat turn would require routing it through the canvas server
(`server.js`), the same way board *edits* already cross that boundary via
`/api/elements/sync` + the WebSocket broadcast.

**The canvas frontend is vendored as compiled output only.**
`apps/brainstorm/src-tauri/resources/canvas-server/` vendors a third-party
package (`mcp-excalidraw-server`, upstream `yctimlin/mcp_excalidraw`) — no
TypeScript source is checked into this repo for the frontend. Pushing
selection out of the board window requires React-level access to
`appState.selectedElementIds` (via `<Excalidraw onChange>` or the imperative
`excalidrawAPI.getAppState()`), which only exists inside that bundle.

Two ways to get that access were considered and rejected:

1. **DOM-scraping bridge** (read selection from outside React via a small
   injected script, no rebuild) — ruled out after inspecting the bundle:
   Excalidraw only stamps `data-id` on element DOM nodes when built with
   `MODE === "test"` (a `po()` gate found in the minified code). In the
   production build we have, there is no reliable per-element identity in
   the DOM at all to scrape.
2. **Hand-authored replacement frontend** (`App.tsx`/`main.tsx`/
   `vite.config.ts` from scratch, rebuilt with the already-vendored
   `@excalidraw/excalidraw`/`vite`, adding one new call to push selection) —
   ruled out after inspecting the actual mounted component. It is not a thin
   wrapper: it handles WebSocket reconnection, element z-order merging,
   PNG/SVG image export (`export_image_request` →
   `/api/export/image/result`), viewport control driven from the MCP
   (`set_viewport` → `/api/viewport/result`), and Mermaid diagram conversion,
   each with specific state-merge semantics (`captureUpdate: NEVER` vs
   `IMMEDIATELY`). Adopting upstream's current source (`1.1.0`) instead was
   also rejected — it's a substantially different rewrite from whatever
   produced our vendored `1.0.7` build and risks silently changing unrelated
   behavior. A hand-authored replacement big enough to preserve all of the
   above correctly is a from-scratch reimplementation of a nontrivial
   component, not a small patch — real risk of silently breaking
   currently-working export/viewport/mermaid features for a selection-sync
   feature that doesn't need any of them touched.

**Conclusion:** no frontend rebuild, no live push of board selection. The
board's selection state is out of reach for now — revisit only if a future
piece of work separately takes on rebuilding the frontend from real source.

## Decisions (locked)

| Decision | Choice |
|---|---|
| How the user indicates which elements | **Describe in words in chat** (e.g. "the login box and the arrow to it"). No board-side selection UI change, no new canvas-server endpoints, no MCP tool. |
| How the agent resolves the description | **Agent-side, using existing tools.** The agent calls `describe_scene`/`query_elements` (already available) to find the elements matching the user's description. |
| Confirmation | **Agent states what it resolved to before acting.** E.g. "I see: rectangle 'Login' (id abc123), arrow (id def456) — acting on these." so the user can correct a wrong guess before an edit happens, without needing a UI element to confirm through. |
| Edit permission | **No new permission model.** This is existing prompted-mode behavior (the agent may already call `update_element`/`delete_element` when asked) — the only change is *how* it finds the ids, not what it's allowed to do with them. |
| Scope | **Documentation-only change.** No frontend, backend, or MCP server code changes — this is a `SKILL.md` instruction addition. |

## Architecture

The entire change is to
`apps/brainstorm/src-tauri/skills/brainstorm/SKILL.md`, which is the agent's
operating manual for this app (loaded as project context — see the existing
"Prompted mode" / "Continuous (watch) mode" / "Board instructions" sections).

Add a new subsection (e.g. "Referring to specific elements") explaining:

- When the user's request refers to elements by description rather than by
  id ("these two boxes", "the flow on the left", "what I just drew"), read
  the board first (`describe_scene`, optionally `get_canvas_screenshot` for
  ambiguous spatial descriptions) and use `query_elements` (by type, bbox,
  or text filter) to find the best-matching element(s).
- Before editing or deleting anything based on that resolution, briefly
  state which elements were matched (type + short text/label + id) so the
  user can correct a mismatch — this is a confirmation-by-restating pattern,
  not a blocking prompt; the agent proceeds unless the user objects.
- If the description is ambiguous (multiple equally-plausible matches) or
  nothing matches, say so and ask a clarifying question rather than guessing
  silently and editing the wrong element.

No changes to `server.js`, `index.js`, the frontend bundle, `Chat.tsx`,
`Composer.tsx`, or `BrainstormApp.tsx`.

## Testing

Manual verification only (this is a prompt-instruction change, not code):
in the running app, ask the agent to act on a described-but-not-explicitly-
present-by-id element (e.g. "make the login box blue") and confirm it
resolves via `query_elements`/`describe_scene`, states its match, and edits
the right element.
