# Studio: timeline + selection-driven properties + embedded terminal

**Date:** 2026-05-15
**Status:** Design approved, ready for implementation plan

## Goal

Fold the standalone `<Player>` host app (`app/`) into the kinetic editor
(`editor/`) and turn the editor into a real video-editor-style studio:

- The studio has four panes: **Terminal** (left), **Preview** (center-top),
  **Timeline** (center-bottom), **Properties** (right).
- The Timeline shows beats as horizontal clips (widths proportional to
  duration) plus a Story track above them. Clicking a beat selects it and
  seeks the player to that beat's start frame.
- The Properties panel renders props for **only the selected element**
  (Story or one beat) — not all beats stacked.
- All player controls (play/pause/seek/jump, keyboard shortcuts, live
  playhead) live in the studio. The `app/` directory and `npm run player`
  script are deleted.
- An embedded terminal in the left pane runs a plain shell (PTY), letting
  the user log in and run `claude` to drive script-level edits from inside
  the studio.

## Non-goals

- No timeline editing (drag clips to reorder, resize duration by drag).
  Beats remain authored via `story.json` / Claude Code. The Timeline is a
  selection + scrub surface, not an authoring surface.
- No multi-select. Exactly one selection at a time.
- No undo/redo. Save still writes `story.json`; dirty tracking is unchanged.
- No tests added in this change. Verification is manual (see Verification).
- No remote deployment. Studio remains a localhost dev tool.

## Layout

```
┌─────────────┬──────────────────────┬──────────────┐
│             │       PREVIEW        │              │
│             │   (Player +          │              │
│  TERMINAL   │    Transport bar)    │  PROPERTIES  │
│             ├──────────────────────┤              │
│             │      TIMELINE        │              │
│             │  (Story + Beats)     │              │
└─────────────┴──────────────────────┴──────────────┘
```

CSS Grid:

- `grid-template-columns: 360px 1fr 320px`
- `grid-template-rows: 1fr auto`
- Terminal and Properties each span both rows.
- Preview (top) + Timeline (bottom) occupy the middle column.

## File layout

```
editor/
  App.tsx          shell: state, layout, keyboard shortcuts, save
  player.tsx       <PlayerStage> + <Transport>            (NEW)
  timeline.tsx     <Timeline> with Story + Beats tracks   (NEW)
  terminal.tsx     <Terminal> xterm-based PTY client      (NEW)
  panel.tsx        selection-driven: renders ONE selection's props
  controls.tsx     unchanged (Row/Slider/Dropdown/ColorControl/EasingPicker)
  main.tsx         unchanged
  index.html       unchanged
vite.editor.config.ts
                   adds WebSocket terminal backend (PTY bridge)
                   alongside existing /__save-story handler
```

### Removed

- `app/` directory (`app/App.tsx`, `app/main.tsx`)
- `vite.config.ts` (root — was for the player app)
- `index.html` (root — was the player entry)
- `package.json` scripts: `"player"`, `"build:player"`

`HelloVideo.tsx` and its `<Composition>` in `src/Root.tsx` are kept — they
remain valid compositions usable from CLI/Studio. Only the React host app
that wrapped HelloVideo in a `<Player>` is deleted.

## State model

State lifted to `editor/App.tsx`:

- `story: Story | null` — existing
- `savedJson: string` — existing, dirty tracking
- `selection: Selection` — NEW, single source of truth for what the right
  panel renders and what the timeline highlights
- `playerRef: RefObject<PlayerRef | null>` — existing, passed down

```ts
type Selection =
  | { kind: "story" }
  | { kind: "beat"; index: number };
```

Initial value: `{ kind: "story" }`. The panel is never blank.

**Critically NOT lifted:** the current playhead frame. The Timeline
subscribes to `playerRef` via `addEventListener("frameupdate", ...)` and
keeps its playhead in its own local state. This prevents 30 re-renders/sec
from cascading into the Panel and Player.

### Selection clamping

A `useEffect` in `App.tsx` watches `story.beats.length` and selection. If
`selection.kind === "beat"` and `selection.index >= story.beats.length`,
reset to `{ kind: "story" }`. Cheap and defensive.

## Components

### `<PlayerStage>` (player.tsx)

Existing wrapper from `editor/App.tsx` lines 124–153, moved out unchanged.
Keeps `controls loop autoPlay` so the built-in scrubber bar still works.
Props: `inputProps`, `durationInFrames`, `playerRef`.

### `<Transport>` (player.tsx)

A small toolbar above `<PlayerStage>` inside the Preview pane.

| Button   | Action                                              |
|----------|-----------------------------------------------------|
| ▶ Play   | `playerRef.current?.play(e)` — pass the MouseEvent  |
| ⏸ Pause  | `playerRef.current?.pause()`                        |
| ⏮ Start  | `playerRef.current?.seekTo(0)`                      |
| ⏭ End    | `playerRef.current?.seekTo(durationInFrames - 1)`   |

The `play(e)` event-passing pattern preserves user-gesture context, matching
the documented Remotion Player best practice and the original `app/App.tsx`.

### `<Timeline>` (timeline.tsx)

Props:

```ts
{
  story: Story;
  selection: Selection;
  onSelect: (s: Selection) => void;
  playerRef: RefObject<PlayerRef | null>;
  durationInFrames: number;
  fps: number;
}
```

Two stacked horizontal tracks:

```
┌──────────────────────────────────────────────┐
│ STORY                                        │  one full-width row
│ [████████████████████████████████████████]   │
├──────────────────────────────────────────────┤
│ BEATS                                        │
│ [ sprout ][ grows ][ wild  ][ gets ]         │  widths ∝ durationInSeconds
│              ▮ ← playhead                    │
└──────────────────────────────────────────────┘
```

Each beat clip is a `<button>` (keyboard + a11y). Clip width =
`(beat.durationInSeconds / totalSeconds) * 100%`. Selected clip has a bright
border + filled background; unselected clips have a muted border.

#### Click behavior (Story track and beat clips alike)

1. Call `onSelect({ kind, [index] })`.
2. Compute target frame:
   - Story → `0`
   - Beat[i] → `Math.round(sum(beats[0..i-1].durationInSeconds) * fps)`
3. `playerRef.current?.seekTo(targetFrame)`, then `play(e)` with the real
   MouseEvent.

Clamp the target frame to `[0, durationInFrames - 1]`.

#### Empty-area click (nice-to-have)

Clicking on the Beats track outside any clip seeks the player to the
corresponding frame proportionally. Does NOT change selection. Low cost,
worth including.

#### Playhead indicator

- Local `useState<number>(0)` for `currentFrame`.
- `useEffect`: subscribe `playerRef.current?.addEventListener("frameupdate",
  (e) => setFrame(e.detail.frame))` and unsubscribe on cleanup.
- Render a 2px vertical `<div>` at `left: (frame / durationInFrames) * 100%`.
- Re-renders only Timeline; Panel and Player are untouched.

### `<Panel>` (panel.tsx, refactored)

Props change to include `selection`:

```ts
{
  story: Story;
  selection: Selection;
  onChange: (story: Story) => void;
  dirty: boolean;
  onSave: () => void;
}
```

Header (title + Save button) stays at the top, constant across selections.

Body renders one of two views:

- `selection.kind === "story"` — Palette & background section + Background
  section. (Existing controls from current `panel.tsx` lines 163–283,
  unchanged in field set.) Header reads `Story`.
- `selection.kind === "beat"` — One beat's controls (current lines 287–388)
  for `story.beats[selection.index]` only. Header shows
  `{index + 1}. {beat.text}` plus the beat's `kind` chip. Same fields:
  kind, duration, easing, direction (hidden for `generativeFill`),
  dynamics, stagger, anim in, scale, glow, color, plus the read-only shape
  note for morph beats.

Removed from the panel:

- The "Beats (N)" section that renders all beats as a stacked list
  (current lines 286–390). Timeline owns that now.
- The `<Card>` scaffold component (no longer needed).

Kept: the footer hint about "reprompt Claude" — it's good context.

### `<Terminal>` (terminal.tsx)

Renders a full-height pane in the left column.

#### Frontend

Dependencies: `xterm`, `xterm-addon-fit`, `xterm-addon-web-links`.

On mount:

1. Create `Terminal` instance with a dark theme matching the studio chrome.
2. Attach `FitAddon` and `WebLinksAddon` (web-links makes URLs clickable —
   important for the Claude Code OAuth flow that prints a login URL).
3. Open xterm into a `<div ref>`.
4. Open WebSocket to `ws://127.0.0.1:<viteHmrPort>/__terminal`.
5. Wire `xterm.onData(data => ws.send(data))` for keystrokes upstream.
6. Wire `ws.onmessage(ev => xterm.write(ev.data))` for output downstream.
7. `FitAddon.fit()` on mount, on window resize, and on pane resize. Send
   `{ kind: "resize", cols, rows }` JSON to the backend after each fit.

On unmount: close socket and dispose xterm.

If the WebSocket fails to connect or disconnects, xterm writes a single
line: `[terminal disconnected — reload to reconnect]`. No auto-reconnect
loop.

#### Backend (Vite plugin in `vite.editor.config.ts`)

Reuse the existing plugin pattern that hosts `/__save-story`. Add a
WebSocket server attached to the same HTTP server, listening on path
`/__terminal`.

Dependencies (dev): `node-pty`, `ws`.

Per connection:

1. `spawn` a PTY: `process.env.SHELL || "/bin/zsh"`, args `["-l"]`, with
   `cwd` = project root and `env` inherited.
2. `pty.onData(data => ws.send(data))`.
3. `ws.on("message", msg => …)`:
   - If `msg` parses as `{ kind: "resize", cols, rows }` → `pty.resize(cols, rows)`.
   - Else write the raw string/buffer to `pty.write(...)`.
4. `ws.on("close", () => pty.kill())`.

Bind to `127.0.0.1` only. No auth on the socket — same trust model as the
existing `/__save-story` route. This is a local dev tool.

#### Login flow

The user types `claude` in the embedded terminal. The Claude Code CLI runs
its own OAuth in a real browser tab; the URL it prints is clickable thanks
to `xterm-addon-web-links`. Credentials persist to `~/.claude/`. No
integration code needed from us — we just need a real PTY.

#### Failure modes

- `node-pty` import fails (native module build failed): plugin logs the
  error; WS responds with a clear error message that surfaces in xterm
  (e.g. `[terminal unavailable — try: npm rebuild node-pty]`). The rest of
  the studio continues to work.
- PTY spawn fails: same surface — error written to the WS, no crash.

## Keyboard shortcuts

A single `useEffect` in `App.tsx` registers a `keydown` listener on
`window`:

| Key    | Action                                                       |
|--------|--------------------------------------------------------------|
| Space  | toggle `playerRef.current?.isPlaying() ? pause() : play(e)`  |
| ←      | `seekTo(currentFrame - fps)` (1s back)                       |
| →      | `seekTo(currentFrame + fps)` (1s forward)                    |
| Home   | `seekTo(0)`                                                  |
| End    | `seekTo(durationInFrames - 1)`                               |

**Guard:** skip the handler when `e.target` matches `input, textarea,
[contenteditable="true"]`, or when focus is anywhere inside the terminal
pane (check `e.target.closest('[data-terminal-root]')`). xterm captures
keys via its own DOM and bubbles them, so the closest-ancestor check is
sufficient — we don't need to special-case xterm internals. For Space,
call `e.preventDefault()` to prevent page scroll.

Reading `isPlaying()` via the ref keeps the handler stable — no need to
recreate it on play-state changes.

## Data flow

### Slider drag (live-preview-while-tweaking)

```
slider onChange
  → patchBeat(i, { dynamics })
  → onChange(newStory)
  → App.tsx setStory(...)
  → re-render: Panel (new beat values), PlayerStage (new inputProps)
  → Player re-renders KineticStory with new props → user sees the change
  Timeline does not re-render (beats reference + count unchanged → memo skips)
```

Auto-seek-and-play on beat selection ensures the user is parked at the
relevant beat with playback running, so slider tweaks animate in real time.

### Selection click

```
Timeline onSelect({ kind: "beat", index: 3 })
  → App.tsx setSelection(...)
  → playerRef.seekTo(frameAtStartOfBeat3), then play(e)
  → re-render: Panel (beat 3's controls), Timeline (selection style)
  Player does not re-render (inputProps unchanged); it plays from new frame
```

### Memoization

- `Timeline` wrapped in `React.memo`. Re-renders only on `story.beats`
  reference change, selection change, or duration change. Frame updates use
  local state.
- `PlayerStage` wrapped in `React.memo`. `inputProps` is the same `story`
  reference — stable as long as nothing changes.
- `Panel` not memoized — we want it to re-render on selection and story
  changes.

## Error handling

- `story.json` fetch/parse failure: existing red error pane stays.
- Selection points to a beat that no longer exists: `useEffect` clamp to
  `{ kind: "story" }`.
- `playerRef.current` null: all transport/keyboard handlers no-op via
  optional chaining (existing pattern).
- `seekTo` out-of-range frame: clamp to `[0, durationInFrames - 1]` in a
  small helper.
- Terminal WS or PTY failures: see Terminal failure modes above.

## Verification

This is a UI tool with no test infrastructure today. Verification is
manual, performed by running `npm run editor` and confirming:

1. Click each beat → Properties updates to that beat → Player seeks to the
   beat's start frame and plays.
2. Click Story track → Properties shows palette + background → Player
   seeks to 0.
3. Drag a slider while playback runs → animation reflects new value next
   loop. Drag while paused → static frame updates per change.
4. Keyboard: Space toggles play/pause; ← / → seek 1s; Home / End jump.
   Focus inside the Properties panel inputs and the terminal: Space and
   arrows do NOT steal from typing.
5. Save button still writes `story.json` correctly; dirty indicator works.
6. Terminal: open the studio → terminal pane shows a shell prompt in the
   project directory. Type `claude` → OAuth URL appears and is clickable.
   After login, type prompts; `kinetic` CLI and git commands work too.
7. Terminal resize follows window resize without visual breakage.
8. `app/` deletion does not break `npm run studio`, `npm run kinetic`, or
   `npm run render`.

Unit/integration tests are out of scope for this change. If the user
decides tests are needed, that's a separate spec.

## README updates

- Remove the `npm run player` line from the run table.
- Remove the `app/` row from the file map.
- Add a section describing the studio layout (terminal / preview /
  timeline / properties) and the keyboard shortcuts.
- Note the `node-pty` native build requirement (one-line, with the
  `npm rebuild node-pty` recovery command).

## Dependency changes

Added:

- `xterm`, `xterm-addon-fit`, `xterm-addon-web-links` (runtime, used by
  `editor/terminal.tsx`)
- `node-pty`, `ws` (dev, used only by `vite.editor.config.ts`)

Removed: none. (`@remotion/player` stays — the studio still uses it.)

## Open implementation questions for the plan

- Exact Vite HMR/WS port handling. Vite by default reuses the HTTP server
  for HMR; we should attach the terminal WS to that same server to avoid a
  second listener. The plan should verify this works in dev and degrades
  cleanly if the port shifts.
- Whether the left terminal column needs a drag-to-resize handle in v1, or
  if a fixed 360px is acceptable. Recommend fixed for v1, add resize later.
- Whether to show beat clip duration text inside each clip when the clip
  is wide enough. Recommend yes, with overflow-clipping for narrow clips.
