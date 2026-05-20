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

## You may set EVERY parameter

The Studio's inspector panel is a convenience for the user — it is NOT
the exclusive owner of beat parameters. Every field below is a plain
`story.json` value you can read and write. If the user asks for it, set
it: blend mode, opacity, static rotation, stagger curve, motion blur,
shadows, Ken Burns, axes — all of it. "The Studio owns the parameters"
means the user *can* tweak them by hand in the panel, not that you may
not. You own the whole document.

## Schema (current)

`background.kind` is ONLY `"gradient"` or `"shader"` — there is no
`"image"` / `"video"` background and no `background.src`. (Full-frame
video/image goes in a `videoClip` / `imageClip` beat, see below.)

```jsonc
{
  "bgColor":       "#0a0a14",
  "bgColor2":      "#1a1030",
  "textColor":     "#fafafa",
  "accentColor":   "#7c5cff",
  "accent2Color":  "#ff5ca8",
  "fontSize":      160,            // 40..400
  "fontFamily":    "RobotoFlex" | "Recursive" | "InterVF" | "SpaceGrotesk",
  "glowIntensity": 1,              // 0..2
  "durationInSeconds": 15,         // OPTIONAL — locks total runtime (0.5..600)
  "background": {
    "kind":        "gradient" | "shader",
    "shaderStyle": "aurora" | "flowField" | "mesh",
    "motion":      0.5,            // 0..1
    "grain":       0               // 0..1 — film-grain overlay strength
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
      "positionX":         0.5,     // -0.5..1.5 (allows off-canvas)
      "positionY":         0.5,
      "easing":            "power3.out",
      "enterDirection":    "up",
      "exitKind":          "none",
      "exitRotation":      -25,
      "dynamics":          0.5,
      "staggerSeconds":    0.05,
      "staggerCurve":      0,
      "scale":             1,       // 0.3..10
      "rotation":          0,       // -180..180 — STATIC tilt of the beat
      "fontFamily":        "RobotoFlex",
      "axes": {
        "wght": [400, 800],
        "wdth": [100, 110],
        "slnt": [0, 0]
      },
      "color":             "#hex",
      "perLetterPalette":  true,
      "glow":              4,
      "opacity":           1,       // 0..1
      "blendMode":         "normal", // any CSS blend mode (overlay,
                                     // screen, multiply, add, …) — how
                                     // this beat composites onto layers
                                     // below it
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
      "tileScrollAngle":   -15,

      // imageClip-only (see "Adding media" below)
      "imageSrc":          "/abs/path/to/project/screenshot.png",  // ABSOLUTE
      "kenBurnsZoom":      0.15,    // 0..1
      "kenBurnsDir":       "in" | "out",
      "kenBurnsPan":       0,       // 0..0.5
      "kenBurnsPanAngle":  0,       // -180..180 (0=right, 90=down)

      // videoClip-only (see "Adding media" below)
      "videoSrc":          "/abs/path/to/project/clip.mp4",  // ABSOLUTE
      "videoStartSec":     0,      // 0..3600 — in-point into the source
      "volume":            0       // 0..1 (default silent)
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

## Adding media — image and video clips

- `kind: "imageClip"` — a still image with Ken Burns zoom + pan.
- `kind: "videoClip"` — a local MP4 as a timeline clip.

You CAN add these yourself — anything the `+ Image` / `+ Video` buttons
do, you can do too. The buttons just (1) copy the file into the project
and (2) append a clip beat. You do the same two steps.

**The one rule: the file must physically exist inside the project, and
`imageSrc` / `videoSrc` must be the ABSOLUTE path to it.** A fabricated
path that isn't on disk renders nothing. So never invent a path to a
file you didn't put there — copy/download it first, then reference it.

Your CWD is the project root. Imported media lives in the project root
alongside `story.json` (NOT in a subfolder — that's where the buttons
put it too). The renderer resolves the src with Tauri's `convertFileSrc`,
which needs an **absolute** path — the same thing the buttons write. Get
the project's absolute path once with `pwd` and prefix your filenames
with it.

### Add a local image

```bash
# 1. Copy the file into the project (quote paths with spaces).
cp '/Users/me/Desktop/Screenshot 2026-05-06 at 13.16.00.png' ./screenshot.png
# 2. Get the absolute path you'll put in imageSrc:
echo "$(pwd)/screenshot.png"
```
Then append a beat (these defaults match the `+ Image` button):
```jsonc
{
  "text": "screenshot.png",        // filename — just a timeline label
  "kind": "imageClip",
  "track": <next free track>,
  "startSeconds": <playhead or where you want it>,
  "durationInSeconds": 4,
  "animateInPortion": 0.15,
  "animateOutPortion": 0.15,
  "imageSrc": "/Users/me/KineticStudio/vvv/screenshot.png",  // ABSOLUTE
  "kenBurnsZoom": 0.15,
  "kenBurnsDir": "in",
  "kenBurnsPan": 0,
  "scale": 1,
  "positionX": 0.5,
  "positionY": 0.5
}
```

### Add a local video

```bash
cp '/Users/me/Movies/clip.mp4' ./clip.mp4
echo "$(pwd)/clip.mp4"
```
```jsonc
{
  "text": "clip.mp4",
  "kind": "videoClip",
  "track": <next free track>,
  "startSeconds": 0,
  "durationInSeconds": 4,
  "animateInPortion": 0.1,
  "animateOutPortion": 0.1,
  "videoSrc": "/Users/me/KineticStudio/vvv/clip.mp4",  // ABSOLUTE
  "videoStartSec": 0,
  "volume": 0,
  "scale": 1,
  "positionX": 0.5,
  "positionY": 0.5
}
```

### Add a YouTube video

Download it into the project with `yt-dlp`, then add a `videoClip` beat
pointing at the resulting MP4 (absolute path):
```bash
yt-dlp --no-playlist --merge-output-format mp4 \
  -f 'bv*+ba/b' -o 'yt-%(id)s.%(ext)s' '<youtube-url>'
ls "$(pwd)"/yt-*.mp4   # the downloaded file's absolute path → videoSrc
```
(If `yt-dlp` isn't installed, tell the user to `brew install yt-dlp`.)

### Collisions

If a file with that name already exists in the project, pick a distinct
name (the buttons append `-2`, `-3`, …) so you don't clobber existing
media: `cp src.png ./photo-2.png`.

### Retiming / repositioning existing clips

You can also edit any existing clip's `startSeconds`, `durationInSeconds`,
`videoStartSec` (video in-point), `track`, `positionX/Y`, `scale`,
`rotation`, `volume`, and the `kenBurns*` fields.

If the user asks "make a word appear when the singer says X", read the
existing video beat's `startSeconds` + `videoStartSec` and place your
text beat accordingly on a higher track.
