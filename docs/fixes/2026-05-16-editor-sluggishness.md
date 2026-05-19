# Editor sluggishness — root cause + fixes (2026-05-16)

## Symptom

The Tauri-shell Kinetic Studio editor felt very sluggish: typing in the
embedded terminal lagged, dragging clips on the timeline stuttered, the
whole app felt heavy even at idle.

## What was actually happening

Three compounding causes, in decreasing order of impact:

### 1. Remotion `<Player autoPlay loop />` ran from project-open

The Player was set to autoplay. It loops at 30fps and emits a
`frameupdate` event every tick. The studio's Timeline subscribes to
`frameupdate` to move its yellow playhead, calling
`setCurrentFrame(frame)` 30 times per second. That re-renders the whole
Timeline subtree (multi-track grid, absolutely-positioned clips with
percent-width math, the `+ Beat` button row) 30×/sec. **Even when the
user wasn't doing anything**, the editor was running a hot loop.

Fix: remove `autoPlay` from `<Player>` in `editor/player.tsx`. The
canvas opens paused; user starts playback via the Transport ▶ or by
double-clicking the canvas.

### 2. Library tab kept 10 looping videos decoding in the background

The Library/Terminal tab switcher used `display: none` to hide the
inactive tab. The library has 10 `<video autoPlay loop muted>` preview
MP4s, one per card. WebKit (Tauri's macOS webview) **continues
decoding video frames for `display: none` videos** — they don't pause.
So even while typing in the terminal, 10 looping MP4 decoders were
running in parallel competing for CPU.

Fix: only mount the Library subtree when its tab is active
(`leftTab === "library" && <Library/>` in `editor/App.tsx`). The
Terminal stays mounted across tab switches (because the pty would die
otherwise), but Library mounts/unmounts on demand. Switching back to
Library remounts cleanly and is fast.

### 3. Drag handlers fired `setStory` on every pointermove

Both the Timeline clip drag (move/resize/track-change) and the preview
position drag updated `story.beats[i]` on every `pointermove` event —
that's 60+ events/sec on most trackpads. Each `setStory` cascades
through React → KineticStory → all beat renderers, which is heavy
(opentype glyph paths, flubber interpolation, etc.).

Fix: rAF-coalesce pointer events in both drag handlers
(`editor/timeline.tsx`, `editor/player.tsx`). Capture the latest
`(dx, dy)` on every event, but only `requestAnimationFrame` one flush
per frame. At most one `setStory` per ~16ms; beyond that the human eye
can't see the difference anyway.

## How to verify the fix is still working

There's a perf overlay built in: press **⌃P (Ctrl+P)** with the editor
focused. It shows:

- `setStory count` — should grow only when the user drags or the agent
  writes.
- `frameupdate Hz` — should be **0 while paused**. If it's 30 while
  paused, autoplay snuck back in.
- `recent setStory Δms` — interval between recent setStory calls.
  During a drag this should be ~16ms. If it's 1–5ms, the rAF coalescer
  isn't wired.

State is persisted in `localStorage` under `studio.perf` so toggling
once keeps it on across reloads.

The instrumentation lives in `editor/PerfOverlay.tsx`. The
`perf.bumpStory()` call is invoked from a `setStory` wrapper in
`editor/App.tsx`.

## If sluggishness comes back — checklist

Before changing code, **turn on the perf overlay** and look at:

1. `frameupdate Hz` at idle. Anything > 0 means something is driving
   the Player to play. Check `<Player autoPlay…>` in `editor/player.tsx`.
   Also check whether some keystroke handler is calling `playerRef.play()`
   unintentionally.

2. `setStory count` while idle. Anything increasing means a state-setter
   loop. Most likely culprits: a `useEffect` without proper deps, or a
   per-frame subscription in a parent component.

3. `setStory Δms` during a drag. If values are < 10ms, the rAF
   coalescing is broken. Check both `timeline.tsx beginDrag` and
   `player.tsx onPointerDown`.

4. Heavy `<video>` / `<canvas>` elements running while hidden. WebKit
   does **not** pause `display:none` videos — unmount the subtree
   entirely.

5. xterm renderer. The terminal uses `xterm-addon-canvas` (loaded after
   `term.open()` in `editor/terminal.tsx`). If that addon is missing or
   the DOM renderer is in use, typing in the terminal will feel slow.
   Verify `CanvasAddon` is imported and loaded.

6. Rust pty pipeline (`src-tauri/src/pty.rs`). It uses a reader thread
   + flusher thread with a ~1ms tail-fold window. If the flusher window
   is too large (anything > 4ms) typing latency rises. If too tight
   (< 0.5ms) it doesn't batch high-bandwidth output and the JS event
   loop chokes.

## Cross-file map of the fix

| File | What it does |
|---|---|
| `editor/player.tsx` | dropped `autoPlay`; rAF-coalesced position drag |
| `editor/timeline.tsx` | rAF-coalesced clip drag (move/resize/track) |
| `editor/App.tsx` | unmount Library when not visible; `setStory` wrapper bumps perf |
| `editor/PerfOverlay.tsx` | the diagnostic overlay (⌃P toggle) |
| `editor/terminal.tsx` | canvas renderer for xterm; `React.memo` on Terminal |
| `src-tauri/src/pty.rs` | reader + flusher threads, ~1ms tail-fold window |
