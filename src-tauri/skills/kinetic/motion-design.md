---
name: kinetic-motion-design
description: Load when the user asks for animation feel — easings, enter/exit kinds, timing, "make it bouncier", "make it land harder", or wants a specific beat kind (reveal/morph/cinema/oscillate/tile/generativeFill).
---

# Motion design

## Beat kinds (the entry+exit grammar)

- **reveal** — letter-by-letter build-in. The general-purpose default.
  Drive feel with `easing`, `enterDirection`, animated `axes`.
- **morph** — a custom SVG shape morphs into the word's first letter,
  rest of the word fades in around it. Source shape from:
    1. `morphSourceBeat: <i>` — points at a sibling **shape** beat
       (the headline workflow — see `layer-composition.md`).
    2. `shape: "M…Z"` — inline SVG path.
    3. neither → falls back to a default circle.
  `morphHoldPortion: 0.3` makes the source shape stay still for the
  first 30% of the beat before transforming. Use to give the user
  time to read the illustration first.
- **generativeFill** — word masks a churning blob field. Emphasis /
  payoff beats.
- **tile** — word repeats in a marquee grid that scrolls diagonally.
  The RISE / ELASTIC tiled look.
- **oscillate** — letters wobble wght+scale around 1.0. Pair with
  `axes.wght: [300, 1000]` for the full range.
- **cinema** — a single word zooms in massively from off-screen,
  holds, then optionally zooms out. For payoff or hero moments. The
  dramatic entry zoom is built in — start size scales with `dynamics`
  (0.5 ≈ 9× start, 1.0 ≈ 12× start). Leave `scale: 1`; do not raise
  it to control entry.

## Timing

- `durationInSeconds` — total length of the beat.
- `animateInPortion` (0.1..0.9) — fraction of duration spent
  animating in.
- `animateOutPortion` (0..0.6) — fraction spent animating out. A
  beat with `animateOutPortion: 0` holds until cut.
- `staggerSeconds` (0..0.2) — per-letter delay. Higher = more
  letter-by-letter feel.
- `staggerCurve` — 0 = linear stagger, 1 = wave (ends arrive last).

## Easing

`easing` controls the curve from entry to settled:

- `"power3.out"` — clean, professional default.
- `"power3.inOut"` — slow start AND slow end. Good for hero cuts.
- `"power4.out"` — sharper landing.
- `"spring"` — overshoots once, settles.
- `"elastic"` — overshoots, then wobbles. High energy.
- `"back.out"` — undershoots then snaps back. Playful.

## Direction

`enterDirection` is where letters fly in from:

- `"up"`, `"down"`, `"left"`, `"right"` — directional slide.
- `"scale"` — zoom in from 0.
- `"vertical-roll"` — letters tumble down with rotation. The most
  distinctive of the bunch.

`exitKind`:

- `"none"` — cut. Good when the next beat enters fast.
- `"rotate"` — spin out with `exitRotation` (-180..180 deg).
- `"drop"` — fall off the bottom.
- `"scatter"` — letters fly in random directions.
- `"blur"` — soft fade with motion blur.
- `"echo"` — leaves a fading copy behind.
- `"morphOut"` — signals continuity with a following morph beat.
  Use on a `shape` beat that feeds into a `morph` beat.
- `"zoom"` — push to camera and disappear.

## Dynamics knob

`dynamics: 0..1` is the "intensity" master:

- 0.0 — subtle, broadcast-safe.
- 0.5 — default, lively.
- 1.0 — maximum punch. Animations overshoot harder, motion blur is
  exaggerated, entry zooms (on `cinema`) start bigger.

If the user asks "make it punchier" without naming a specific
parameter, raise `dynamics` first. Combine with high `staggerCurve`
and a wide `axes.wght` range for the elastic family of looks.

## Common patterns

- **"Land vertically, then exit rotating"**:
  `enterDirection: "vertical-roll"`, `easing: "back.out"`,
  `exitKind: "rotate"`, `exitRotation: -20`.
- **"Elastic feel"**: `easing: "elastic"`, `staggerCurve: 0.6`,
  `dynamics: 0.8`, `axes.wght: [400, 900]`.
- **"Soft fade-out"**: `exitKind: "blur"`, longer `animateOutPortion`.
- **"Editorial cut"**: `easing: "power3.inOut"`, low `dynamics: 0.3`,
  no per-letter palette, `InterVF` font.
