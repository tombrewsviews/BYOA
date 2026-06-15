# Pulse — Generators vs Effects, new generators, dither, image/video sources

Date: 2026-06-15
Status: approved-pending-implementation
Area: `src/pulse/`, `editor/canvases/music/`

## Problem

The Pulse effect system has no explicit distinction between effects that **make
light from nothing** (generators) and effects that only **distort what's already
drawn** (distorters). A user adds "Pixelate" expecting visuals, gets a black
screen (Pixelate samples an empty/black previous pass), and has no signal why.
The fix is to make the generator-vs-effect distinction first-class in the data
model and the UI, add more generators (so there's always something to look at),
and add new ways to drive visuals — including real image/video media and a
dither look.

Two latent rendering bugs were also found and are fixed as a prerequisite.

## Part 0 — Prerequisite bug fixes (`src/pulse/Stage.tsx`)

1. **vec3 uniforms are silently dropped.** The per-pass uniform loop only sets
   `uniform2f` for arrays (`val.length === 2`). Effects that declare a `vec3`
   uniform (e.g. `bloomPulse`'s `uColor`) never have it set — so color edits do
   nothing and the effect can render black. Fix: also handle length-3 arrays via
   `gl.uniform3f`. (length-4 → `uniform4f` for completeness.)

2. Document the seed/black mechanic in code: the first pass samples a
   black-cleared FBO, so a stack with no generator stays black. This is
   intended; the UI changes (Part 1) make it discoverable rather than a trap.

## Part 1 — Categorize: `kind: 'generator' | 'effect'`

- Add `kind: "generator" | "effect"` to `EffectDescriptor` (`types.ts`).
- Tag every effect:
  - **generator**: wave, noiseField, bloomPulse, spectrumBars, plasma, voronoi,
    metaballs, tunnel, gradient, starfield, imageSource, videoSource
  - **effect**: pixelate, kaleido, chromaShift, feedbackTrails, contourLines,
    particleBurst, dither, mirror, posterize
- `StemRack` `+ add effect…` dropdown groups options into two `<optgroup>`s:
  **Generators** and **Effects**, each sorted by label.
- Each effect card shows a small kind badge (`GEN` / `FX`) next to the type
  dropdown, so the role is obvious at a glance.
- If a stem/group has ≥1 effect but **no generator** among them, show a one-line
  inline warning in that rack section: "No generator here — this stays black.
  Add a generator (plasma, noise field, …)."

## Part 2 — New procedural generators (no assets)

Each is one `<name>.frag.glsl` + `<name>.ts` descriptor + registry entry +
`help.ts` entry, following the existing GLSL1→GLSL3 wrap contract (declare
`precision highp float;`, `uniform vec2 uRes;`, `uniform sampler2D uPrev;`,
write `gl_FragColor`, multiply contribution by `uAlpha`). All sample and add
onto `uPrev` so they compose. Params exposed as sliders, bindable to audio.

- **plasma** — sinusoidal plasma field. params: scale, speed. (vec3 color cycle.)
- **voronoi** — animated cellular cells. params: density, speed.
- **metaballs** — merging blobs. params: count, radius, speed.
- **tunnel** — zooming polar tunnel. params: speed, twist.
- **gradient** — animated linear/radial gradient (simplest never-black base).
  params: angle, speed. (vec3 colorA/colorB or two scalars.)
- **starfield** — flying-through stars. params: density, speed.

## Part 3 — New effects (distorters)

- **dither** — ordered Bayer dithering (matrix size 2/4/8 via a `levels`/`size`
  param). Crushes `uPrev` to a retro/print look. (Bayer threshold from a small
  inline matrix; references: Codrops "Building a Real-Time Dithering Shader",
  Shadertoy 4x4/8x8 Bayer.)
- **mirror** — mirror across a vertical/horizontal axis. param: axis (0/1), split.
- **posterize** — quantize colors to N levels. param: levels.

## Part 4 — Image & Video source generators (renderer extension)

The one architectural addition: a generator can draw a **file** (image or video)
as its output, so distorters can operate on real media.

### Renderer (`Stage.tsx`)
- Bind a second texture unit (TEXTURE1 → `uTex`) when a pass declares it.
- The Stage gains an optional per-effect media map: for `imageSource` /
  `videoSource` effects, the host creates an `HTMLImageElement` /
  `HTMLVideoElement` (muted, looping, autoplay) from the effect's resolved URL
  and the draw loop uploads it to a texture each frame (video) or once (image).
- `uTex` is bound per-pass only for the media effects; other passes ignore it.

### Schema (`schema.ts`)
- `effectInstanceSchema` gains an optional `src?: string` (relative path under
  `<project>/assets/`). Generators `imageSource` / `videoSource` use it.

### Import / storage
- A "Choose image…/Choose video…" button in the effect card opens a Tauri file
  dialog, copies the chosen file into `<project>/assets/` (reusing the existing
  media-staging pattern), and stores the **relative** path in `src`.
- A new Tauri command `pulse_import_asset(projectPath, srcPath) -> relPath`
  copies the file and returns the stored relative path. URL resolution uses
  `convertFileSrc(<projectPath>/assets/<rel>)`, same as stems.

### Shaders
- `imageSource.frag.glsl` / `videoSource.frag.glsl`: sample `uTex`, optional
  `fit` (cover/contain) via uRes aspect, add onto `uPrev`. params: opacity, fit.

## Data flow (unchanged backbone)

`project.json` (Deck A/B effects) → `buildDeckPasses` → per-pass shader compile
→ ping-pong FBO chain → blit. Media effects add a texture upload before their
draw. Audio bindings resolve params exactly as today.

## Out of scope

- No new transition templates. No per-effect blend-mode UI (blend stays in the
  descriptor). No webcam input. No shader hot-editing UI (agent edits files).

## Testing / verification

- `npx tsc --noEmit` clean; `cargo check` clean (for the new Tauri command).
- For each new generator/effect: reconstruct the wrapped GLSL (the existing
  node check) and assert zero leftover `texture2D`/`gl_FragColor` and
  `precision < out < main` ordering.
- Manual: add each generator to a stem, confirm non-black render; add dither
  over a generator; import an image and a video, confirm they display and that a
  distorter (kaleido) folds them.
- vec3 fix: confirm bloomPulse color slider visibly changes the glow color.
```
