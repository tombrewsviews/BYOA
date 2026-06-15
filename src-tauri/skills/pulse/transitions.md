# Pulse transitions

The user authors the next look in **Deck B**, then **releases** it onto the
live **Deck A** via the Mix panel. On release, `mix.active` becomes
`"transitioning"`, `mix.progress` animates 0→1 over `mix.durationSec`, and the
renderer shows `blendDecks(A, B, shapeCurve(progress, curve), template)` each
frame. At progress 1, Deck B becomes the new Deck A and B resets.

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
