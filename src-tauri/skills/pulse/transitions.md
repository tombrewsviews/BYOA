# Pulse transitions

**Deck A** is the working bench (main window). The user authors it (with your
help), then clicks **"Send Bench → Preview"** to push Deck A's look into
**Deck B**, the live look shown in the separate Preview window. On send,
`mix.active` becomes `"transitioning"` and `mix.progress` animates 0→1 over
`mix.durationSec`; Deck B interpolates from its old look to the snapshot of
Deck A. At progress 1, Deck B holds the new look. Deck A (the bench) is never
altered by a send.

`mix.template` (in `project.json`):

- `cut` — hard switch at the midpoint.
- `crossfade` — alpha-blend A and B (both rendered, mixed by progress).
- `progressive` — per-effect staggered handoff.
- `seesaw` — oscillating A↔B weight that settles on B.
- `fast` / `slow` — crossfade with preset short/long pacing.
- `morphParams` — numerically interpolate shared params; non-shared effects fade.

`mix.curve` reshapes progress: `linear | ease | exp | seesaw | step`.

Do not swap A and B yourself or set `mix.active` directly — the user drives
release from the Mix panel. You may author Deck B's effects/bindings freely.
