---
name: kinetic-storytelling
description: Use when working in this kinetic-typography video project — creating or editing kinetic type stories, generating vector shapes with Recraft, driving the kinetic CLI, or explaining the Claude-orchestrator / Studio-tweaker workflow. Triggers on "kinetic story", "story.json", "add a beat", "morph", "generate a shape", "kinetic CLI", "render the story".
---

# Kinetic Storytelling — how Claude Code drives this app

This project is a **kinetic-typography video tool**. A story is animated
word-by-word; words morph from AI-generated vector shapes and mask
generative fills. Claude Code is the **orchestrator** — you build and edit
the story. The user **tweaks parameters in Remotion Studio**, never
regenerates from there.

## The division of control — DO NOT cross it

| Concern | Owner | How |
|---|---|---|
| The SEQUENCE — which beats, their order, animation kinds, generating shapes | **Claude Code (you)** | Edit `story.json` + the `kinetic` CLI |
| The PARAMETERS — easing, duration, direction, dynamics, scale, color, glow, palette | **The user, in Studio** | Studio's auto-generated props editor |

When the user wants a **different story** (new words, new sequence, new
shapes) → that's you, reprompted. When they want it to **feel different**
(punchier, slower, different color) → that's their Studio knobs. If asked
to "add regeneration to the editor" — don't; that's deliberately Claude's
job, explain why.

## story.json — the single source of truth

`story.json` (project root) is read by Studio, the CLI, and renders.
Schema: `src/kinetic/schema.ts` (Zod — also what generates the Studio
editor). Shape:

```jsonc
{
  "fontSize": 160,
  "bgColor": "#0a0a14", "bgColor2": "#1a1030",   // gradient background
  "textColor": "#fafafa",
  "accentColor": "#7c5cff", "accent2Color": "#ff5ca8",
  "glowIntensity": 1, "backgroundMotion": 0.5,
  "beats": [
    {
      "text": "every",                  // the word/phrase
      "kind": "reveal",                 // reveal | morph | generativeFill
      "durationInSeconds": 1.4,
      "easing": "power3.out",           // power3.out|power3.inOut|power4.out|spring
      "direction": "up",                // up|down|left|right|scale
      "dynamics": 0.5,                  // 0 subtle .. 1 punchy
      "staggerSeconds": 0.04,
      "scale": 1,
      "glow": 8,
      "color": "#16fba8",               // optional override
      "shape": "M ..."                  // morph beats only — provider-generated
    }
  ]
}
```

Edit `story.json` directly for sequence changes. `storySchema.parse()`
fills defaults — you only need to write the fields you care about.
Composition duration is derived from the sum of beat durations.

## The three beat kinds

- **`reveal`** — word builds in letter-by-letter. The storytelling backbone.
- **`morph`** — a vector shape morphs into the word's FIRST letter, then
  the rest assembles. Needs a `shape` path (generate it — see below).
- **`generativeFill`** — the word is a mask over a churning gradient blob
  field. Use for emphasis / payoff beats.

## ⚠️ COST DISCIPLINE — read this first

Real provider calls cost money (Recraft = $0.08/shape). The CLI is
**cache-first**: `gen`, `set-shape`, and `benchmark` serve from
`shapes/cache/` and `shapes/library/` for FREE. A real API call only
happens with an explicit `--force` flag.

**Rules for you (the agent):**
- During development/debugging — NEVER use `--force`. Use cached shapes or
  `use-library`. Re-running a cached prompt is free.
- Only use `--force` when the user explicitly asks for a NEW shape that
  isn't cached, and ideally confirm first ("this will cost ~$0.08").
- Every `--force` call is auto-cached, so the same prompt is free forever
  after. Don't re-force a prompt that's already cached.
- `shapes/` is committed to the repo — cached shapes persist across
  sessions. Check `kinetic shapes` before generating anything.

## The `kinetic` CLI — your tools

Run via `npm run kinetic <cmd>`:

```bash
npm run kinetic providers
#   list vector providers + whether they're ready

npm run kinetic shapes
#   list cached generations + library shapes — ALL FREE to reuse.
#   ALWAYS check this before generating.

npm run kinetic gen recraft "<prompt>"
#   cache hit -> prints the path (FREE). cache miss -> errors (won't spend).
npm run kinetic gen recraft "<prompt>" --force
#   actually calls the API ($) — only when the user wants a new shape.

npm run kinetic set-shape <beatIndex> recraft "<prompt>" [--force]
#   put a shape into story.json beat <beatIndex> (cache-first, --force to
#   spend). Switches the beat to kind:"morph", captures the shape's color.

npm run kinetic use-library <beatIndex> <name>
#   put a named library shape into a beat — ALWAYS FREE, no API.
#   e.g. `use-library 0 bubble-letters`

npm run kinetic benchmark "<prompt>" [--force]
#   compare providers on one prompt (cache-first). The model-comparison
#   feature — node count, latency, cost.
```

### Providers
- **recraft** — Recraft V4 Vector API. Real, working. The default generator.
- **claude** — Claude API emitting SVG. Needs `ANTHROPIC_API_KEY` (the
  user's Claude Max plan does NOT cover API usage — separate billing).
  Skipped if no key.
- **ollama** — a local model emitting SVG. Needs `ollama` running + a
  model pulled. The "test local models" path.

If the user asks to "use Claude to generate the shapes": clarify — *you*
(Claude Code, on their Max plan) write the story and prompts; the **Recraft
provider** generates the actual vectors. The `claude` API provider is a
separate thing that needs a paid API key.

## Shape prompts that morph well

Morphing (flubber) needs **low node counts**. When prompting Recraft for a
`morph` beat's shape, ask for: "a single minimal geometric shape, one
closed path, very few points, flat color, no detail, no text, no
background." The CLI already appends this guidance — but a vague prompt
("a detailed forest") still produces a messy, badly-morphing path. Keep
shape prompts simple and iconic.

## Typical workflow

1. User describes a story → you write `story.json` with the beats.
2. For each `morph` beat → `npm run kinetic set-shape <i> recraft "<prompt>"`.
3. `npm run kinetic` has no render command — render with
   `npx remotion render KineticStory out/story.mp4` or tell the user to
   open Studio (`npm run studio`) to preview + tweak.
4. User tweaks parameters in Studio. If they want sequence changes, they
   reprompt you — go back to step 1.

## Verifying your work

After editing `story.json` or generating shapes:
- `npx tsc --noEmit` — schema must still validate.
- `npx remotion still KineticStory out/check.png --frame=<n>` — extract a
  frame to actually SEE it before claiming it works. Pick frames inside
  the beats you changed (durations are in `story.json`).
- Never claim a render looks good without inspecting a frame.

## Files

```
story.json                      the story (you edit this)
src/kinetic/schema.ts            Zod schema = story shape + Studio editor
src/kinetic/KineticStory.tsx     the composition + animated background
src/kinetic/beats.tsx            the 3 beat renderers
src/kinetic/glyphs.ts            font glyph → SVG path (for morphing)
src/kinetic/providers/           vector providers (recraft/claude/ollama)
scripts/kinetic.ts               the CLI
```

For Remotion-specific questions (animation primitives, rendering,
`<Sequence>`, fonts) also use the `remotion-best-practices` skill.
