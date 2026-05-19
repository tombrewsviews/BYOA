---
name: kinetic-layer-composition
description: Load when the user asks to add, remove, reorder, retime, or compose beats — the structural side of the story. Includes tracks, the beats array shape, the illustration→text pattern, and how video/image clips fit in.
---

# Layer composition

## The beats array

`story.beats` is an ordered array. Each beat is a word OR an
illustration with its own timing. The composition's total duration
is the sum of `durationInSeconds` across all beats on track 0,
UNLESS the story sets `durationInSeconds` (which locks the runtime).

## Tracks

`track: 0` (default) is the main line. Higher tracks stack visually
on top — beats on different tracks render simultaneously.

- Track 0 — main word sequence.
- Track 1 — first overlay (e.g. a small caption while the main
  word holds).
- Track 2+ — additional overlays.

When the user asks for "two words at the same time", that's two
beats with the same `startSeconds` on different tracks.

## Timing

- `startSeconds` (optional) — explicit start. If omitted, the beat
  is placed sequentially after the previous beat ON THE SAME TRACK.
- `durationInSeconds` — total length.

For "X overlaps Y by half a second": set Y's `startSeconds` =
X's `startSeconds + X.durationInSeconds - 0.5`.

## Position on canvas

`positionX`, `positionY` — both 0..1 normalised.
- `0, 0` = top-left
- `1, 1` = bottom-right
- `0.5, 0.5` = center (default)

The user can drag a word in the preview to set these — when they do,
the studio writes the new values to `story.json` and you see them on
your next read.

## Schema (current)

```jsonc
{
  "bgColor":       "#0a0a14",
  "bgColor2":      "#1a1030",
  "textColor":     "#fafafa",
  "accentColor":   "#7c5cff",
  "accent2Color":  "#ff5ca8",
  "fontSize":      160,
  "fontFamily":    "RobotoFlex" | "Recursive" | "InterVF" | "SpaceGrotesk",
  "glowIntensity": 1,
  "durationInSeconds": 15,         // OPTIONAL — locks total runtime
  "background": {
    "kind":        "gradient" | "shader" | "image" | "video",
    "shaderStyle": "aurora" | "flowField" | "mesh",
    "motion":      0.5,
    "grain":       0,
    "src":         "..."
  },
  "beats": [
    {
      "text":              "launch",
      "kind":              "reveal" | "morph" | "generativeFill"
                         | "tile" | "oscillate" | "cinema"
                         | "shape" | "videoClip" | "imageClip",
      "startSeconds":      0,
      "track":             0,
      "durationInSeconds": 1.8,
      "animateInPortion":  0.4,
      "animateOutPortion": 0.25,
      "positionX":         0.5,
      "positionY":         0.5,
      "easing":            "power3.out",
      "enterDirection":    "up",
      "exitKind":          "none",
      "exitRotation":      -25,
      "dynamics":          0.5,
      "staggerSeconds":    0.05,
      "staggerCurve":      0,
      "scale":             1,
      "fontFamily":        "RobotoFlex",
      "axes": {
        "wght": [400, 800],
        "wdth": [100, 110],
        "slnt": [0, 0]
      },
      "color":             "#hex",
      "perLetterPalette":  true,
      "glow":              4,
      "shadowLayers":      0,
      "shadowColor":       "#hex",
      "motionBlur":        0,

      // morph-only
      "shape":             "M ... Z",
      "morphAnchorX":      0.5,
      "morphAnchorY":      0.5,
      "morphStartScale":   0.45,
      "morphStartRotation": -25,
      "morphSourceBeat":   0,
      "morphHoldPortion":  0.3,

      // tile-only
      "tileRows":          7,
      "tileScrollAngle":   -15
    }
  ]
}
```

## The illustration → text pattern (headline workflow)

Two beats that work as a pair: a `shape` beat draws the illustration,
then a `morph` beat with `morphSourceBeat: <i>` morphs it into a word.

```jsonc
{
  "beats": [
    {
      "kind": "shape",
      "text": "heart-illustration",
      "track": 0,
      "startSeconds": 0,
      "durationInSeconds": 3.0,
      "shapeSize": 0.5,
      "shapeEntry": "draw",
      "shapeExit": "morphOut",
      "shapePaths": [
        { "d": "M50,15 ...", "fill": "#ff5ca8" }
      ],
      "positionX": 0.5,
      "positionY": 0.5,
      "color": "#ff5ca8"
    },
    {
      "kind": "morph",
      "text": "love",
      "track": 0,
      "startSeconds": 2.0,
      "durationInSeconds": 2.0,
      "morphSourceBeat": 0,
      "morphHoldPortion": 0.1,
      "color": "#fafafa"
    }
  ]
}
```

The shape beat displays the heart for 3s. The morph beat starts at
2s (overlapping the last 1s of the shape) and morphs the heart
silhouette into "love"'s first letter while the rest of the word
fades in. **This is the workflow this studio is built for.** Whenever
the user wants an "illustration of X that turns into the word X",
reach for this pattern.

## Shape beats (standalone illustrations)

A `shape` beat is a non-text beat. Fill `shapePaths` with one or more
`{ d, fill?, stroke?, strokeWidth? }` entries — each becomes a
`<path>`. `text` is just a label for the timeline.

- `shapeSize: 0..1` — fraction of canvas height.
- `shapeEntry: "fade" | "scale" | "draw" | "fade-up"`.
- `shapeExit: "fade" | "scale-down" | "blur" | "morphOut" | "none"`.

Use `shapeExit: "morphOut"` to signal "I'm feeding into a morph beat".

## Video and image clips (user-owned)

- `kind: "videoClip"` — a local MP4 (YouTube-imported or user-picked).
- `kind: "imageClip"` — a still image with Ken Burns zoom + pan.

**The user owns these.** They import via the studio's `+ Video` /
`+ Image` buttons (file picker or YouTube URL). Do NOT create these
beats yourself; do NOT invent `videoSrc` / `imageSrc` paths.

You MAY:
- Reference existing video/image beats by index when composing.
- Retime / reposition / re-rotate existing clips — edit their
  `startSeconds`, `durationInSeconds`, `videoStartSec` (for video),
  `track`, `positionX`, `positionY`, `scale`, `rotation`, `volume`,
  `kenBurnsZoom`, `kenBurnsDir`, `kenBurnsPan`, `kenBurnsPanAngle`.

You MAY NOT:
- Set or change `videoSrc` / `imageSrc`.
- Insert a new clip beat with a fabricated `src`.

If the user asks "make a word appear when the singer says X", read
the existing video beat's `startSeconds` + `videoStartSec` and place
your text beat accordingly on a higher track.
