---
name: kinetic-typography-system
description: Load when the user asks about fonts, weights, axes, letter spacing, or per-letter color — anything to do with how the type itself is set in Kinetic Studio.
---

# Typography system

Variable-font driven. The studio loads four variable faces, each with
animated axes (weight, width, slant).

## Font choice

`fontFamily` (story-level OR per-beat override) is one of:

- `"RobotoFlex"` — most expressive, full wght/wdth range, the default.
- `"Recursive"` — geometric, looks great oscillating.
- `"InterVF"` — clean sans, good for editorial cuts.
- `"SpaceGrotesk"` — display, tighter for hero words.

Per-beat `fontFamily` overrides the story default for that beat only.
Use this when one word wants a different voice from the rest (e.g.
a quote in Recursive among Inter words).

## Axes

```jsonc
"axes": {
  "wght": [400, 800],   // 100..1000, [start, end]
  "wdth": [100, 110],   // 25..151
  "slnt": [0, 0]        // -15..0
}
```

The beat animates each axis from `[0]` to `[1]` across the beat's
duration. Equal start/end = no animation on that axis. Wide ranges
read as energy; narrow ranges read as polish.

Common pairs:

- "Punch": `wght: [400, 900]` — text fattens as it lands.
- "Elastic": `wght: [300, 1000]`, paired with `easing: "elastic"`
  and `kind: "oscillate"`.
- "Settle": `wght: [800, 400]` — heavy entry, calm hold.

## Per-letter palette

`perLetterPalette: true` cycles `textColor → accentColor →
accent2Color` letter-by-letter. Use sparingly — it's the multi-color
"MAKE LIFE GOOD" look. Pick three accent colors at the story level
that read well together first (see `color-system.md`).

## Font size and scale

- `fontSize` (story-level) is the BASE point size, 40..400. Defaults
  to 160.
- Per-beat `scale` (0.3..10) multiplies the rendered size **AT REST**.
  Do NOT use scale to mean "starts big and shrinks" — the beat's
  `kind` handles entry animation. `scale > 2` will clip on most beats.

For "this word should look bigger than the rest", set the beat's
`scale: 1.4`. For "all words should be bigger", raise the story
`fontSize` instead.
