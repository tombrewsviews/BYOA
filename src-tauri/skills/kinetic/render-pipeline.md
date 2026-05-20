---
name: kinetic-render-pipeline
description: Load when the user asks about exporting, rendering frames, FPS, resolution, output format, performance, or "why is this slow" — anything to do with the studio's render and playback pipeline.
---

# Render pipeline

## What the studio renders, what you don't touch

The studio runs Remotion at **30 fps, 1080×1920** (portrait reels).
You do not configure these — they are fixed for v1.

The composition you see in the Player is the SAME composition that
gets exported when the user hits render. There is no "preview vs.
final" — what you scrub is what you ship. This is intentional: the
agent should never be surprised by export.

## Performance levers (you DO control these)

- **Beat count.** Each beat compiles to a small animation tree. A
  10-beat story renders instantly; a 200-beat one will be sluggish
  in the Player. If the user asks for "a hundred beats", suggest
  reducing first.
- **`background.kind: "shader"`** with high `motion` is the most
  expensive choice. Editorial cuts using `"gradient"` are
  effectively free.
- **`glowIntensity` and `shadowLayers`.** Both are per-frame filter
  operations. Halving them is the fastest perf win.
- **`motionBlur`** (0..20 px). Genuinely expensive at high values.
  Use sparingly on hero beats.

## Things you DO NOT touch

- **Render output paths.** The studio writes to `<project>/output/`
  on render. Don't create that directory yourself, don't suggest
  ffmpeg commands.
- **The Remotion composition itself.** It is fixed. There is no
  `Composition.tsx` in the project — the studio owns it. Creating
  `.tsx` files in the project root is a no-op.
- **fps / width / height.** Not your knobs.

(Adding `videoClip` / `imageClip` media beats IS your job — copy/download
the file into the project, then point `videoSrc` / `imageSrc` at it. See
"Adding media" in `layer-composition.md`. The only rule is that the file
must really exist on disk; don't invent a path to a file you didn't put
there.)

## Project preview

When the user closes a project, the studio renders a tiny preview
MP4 to `.kinetic-studio/preview.mp4` (used by the project list).
This is automatic — you don't trigger it. If the preview looks
stale on the home screen, that's expected: it updates on the next
project close.
