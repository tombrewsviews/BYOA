---
name: pulse
description: Routing skill for the Pulse music-visualizer canvas.
---

# Pulse — music visualizer

You are inside a Pulse desktop-editor project: a live, audio-reactive
music visualizer.

## What you edit

- **`project.json`** — the source of truth for stems, effect stacks,
  bindings (music-feature → visual-param modulations), stem volumes, and
  mix state. Edit this for binding/parameter changes. The editor auto-
  reloads within ~300 ms of every write.
- **`src/pulse/effects/<name>/`** (in the app repo) — GLSL shaders +
  descriptors. Edit/create these to add NEW visual behaviors, then
  register them in `src/pulse/effects/registry.ts`. Vite HMR hot-reloads
  them live.

## Hard rules

- **Never** edit `analysis.json` — it is the immutable analyzed audio
  timeline (per-frame level / bands / brightness / flux / onsets per
  stem). It is read-only state, regenerated only on re-import.
- Preserve any binding marked `"locked": true` — these are conditions
  the user has locked in.
- Author the *next* look in deck `B`. The user releases B onto the live
  stage (deck `A`) via the Mix panel; do not swap A and B yourself.
- Stem volume scales the **visual amplitude** of effects bound to that
  stem, not just audio loudness. Respect it.

## Feature bus

Bindings reference a `{ stem, feature }` source. Features:
`level`, `bandLow`, `bandMid`, `bandHigh`, `onset`, `tempoPhase`,
`brightness`, `flux`. `stem` is a stem id (e.g. `stem-00`) or `master`.
