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

## Generators vs Effects

Every effect has a `kind`: **generator** (makes light from nothing — adds onto
a black/previous pass) or **effect** (only distorts `uPrev`). A stack needs ≥1
generator at the BOTTOM or it renders pure black. The `+ add…` menu groups them;
each card shows a GEN/FX badge. See `effects.md` for the full catalog (28
effects) and which is which.

## Hard rules

- **Never render black.** Each frame the canvas clears to black, then the
  effect stack composites bottom→top. Effects (pixelate, kaleido, chromaShift,
  dither, halftone, crt, …) only bend what's already drawn — a stack with no
  **generator** (wave, noiseField, plasma, gradient, imageSource, …), or a thin
  generator under a heavy distorter, shows nothing. Always keep a generator at
  the BOTTOM and don't let a distorter above it smother it. See `effects.md`
  for the full effect+param reference and how to author new effects.
- **Never** edit `analysis.json` — it is the immutable analyzed audio
  timeline (per-frame level / bands / brightness / flux / onsets per
  stem). It is read-only state, regenerated only on re-import.
- Preserve any binding marked `"locked": true` — these are conditions
  the user has locked in.
- **Deck `A` is the WORKING BENCH** (the main window) — this is where you
  and the user author the visualization. Edit Deck `A`'s effects/bindings in
  `project.json`, and edit/create shader code in `src/pulse/effects/` to
  change how the bench looks.
- **Preview sync mode** lives in `mix.previewSync` (`"continuous"` | `"manual"`):
  - `continuous` — the Preview window mirrors Deck A live, so every edit you
    make to Deck A shows in the preview immediately.
  - `manual` — the preview renders only Deck B (black until the user clicks
    "Send Bench → Preview", which transitions Deck A → Deck B).
  In manual mode, do NOT touch Deck `B` yourself or swap A/B — the user drives
  the hand-off. Edit Deck `A` only.
- Stem volume scales the **visual amplitude** of effects bound to that
  stem, not just audio loudness. Respect it.
- **Media generators** (`imageSource`, `videoSource`) carry a `src` field — a
  path relative to `<project>/assets/` (e.g. `"assets/clip.mp4"`). The user
  picks the file via the card's "Choose image/video…" button (it copies into
  assets/ and sets `src`). You may change params/bindings on these but don't
  fabricate `src` paths to files that don't exist.

## Feature bus

Bindings reference a `{ stem, feature }` source. Features:
`level`, `bandLow`, `bandMid`, `bandHigh`, `onset`, `tempoPhase`,
`brightness`, `flux`. `stem` is a stem id (e.g. `stem-00`) or `master`.
