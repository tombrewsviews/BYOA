# Brainstorm Canvas — Design

**Date:** 2026-06-17
**Status:** Approved (design); ready for implementation plan.

## Summary

Brainstorm Canvas is the third KineticType platform app (after Kinetic and
Pulse). It follows the standard shell pattern — embedded agent panel on the
**left**, domain canvas on the **right** — where the canvas is a **live
Excalidraw board** the agent can both **see** and **draw on**. The agent has
two modes:

1. **Prompted** — the agent acts/responds only when you prompt it (today's
   chat behavior).
2. **Continuous** — the agent watches the board and chimes in like a
   participant: observing, suggesting, commenting, asking questions.

The goal is a brainstorming tool where the AI behaves like a collaborator in
the session. The primary interest is **continuous mode** with a watch process.

## Canvas substrate (the collaboration mechanism)

We use **`mcp-excalidraw-server` v2.0** (npm), which ships two cooperating
processes:

1. **Canvas server** — a standalone Excalidraw web app + REST + WebSocket on
   `127.0.0.1:<port>`. This is the **single source of truth** for the scene.
2. **Excalidraw MCP (stdio)** — 26 tools (`create_element`, `update_element`,
   `query_elements`, `describe_scene`, `get_canvas_screenshot`, `set_viewport`,
   snapshots, …) that sync to the canvas server over WebSocket via the
   `EXPRESS_SERVER_URL` env var.

The user draws in the embedded webview; the agent draws via MCP; **both hit the
same canvas server**, so they share one board in real time. The agent perceives
the board via `describe_scene` (structured text) and `get_canvas_screenshot`
(image) — a closed see→act loop, and concurrent multi-author by design.

We deliberately rejected the simpler `excalidraw-mcp@1.0.0`: it is in-memory,
stdio-only, with no canvas server and no persistence — the agent's drawings
would be invisible to the user.

```
┌─ Brainstorm Canvas app (Tauri webview) ───────────────────────────┐
│  ┌─ Left: Agent panel ────┐   ┌─ Right: Canvas ─────────────────┐ │
│  │ Chat                    │  │ <iframe src=127.0.0.1:port>      │ │
│  │ Mode: Prompted|Contin.  │  │   = the Excalidraw web app       │ │
│  └──────────┬──────────────┘  └─────────────┬────────────────────┘ │
└─────────────┼──────────────────────────────┼──────────────────────┘
              │ spawn claude -p (cwd=project) │ user draws here
              ▼                               ▼
        ┌─ claude turn ─┐  MCP tools   ┌─ Canvas server (Express+WS) ─┐
        │  + Excalidraw │◄────────────►│  holds the scene; broadcasts │
        │  MCP (stdio)  │  draw / see   │  every change over WebSocket │
        └───────────────┘              └──────────────────────────────┘
```

### Process lifecycle

The canvas server is a per-app background process the app owns (mirroring how
`PulseApp` owns its audio engine and `StageWindow` its second window). A new
Rust module `src-tauri/src/brainstorm_canvas.rs` owns it:

- On app open: spawn `mcp-excalidraw-server` in **canvas mode**
  (`npm run canvas` equivalent / `node dist/server.js`) on a **pinned port**
  (default `3939`), and report the resolved URL to the frontend via a Tauri
  command (`brainstorm_canvas_url`).
- On app exit / window close: kill the child (also addresses the existing
  `TODO(robust-exit)` gap noted in `agent_chat.rs`/`pty.rs` — at minimum, don't
  leak this child).
- Precedent: `pty.rs` and `agent_chat.rs` for spawn/kill; `StageWindow` for a
  second surface.

**Port choice — pinned, not dynamic.** The canvas port is needed at two times:
runtime (the webview src) *and* project-create time (written into `.mcp.json`,
see below). Threading a dynamic port into the MCP `env` on every agent turn
would require a new seam in `turnSpawnArgs` (today it returns `env: {}`). To
avoid that, we pin a fixed app-reserved port (3939). If the port is already
bound on app open, the backend picks the next free port **and rewrites the
active project's `.mcp.json`** before the first agent turn — so the static file
stays correct without touching the turn-spawn path.

## App shell & canvas plugin

No changes to `App.tsx` or the substrate seams. We extend the existing
registries:

- **Registry** (`editor/platform/apps.ts`): add a `brainstorm` manifest
  (`id: "brainstorm"`, name "Brainstorm Canvas", blurb, `Root: BrainstormApp`,
  `status: "available"`). Category: `"writing"` (no new category needed). This
  puts the card on The Square.
- **Canvas plugin** (`editor/canvases/brainstorm/`): a `CanvasPlugin`
  registered in `resolveCanvas("brainstorm")`. The renderer is **not** a
  Remotion/React render of a doc — it renders `<iframe src={canvasUrl}>`
  (the app's CSP is already `null`, so a localhost iframe is allowed).
- **Canvas detection** (`src-tauri/src/canvas.rs::for_project`): add
  `board.json` → brainstorm, extending the existing
  `project.json`→pulse / `story.json`→kinetic chain. `projects_create` already
  accepts a `canvas` arg; the Brainstorm app seeds `board.json`.
- **App component** (`editor/canvases/brainstorm/BrainstormApp.tsx`, modeled on
  `PulseApp.tsx`): owns project open/create, fetches the canvas-server URL from
  Rust, and lays out the two-column shell — agent panel left, canvas webview
  right.

### Deliberate divergence: no disk-doc / merge / history machinery

The scene lives in the canvas server, not in a project JSON the agent edits on
disk. Therefore this app **does not** use the three-way-merge / undo-history /
disk-doc machinery the other two canvases rely on. The `CanvasPlugin` interface
is satisfied with honest no-ops:

- `docFilename: "board.json"` — a seed/marker file (drives canvas detection
  only; not a live document).
- `parse` / `durationInFrames` / `resolveConflict` / `pruneSelection` —
  trivial/inert implementations. The canvas server + Excalidraw's own undo are
  the source of truth.
- `Timeline: null`. Inspector is a minimal status surface (server state, mode),
  not a property editor.

This is intentional: faking a doc would be worse than declaring these methods
inert.

## Enabling Excalidraw MCP by default

Claude discovers MCP servers from a `.mcp.json` in its `cwd`, and the agent's
`cwd` is `project.path` (the pattern at `KineticApp.tsx:928`,
`cwd={project.path}`). So "enabled by default" means: when `projects_create`
makes a Brainstorm project, the backend also writes a `.mcp.json` into the
project folder:

```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "npx",
      "args": ["-y", "mcp-excalidraw-server"],
      "env": {
        "EXPRESS_SERVER_URL": "http://127.0.0.1:3939",
        "ENABLE_CANVAS_SYNC": "true"
      }
    }
  }
}
```

- Only Brainstorm projects get this file, so the MCP is scoped to this app.
- The agent gets full canvas access without per-tool permission prompts because
  the existing default permission mode is **Full access**
  (`--permission-mode bypassPermissions`). No new agent infrastructure: the
  agent's canvas powers come entirely from this seeded `.mcp.json` + the running
  canvas server.
- If the pinned port was unavailable on open (see Process lifecycle), the
  backend rewrites the `EXPRESS_SERVER_URL` in this file before the first turn.

## Agent panel

Reuse the existing `Chat` component and agent transport **verbatim**: same
one-shot `claude -p --output-format stream-json` turns, same
`--session-id` / `--resume` continuity, same MCP discovery, `cwd={project.path}`.
The only addition is the **mode toggle** (below).

## Prompted vs Continuous mode

A mode toggle sits in the agent panel near the composer (a small segmented
control reusing the `Select`/`Button` patterns, à la `PromptModeBar`).

### Prompted mode (default)

Exactly today's behavior. You type → `Chat.send()` spawns a turn → the agent
inspects the canvas (`describe_scene` / `get_canvas_screenshot`), responds, and
draws only when you ask.

### Continuous mode — the watch loop

A **frontend** watch loop drives `Chat.send()` programmatically. There is no new
agent process model: "watching" is the app deciding *when* to wake the one-shot
agent.

```
WATCH LOOP (frontend, active only in continuous mode)
─────────────────────────────────────────────────────
WebSocket to canvas server ──► onSceneChange (every element change)
        │
        ▼  debounce: reset a timer on each change (~4s quiet)
   [user pauses]
        │
        ▼  guard: skip if a turn is already running (activeTurnId != null)
        ▼  guard: skip if scene unchanged since last wake (hash the scene)
        │
        ▼  send a watch turn (system-style, NOT a user bubble):
           "You're a brainstorming collaborator watching this Excalidraw
            board. Inspect it (describe_scene / get_canvas_screenshot).
            If you have something genuinely useful — a suggestion, a
            question, a connection, a gap — say it briefly. If not, reply
            with exactly NOTHING_TO_ADD and stop. Do NOT modify the canvas
            unless asked."
        │
        ▼  the turn streams into chat as normal
        ▼  if the whole turn text === "NOTHING_TO_ADD" → suppress the bubble
```

Behaviors (per approved decisions):

- **Trigger = debounced activity** (~4s of quiet after edits). No idle polling;
  no tokens burned mid-stroke or while idle.
- **May stay silent.** A `NOTHING_TO_ADD` sentinel produces no chat bubble. The
  `Chat` rendering gains a small filter: a watch turn whose accumulated text is
  exactly the sentinel is dropped from the rendered transcript.
- **Suggest-first (no proactive drawing).** The watch prompt forbids canvas
  edits. The agent draws only in prompted mode (or when you reply "yes, add
  it", which is a normal prompted turn).
- **Continuity.** Watch turns use the same `--resume <sessionId>`, so the agent
  remembers what it already said and won't repeat suggestions.

Guards that make it feel like a person, not a bot:

- **One turn at a time** (`activeTurnId` gate): a flurry of edits collapses into
  one wake after you pause.
- **Scene-hash dedup**: a pure pan/zoom with no element delta does not wake the
  agent.
- **Clean stop**: leaving continuous mode cancels any in-flight watch turn and
  clears the timer.

### Rendering watch turns

Watch comments are visually distinguished from answers to the user (e.g. a
muted style + small "observing"/eye affordance) and are **not** user bubbles.
This requires tagging a turn as `watch`-origin so the renderer can style it and
apply the `NOTHING_TO_ADD` suppression. Minimal addition to the chat layer; no
change to the agent protocol.

## On-disk footprint

Per Brainstorm project: `board.json` (seed/marker) and `.mcp.json` (MCP config).
Everything else — the scene, watch-loop state — is runtime only.

## Scope of first build (vertical slice)

End-to-end but minimal:

- App card on The Square (`apps.ts`).
- Canvas plugin: iframe webview of the canvas server (`canvases/brainstorm/`).
- Rust: canvas-server spawn/port/kill (`brainstorm_canvas.rs`) +
  `board.json`/`.mcp.json` seeding in `projects_create`; `canvas.rs` detection.
- Embedded agent panel reusing `Chat`, with Excalidraw MCP on by default.
- Prompted/Continuous mode toggle.
- Continuous watch loop: debounce → guards → silent-capable system turn →
  distinguished rendering.

Deferred (out of scope for the slice): snapshots UI, viewport-follow (agent
panning the user's view), continuous-mode tuning settings panel, multiple
boards per project, the "agent draws in its own area" autonomy variant.

## Risks & watch-outs (from foresight pass)

- **Port collision (🔴/🟡):** another process on 3939, or a second Brainstorm
  project opened concurrently, breaks the static `EXPRESS_SERVER_URL`. Mitigation
  is the open-time free-port fallback + `.mcp.json` rewrite. One canvas server
  per app session is assumed; opening two Brainstorm projects at once is out of
  scope for the slice (document the limitation).
- **`npx -y mcp-excalidraw-server` cold start (🟡):** first turn may stall while
  npx fetches the package. Mitigation: warm it (or `npm i` it as a dep) during
  app open, before the first turn.
- **Orphaned child (🔒/🟡):** the canvas server child must be killed on
  window-close; otherwise it leaks a localhost server (and an open port) across
  sessions. Add the kill hook (relates to the existing `TODO(robust-exit)`).
- **Localhost exposure (🔒):** bind the canvas server to `127.0.0.1` only (its
  default), never `0.0.0.0` — it has no auth.
- **Watch-loop runaway (🔴):** the `activeTurnId` gate + scene-hash dedup must be
  airtight, or a self-triggering loop (agent edit → scene change → wake) could
  spin. The suggest-first rule (no proactive edits) closes the main feedback
  path; the gate closes the rest.
- **Pattern consistency (🔁):** keep the agent-panel reuse literal — do not fork
  `Chat`/adapters. The watch loop and mode toggle are additive wrappers, not a
  parallel transport.

## Open question for planning

- Pin `mcp-excalidraw-server` as a project dependency (deterministic, larger
  bundle) vs. `npx -y` on demand (smaller, cold-start risk). Recommended: add as
  a dependency to remove cold-start + offline-failure risk; decide in the plan.
