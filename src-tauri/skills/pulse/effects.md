# Pulse effects

The visual is a **stack** of effects composited bottom→top every frame. Each
frame the canvas is cleared to **black**, then effects run in stack order; each
samples the previous pass via `uPrev` and writes the next. The final pass is
what hits the screen.

## Generators vs effects — the #1 rule

Every descriptor has a `kind`:
- **generator** — draws light from nothing (adds onto `uPrev`).
- **effect** — only bends what's already there (samples `uPrev`, transforms it).

**A stack with no generator, or with only effects, renders pure black.**
A thin generator under a heavy effect (e.g. a 1px `wave` line under `pixelate`
at size 59) also renders black — the effect erases it. So:

> **Always keep at least one generator at the BOTTOM of the stack, and don't
> let a heavy effect above it smother it.** When asked for any new look, start
> from a full-screen generator (`gradient` or `noiseField` are the safest) and
> layer effects on top.

The `+ add…` menu groups effects into **Generators** and **Effects**, and each
card shows a GEN/FX badge.

## The catalog (28 effects)

Params are `name: min..max (default)`. Bind any param to a music feature (see
`bindings.md`). `blend` is how the pass composites onto `uPrev`.

### Generators (13)
- **wave** — travelling sine line. `amplitude 0..0.5 (0.15)`, `wavelength 0.02..1 (0.2)`. Thin — pair with a fill.
- **noiseField** — full-screen flowing noise. `scale 1..40 (8)`, `speed 0..4 (0.5)`. Safe base layer.
- **bloomPulse** — radial glow. `intensity 0..2 (0.6)`, `radius 0.1..1.5 (0.6)`, `colorR/G/B 0..1`. Bind intensity to onset.
- **spectrumBars** — low/mid/high bars. `low/mid/high 0..1 (0.5)`. Bind to matching `band*`.
- **plasma** — sinusoidal plasma. `scale 2..40 (12)`, `speed 0..4 (1)`. Bind speed to level.
- **voronoi** — animated cells. `density 2..24 (6)`, `speed 0..4 (1)`.
- **metaballs** — merging blobs. `count 2..12 (6)`, `radius 0.05..0.4 (0.18)`, `speed 0..4 (1)`.
- **tunnel** — zooming polar tunnel. `speed 0..4 (1)`, `twist 0..4 (1)`.
- **gradient** — animated gradient. `angle 0..6.28 (1.2)`, `speed 0..4 (0.5)`, `aR/aG/aB`, `bR/bG/bB`. **Simplest never-black base.**
- **starfield** — warp stars. `density 1..20 (8)`, `speed 0..6 (2)`.
- **particleBurst** — flashing dots. `count 4..80 (24)`, `burst 0..1 (0.5)`. Bind burst to onset.
- **imageSource** — draws a chosen image (`media: "image"`, uses `src`). `opacity 0..1`, `fit 0/1` (cover/contain).
- **videoSource** — draws a chosen video, muted+looping (`media: "video"`, uses `src`). `opacity 0..1`, `fit 0/1`.

### Effects (15)
- **pixelate** — square-pixel quantize. `pixelSize 1..80 (12)`, `falloff 0..1 (0.3)`, `tint`, `bounce`, `cascade`. Keep pixelSize ≤ ~20 over a thin generator.
- **kaleido** — mirror into wedges. `segments 1..12 (6)`.
- **chromaShift** — RGB split. `amount 0..0.05 (0.01)`. Bind to flux/onset.
- **feedbackTrails** — motion smear. `decay 0..0.99 (0.85)`.
- **contourLines** — topographic iso-lines. `freq 1..40 (8)`, `threshold 0..1 (0.5)`.
- **dither** — ordered Bayer dithering (retro). `scale 1..8 (2)`, `levels 2..8 (3)`.
- **mirror** — axis mirror. `axis 0/1`, `split 0.1..0.9 (0.5)`.
- **posterize** — colour banding. `levels 2..12 (4)`.
- **halftone** — comic dots from luminance. `scale 3..30 (8)`, `angle 0..1.57 (0.4)`. Great over media; bind scale to bandLow.
- **ascii** — glyph-cell ASCII look. `cell 4..24 (10)`. Bind cell to level.
- **crt** — scanlines + grille + barrel + vignette. `scanline 0..1 (0.4)`, `curve 0..0.5 (0.15)`, `vignette 0..1 (0.5)`.
- **edgeGlow** — Sobel neon edges. `strength 0.5..8 (3)`, `glow 0..3 (1.2)`, `r/g/b`. Bind glow to onset.
- **rgbDisplace** — datamosh channel tear. `amount 0..0.2 (0.04)`, `speed 0..20 (6)`. Bind amount to flux.
- **scanGlitch** — VHS band displacement. `intensity 0..0.5 (0.12)`, `blocks 4..60 (24)`. Bind intensity to onset.
- **oilPaint** — Kuwahara painterly smear. `radius 1..4 (3)`. Heaviest effect — lower radius if it stutters at fullscreen.

The artistic effects (halftone, ascii, crt, edgeGlow, rgbDisplace, scanGlitch,
oilPaint) are tuned to look great over `imageSource`/`videoSource` — stack them
on a media generator and bind their params to the audio for music-driven media.

## Editing the stack (no rebuild)

Effects, their `params`, and `bindings` live in `project.json` under
`decks.A.effects[]`. Editing it hot-reloads in ~300 ms — **no app rebuild**.
Each effect entry:

```jsonc
{
  "id": "fx-noise",          // any unique string
  "type": "noiseField",       // one of the 10 types above (or a new one)
  "enabled": true,
  "locked": false,            // preserve if true
  "params": { "scale": 8, "speed": 0.5 },
  "bindings": [ /* see bindings.md */ ]
}
```

Order in the array = stack order (index 0 = bottom). To give an instant
audio-reactive look, the minimal safe stack is a single `noiseField` with
`speed` bound to `master.level`.

## Authoring a NEW effect (real code change — needs the app repo)

When the user wants a behavior the 10 effects can't produce, create one. Two
files under `src/pulse/effects/<name>/`, then register it. Vite HMR
hot-reloads shader + descriptor edits live.

**1. `<name>.frag.glsl`** — a GLSL fragment shader. Contract:
- MUST declare `precision highp float;`, `uniform vec2 uRes;`,
  `uniform sampler2D uPrev;`.
- `uTime` (seconds) and `uAlpha` (transition opacity) are available.
- Write output with `gl_FragColor` and read textures with `texture2D` — the
  compositor auto-wraps to GLSL3. Don't write `#version` or `out`. The wrapper
  renames EVERY `gl_FragColor`→`outColor` and `texture2D`→`texture` (it uses
  `replaceAll`, so multiple uses are fine) and inserts `out vec4 outColor;`
  right after your `precision` line. Two things that WILL break compilation if
  you fight the wrapper: declaring your own `out` var, or putting any vec/float
  declaration before `precision`.
- Sample `uPrev` and add/mix onto it so the effect composes in the stack.
- Multiply your contribution by `uAlpha` to honor transitions.
- Declare a `uniform float u<Param>;` for every scalar param. **Vector uniforms
  work too**: declare `uniform vec3 uColor;` and return a 3- (or 2-/4-) element
  array from `uniforms()` — the Stage sets it via `uniform3f`/`uniform2f`/
  `uniform4f`. (A vec3 returned as a 3-array is the idiom for colour params.)

```glsl
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uAlpha;
uniform sampler2D uPrev; uniform float uIntensity;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 prev = texture2D(uPrev, uv).rgb;
  float glow = uIntensity * (0.5 + 0.5 * sin(uTime + uv.x * 6.2831));
  gl_FragColor = vec4(prev + vec3(glow) * uAlpha, 1.0);
}
```

**2. `<name>.ts`** — the descriptor. `params` become the UI sliders the user
can tweak; `uniforms` maps resolved param values + the live audio `frame` to
the GLSL uniforms:

```ts
import frag from "./<name>.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const <name>: EffectDescriptor = {
  type: "<name>", label: "<Label>",
  kind: "generator", // REQUIRED: "generator" (makes light) | "effect" (distorts uPrev)
  frag, blend: "add", // add|screen|alpha|multiply
  params: [ { name: "intensity", min: 0, max: 2, default: 0.6, step: 0.05 } ],
  uniforms: (p, frame) => ({ uIntensity: p.intensity }),
  // `frame` also exposes frame.timeSec and frame.master.{level,bandLow,...}
  // for effects that should react to audio even without a user binding.
};
```

**3. Register it** in `src/pulse/effects/registry.ts` — import it and add it to
the `EFFECTS` map. Add a `help.ts` entry too. Then it's selectable in the
grouped `+ add…` menu (by its `kind`) and usable as a `type` in `project.json`.

Expose every meaningful knob as a `param` (with sane min/max/default) so the
user can drive it from the UI and you can bind it to the music. Keep
generators full-screen and bright enough to survive effects above them.

## Media generators (image / video)

A generator with `media: "image" | "video"` draws a user-picked file. The Stage
binds the file to a second texture unit as `uTex` (TEXTURE1) and passes
`uTexAspect`; the effect's `src` (relative path under `<project>/assets/`)
resolves to a URL via the host. To author one, declare
`uniform sampler2D uTex; uniform float uTexAspect;` and sample `uTex` for the
media, compositing over `uPrev` (see `imageSource`/`videoSource` for the
cover/contain fit math). The user sets `src` via the card's file picker — don't
fabricate paths. Artistic effects (halftone, crt, oilPaint, edgeGlow, …) layered
over these are the path to music-driven media animations.
