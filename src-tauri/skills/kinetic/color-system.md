---
name: kinetic-color-system
description: Load when the user asks about colors — background, text, accents, gradients, glow, drop shadows, contrast, palette swaps, "make it more X" where X is a color quality.
---

# Color system

## Story-level palette

```jsonc
{
  "bgColor":      "#0a0a14",   // hex, any
  "bgColor2":     "#1a1030",   // gradient end (only used when background.kind === "gradient")
  "textColor":    "#fafafa",   // default per-letter color
  "accentColor":  "#7c5cff",   // 2nd palette slot — used by perLetterPalette + some shaders
  "accent2Color": "#ff5ca8",   // 3rd palette slot
  "glowIntensity": 1           // 0..2, master multiplier on per-beat glow
}
```

`textColor` / `accentColor` / `accent2Color` are the palette. When
`perLetterPalette: true` is set on a beat, letters cycle through
these three in order.

## Background

`background.kind`:

- `"gradient"` — linear from `bgColor` to `bgColor2`. The default,
  cheapest, most flexible.
- `"shader"` — animated GPU effect (`shaderStyle: "aurora" |
  "flowField" | "mesh"`) with `motion: 0..1` and `grain: 0..1`.
- `"image"` / `"video"` — user-supplied asset; you do NOT create these
  beats (see render-pipeline.md for the ownership rule).

## Per-beat color overrides

- `color: "#hex"` — uniform override for THIS beat. Wins over
  `textColor`. Wins over `perLetterPalette` if both are set on the
  same beat.
- `perLetterPalette: true` — see "story-level palette" above.

## Glow

Per-beat `glow: 0..60` (px). The story-level `glowIntensity` (0..2)
multiplies it, so the user can dim all glow at once without editing
every beat. Defaults play well at `glow: 4..8` with
`glowIntensity: 1`.

## Drop shadows

`shadowLayers: 0..8` adds offset drop-shadows behind the type — gives
depth without 3D. `shadowColor: "#hex"` picks the color (use an
accent for the editorial look, black for serious depth).

A clean depth recipe: `shadowLayers: 3, shadowColor: "#7c5cff"` over
a dark background.

## Picking palettes

The user often just says "make it warmer" / "more cyberpunk" / "more
editorial". You're allowed to pick the actual hexes. Some safe
starting points:

- Warm: `bgColor: "#2a1a05", bgColor2: "#0a0500", textColor:
  "#fff4d6", accentColor: "#ff9a3c", accent2Color: "#ff5ca8"`.
- Cyber: `bgColor: "#05050f", bgColor2: "#1a0d2e", textColor:
  "#e0f2ff", accentColor: "#00f0ff", accent2Color: "#ff00aa"`.
- Editorial: `bgColor: "#0a0a0a", bgColor2: "#1a1a1a", textColor:
  "#fafafa", accentColor: "#c5c5c5", accent2Color: "#8b8b8b"`.

## Things to check before saving a color change

- Contrast: `textColor` against `bgColor`. A neon-on-neon palette
  will be unreadable. If the user asks for "all hot pink" anyway,
  bump `shadowLayers` so the type stays legible.
- Per-letter palette readability: if `perLetterPalette` is on,
  ALL THREE of `textColor / accentColor / accent2Color` must read
  on the background.
