# Remotion Tests — Interactive Video Generation with Claude

A working playground for **Remotion** (make videos with React) wired for the
**Claude Code** workflow. Built to learn the fundamentals hands-on.

## What's here

```
src/HelloVideo.tsx   The video composition — a plain React component.
                     Animation lives here (useCurrentFrame, interpolate, spring).
src/Root.tsx         Registers <Composition>s — the "render recipe" (size/fps/duration/props).
src/index.ts         registerRoot() — entry point for Studio + CLI renderer.
remotion.config.ts   Config for the CLI/Studio only.
vite.editor.config.ts Config for the four-pane editor app.
editor/App.tsx       Studio shell — four-pane grid, state, keyboard shortcuts.
editor/player.tsx    <PlayerStage> + <Transport> (play/pause/seek).
editor/timeline.tsx  Story track + Beats track + live playhead.
editor/terminal.tsx  Embedded xterm; talks to a node-pty PTY over WS.
editor/panel.tsx     Selection-driven properties panel.
```

## Run it

```bash
npm run studio      # Remotion Studio — visual editor at localhost:3000
npm run editor      # Kinetic story studio (terminal + preview + timeline + props) at localhost:5174
npm run render      # Render HelloVideo -> out/hello.mp4
#   e.g. npx remotion render HelloVideo out/hello.mp4 --props='{"title":"Hi"}'
```

## The mental model

Remotion has **two consumers of the same component**:

1. **CLI / Studio** — loads `src/index.ts` → `Root.tsx` → reads `<Composition>`
   metadata → renders frames to an MP4. Props come from `defaultProps` or
   `--props`. This is the "generate 1000 videos" path.
2. **`<Player>`** — a normal React component you embed in any app. Imports the
   composition component directly, feeds it `inputProps` at runtime. This is
   the "interactive video" path — the video reacts to your UI, your UI reacts
   to the video (via `playerRef`).

Write the composition once; both paths use it.

## The studio (`npm run editor`)

A four-pane editor at `localhost:5174`:

```
┌─────────────┬──────────────────────┬──────────────┐
│  TERMINAL   │       PREVIEW        │  PROPERTIES  │
│             ├──────────────────────┤              │
│  (xterm +   │      TIMELINE        │ (selection-  │
│   node-pty) │                      │  driven)     │
└─────────────┴──────────────────────┴──────────────┘
```

- **Timeline**: each beat is a clip whose width is proportional to its
  duration. Click a clip to select it AND seek the player to its start.
  A yellow playhead line shows the current frame.
- **Properties**: shows props for the selected element only — either the
  Story (palette, background, font, glow) or one beat (kind, easing,
  dynamics, etc.). Drag a slider while playback is running to see changes
  animate in real time.
- **Terminal**: a real PTY in the project directory. Type `claude` to
  drive script-level changes from inside the studio. Login URLs are
  clickable.

### Keyboard shortcuts

| Key      | Action                       |
|----------|------------------------------|
| Space    | Toggle play / pause          |
| ← / →    | Seek ±1 second               |
| Home     | Jump to first frame          |
| End      | Jump to last frame           |

Shortcuts are disabled while typing in input fields or the terminal.

### Native module note

`node-pty` is a native module. On macOS it installs prebuilt binaries. If
the terminal pane shows `[terminal unavailable ...]`, run:

```bash
npm rebuild node-pty
```

## Best practices baked into this repo

### Composition / animation
- **Time = `useCurrentFrame()`.** Never `setTimeout`, `requestAnimationFrame`,
  or CSS animations — renders must be deterministic (frame N always looks the
  same). Everything is derived from the frame number.
- **`interpolate(frame, [in,out], [from,to])`** for linear tweens. Always set
  `extrapolateLeft/Right: "clamp"` unless you want values to shoot past the range.
- **`spring({frame, fps})`** for natural motion (entrances, bounces) instead of
  linear interpolation.
- **Delay** an element by offsetting frame: `spring({ frame: frame - 15, fps })`.
- **Keep something always moving** (a subtle breathe/drift) so scenes never
  look frozen.
- **Type your props** and pass the same shape via `defaultProps` and `inputProps`.

### Player (interactive)
- **Memoize `inputProps`** with `useMemo` — a new object every render re-renders
  the whole Player tree.
- **Isolate `<Player>`** in its own component, separate from controls. The
  playhead updates ~30×/sec; don't let that re-render your forms.
- **Pass the real browser event** into `playerRef.current.play(e)` — keeps the
  call in the user-gesture context and dodges autoplay blocking.
- **Drive playback via `playerRef`** (`play`, `pause`, `seekTo`, `getCurrentFrame`)
  rather than lifting frame state into React.

### Claude Code workflow (how to actually generate videos with AI)
- Official path: `npx create-video@latest` → Blank template + TailwindCSS +
  **Install Skills**. The skills teach Claude Remotion's APIs and pitfalls.
- Run the Studio (`npm run dev`) in one terminal, `claude` in another. Prompt
  the video in natural language; watch it update live in the Studio.
- **Keep an approval step.** Have Claude show you the script/captions/props
  before rendering — review brand voice and message.
- For social/vertical video: keep text in the safe zone (≥150px top, ≥170px
  bottom, ≥60px sides). Headlines 56px+, body 36px+, nothing under 28px.
- Claude needs *design* knowledge (color, type, easing, pacing), not just
  Remotion syntax — the good outputs come from prompting both.
- Remotion's superpower is **parametrization**: one composition + a data file
  → personalized videos, localized versions, auto-updating data viz.

## Typography animations (ported from Portfolio 2026 v3)

`src/typography/` ports the portfolio's text-animation framework into Remotion.

The portfolio uses **`@chenglou/pretext`** (text line-layout) + **GSAP**
(motion on scroll). Remotion can't use GSAP — GSAP animates on wall-clock
time, Remotion needs every frame to be a pure function of the frame number.
So: **pretext is reused as-is** (it's pure measurement, deterministic), and
GSAP's *easing curves + timings* are ported to frame-based code.

```
typography/easings.ts       GSAP power3/power4 curves as plain functions.
typography/useLines.ts      Wraps pretext to split text into wrapped lines.
typography/AnimatedText.tsx Three components:
                              <LineReveal/>  line-by-line slide-up (power4.out)
                              <ScatterText/> scatter-to-assemble (power3.out)
                              <WidthReveal/> width-expand + reflow (power3.inOut)
TypographyDemo.tsx          Demo composition sequencing all three.
```

Pitfalls handled (worth knowing for any Remotion text work):
- **No `Math.random()` in a composition** — it changes every frame and the
  MP4 render diverges from the preview. `ScatterText` uses a seeded PRNG.
- **Load fonts before measuring** — pretext measures against a font; if it's
  not loaded it measures the fallback and line breaks shift. `TypographyDemo`
  uses `loadFont()` + `delayRender`/`continueRender`.
- **Split lines once, not per frame** — `useLines` memoizes on its inputs.

Render: `npx remotion render TypographyDemo out/typography.mp4`
Vertical: `npx remotion render TypographyDemo-Vertical out/typo-vertical.mp4`

## Kinetic typographic storytelling (the product prototype)

`src/kinetic/` is a script-driven kinetic-typography engine — the seed of a
product. A "story" is JSON (beats: word + animation + timing); the engine
animates it frame-accurately and renders to 9:16 social video.

```
kinetic/schema.ts        Zod schema = THE API SURFACE. A story is beats[],
                         each beat: { text, kind, durationInSeconds, shape? }.
kinetic/glyphs.ts        opentype.js: font glyphs -> SVG paths (for morphing).
kinetic/beats.tsx        The 3 capabilities:
                           reveal         - letter-by-letter build-in
                           morph          - shape morphs into the first letter
                           generativeFill - word masks a seeded noise field
kinetic/KineticStory.tsx Composition: sequences beats from the script.
```

Duration is DERIVED from the script (`calculateMetadata` + sum of beat
durations) — change the script, the timeline follows.

The `shape` field on a `morph` beat is the **LLM/agent integration point**:
an upstream model emits a clean, low-node SVG path ("a sprout that becomes
'G'") and flubber morphs it into the glyph. Low node count matters — sparse
paths morph cleanly, dense AI-traced paths badly. No `shape` -> morphs from
a circle, so it works with no model in the loop.

Bugs found + fixed during the build (all real Remotion/SVG pitfalls):
- `opentype.getBoundingBox()` MUTATES the command list — snapshot commands
  before calling it.
- `opentype.toPathData()` omits separators between adjacent numbers
  ("12.710.00") — build the `d` string from command objects, not regex.
- A bg `<rect>` inside a masked `<g>` paints over the masked content.
- `flubber.interpolate()` is expensive — `useMemo` it, never per frame.
- Seeded `random()` for the noise field — never `Math.random()` in a comp.

Render: `npx remotion render KineticStory out/kinetic.mp4`

## Vector providers + the `kinetic` CLI (the benchmark product)

`src/kinetic/providers/` is the plugin layer that turns this from "a video
tool" into "a vector-model benchmark harness". Every shape source — Recraft
API, Claude API, a local Ollama model, hand-written — implements one
`VectorProvider` interface and returns the same thing: a normalized 0..100
`d` path + benchmark metrics (node count, latency, cost, raw path count).

```
providers/types.ts        VectorProvider interface — the plugin contract.
providers/svg-extract.ts  raw SVG -> one normalized shape path (0..100 box).
providers/recraft.ts      Recraft V4 Vector — REAL API, verified working.
providers/claude.ts       Claude emits SVG markup — real (needs ANTHROPIC_API_KEY).
providers/ollama.ts       local model emits SVG — real (needs `ollama pull`).
providers/index.ts        the registry.
scripts/kinetic.ts        the CLI Claude Code drives.
```

### Setup
```bash
cp .env.example .env       # then fill in keys
#   RECRAFT_API_KEY     — get from recraft.ai
#   ANTHROPIC_API_KEY   — optional; NOTE: Claude Max does NOT cover API use
#   OLLAMA_MODEL        — optional; run `ollama pull qwen2.5-coder:7b` first
```

### The `kinetic` CLI — how Claude Code drives the tool
```bash
npm run kinetic providers                    # which providers are ready
npm run kinetic gen recraft "a sprout"        # generate one shape, print path
npm run kinetic set-shape 2 recraft "a sprout"  # generate + write into story.json beat 2
npm run kinetic benchmark "a circle->letter"  # ALL providers, same prompt, compare table
```

`set-shape` writes the generated path into `story.json` and flips that beat
to `morph`. `story.json` is the single source of truth — Claude Code edits
it via the CLI, Studio + the editor read it, renders use it.

`benchmark` is the core of the product: same prompt → every provider →
a comparison table scored on node count (morph quality), path count
(cleanliness), latency, and cost. Honest by design — a local model that
isn't pulled shows as a failure, not a faked result.

⚠️ **Security:** `.env` is gitignored. Never commit or paste API keys.
If a key was ever exposed, rotate it.

## The parameter editor — it's Remotion Studio

There is no custom editor app. **Remotion Studio's Props editor IS the
editor.** It auto-generates UI controls from the Zod schema in
`src/kinetic/schema.ts`:

- `.min().max().step()` on a number → a slider
- `zColor()` → a color picker
- `z.enum()` → a dropdown

So every per-element knob — `easing`, `direction`, `dynamics`, `scale`,
`staggerSeconds`, `glow`, `durationInSeconds`, per-beat `color`, and the
story-level palette — is just a schema field, and Studio renders it.
Open Studio (`npm run studio`), pick `KineticStory`, open the Props panel.

**Division of control (deliberate):**
- **Claude Code owns the sequence** — beats, order, animation kinds,
  generating shapes. To change the story, reprompt Claude Code.
- **The Studio props editor owns the parameters** — tweak how it feels,
  never regenerate. There is intentionally no "regenerate" button in Studio.

## The kinetic-storytelling skill

`.claude/skills/kinetic-storytelling/SKILL.md` teaches Claude Code how to
drive this project: the story schema, the `kinetic` CLI, the provider
setup, and the orchestrator/tweaker division above. It loads automatically
when you work on kinetic stories in this repo.

## Where to go next

- **Parametrize** `HelloVideo` with a Zod schema → get a schema-driven form in
  Studio + validated `--props` for batch rendering.
- Add **`<Sequence>`s** to build multi-scene videos with independent timing.
- Add **`<Audio>` / captions** — see the `remotion-best-practices` skill rules.
- Build a real **video editor UI** around `<Player>` (timeline, scrubber).

Docs: https://www.remotion.dev/docs/ · Player: https://www.remotion.dev/docs/player/
