# Pulse — Agent-Native Music Visualizer (Design Spec)

**Date:** 2026-06-15
**Status:** Proposed (autonomous design; user reviews at end)
**App id:** `pulse`
**Substrate:** new `CanvasPlugin` sibling to `kinetic`, hosted by the existing
KineticType platform (The Square → app card → Root).

---

## 0. One-paragraph summary

Pulse is a live music-visualizer app. You pick a folder of song stems from
disk; Pulse decodes and analyzes every stem into an immutable on-disk
*analysis timeline* (level, spectral bands, onsets, tempo, brightness per
frame), classifying each stem by its spectral fingerprint rather than its
filename. You bind musical features of each stem to GPU shader effects
(wave, animated noise, pixel-size/falloff, and more) through a stem mixer —
each stem has a volume that scales the *amplitude of its visual effect*. A
second fullscreen window on your external display renders the **live** deck
(Deck A) driven by the playing audio. In the main window you author the
**next** visual (Deck B) in a preview pane, expressing changes in plain
language to an embedded agent that live-edits the actual effect/shader code
(on a git branch) and hot-reloads it. When you *release* Deck B, params
zero out and a **transition template** (cut / crossfade / progressive /
seesaw / …) interpolates Deck A → Deck B over a duration and curve you set
in the Mix panel. Everything the agent and UI edit is plain JSON on disk,
watched and merged exactly like kinetic's `story.json`.

---

## 1. Goals & non-goals

### Goals
- **Reuse the substrate.** Terminal+chat, agent-edits-doc loop, file-watch
  three-way merge, projects, skill bundle — all reused, not reinvented.
- **Simplest code, maximum visual freedom.** Effects are small GLSL fragment
  shaders + a tiny TS descriptor. The agent edits these files directly;
  Vite HMR (already serving the editor at :5174) reloads them live.
- **Audio drives everything.** A uniform feature bus (level, bands, onset,
  tempo phase, brightness, per-stem versions of each) feeds shader uniforms.
- **Author-next-while-playing-current.** Deck A live on stage; Deck B
  authored in preview; controlled release + templated transition.
- **Stem-name-agnostic.** Classify stems by spectral profile; never trust
  the filename.

### Non-goals (v1 — YAGNI)
- No MP4 export of the visuals (the kinetic export pipeline is untouched).
- No real-time stem separation (stems are provided pre-split by the user).
- No DAW-grade editing of audio; we *play* and *analyze*, we don't edit audio.
- No cloud, no accounts, no network. Fully local.
- No Windows-specific tuning beyond what the substrate already does.

---

## 2. Where this fits the existing architecture

| Concern | Reuse / New | Reference |
|---|---|---|
| App registry entry | **Replace** dead `tonebench` placeholder with `pulse` | `editor/platform/apps.ts:115` |
| Canvas plugin contract | **New** `musicCanvas` impl | `editor/canvas.ts:57` (`CanvasPlugin`) |
| Active-canvas selection | **Refactor** `activeCanvas` from global const → per-app resolver | `editor/canvas.ts:99` |
| App Root component | **New** `PulseApp.tsx` (parallels `KineticApp.tsx`) | `editor/canvases/kinetic/KineticApp.tsx:1061` |
| Doc save/load/watch | **Reuse** (`save_doc`/`load_doc`/`doc://changed`) | `src-tauri/src/doc.rs`, `watch.rs` |
| Three-way merge | **Reuse** pattern, new `resolveConflict` for music doc | `KineticApp.tsx:239` |
| Terminal + chat + agent | **Reuse** verbatim | `pty.rs`, `agent_chat.rs`, `editor/agent-chat/*` |
| Skill bundle | **New** `src-tauri/skills/pulse/` | `skill.rs`, `src-tauri/skills/kinetic/` |
| Project scaffold | **Reuse** + new seed | `projects.rs:134`, `templates/seed-*.json` |
| Rust canvas dispatch | **New** `MusicCanvas`, make `active()` per-project | `src-tauri/src/canvas.rs:75` |
| Second window | **New** `/stage` webview on 2nd monitor | `lib.rs` setup, `window_state.rs` |
| Audio analysis | **New** (ffmpeg + OfflineAudioContext) | ffmpeg present at `/opt/homebrew/bin` |
| Effects (shaders) | **New** `src/pulse/effects/*` (live, HMR) | vite dev server :5174 |
| Git branch/merge for "release" | **New** thin Tauri git commands | none exist today |

**Key reuse insight:** the substrate already separates "app shell" from
"domain plugin." Kinetic proved a second canvas is describable without new
contract fields (`docs/.../2026-05-19-second-canvas-validation.md`). Pulse
is the first canvas that needs the player to be *audio-clock-driven* rather
than *Remotion-frame-driven*; we satisfy the `CanvasPlugin` signature with a
thin audio-backed transport (see §6).

---

## 3. On-disk project layout

```
~/KineticStudio/<project-slug>/
  project.json            # THE editable doc (agent + UI edit this). Watched.
  analysis.json           # Immutable per-song analysis timeline. Written once.
  stems/                  # Copied/normalized stems (or references to source)
    stem-00.wav ...
  .pulse/                 # metadata (mirrors .kinetic-studio/)
    source-folder.txt     # original stems folder the user picked
  .claude/skills/pulse/   # symlinked skill bundle (reused install flow)
```

> **Decision (effect-code location):** effect/shader code lives in the **repo**
> at `src/pulse/effects/` (see §5), *not* per-project. Rationale: the agent
> edits real source that Vite HMR (already running at :5174) hot-reloads
> instantly, and effects are shared library code, not per-song data. Per-song
> variation lives entirely in `project.json` (params + bindings). A
> per-project `src-effects/` override dir is explicitly **out of scope for v1**.

Asset-protocol scope extends to `$HOME/KineticStudio/**/stems/**` and
`**/analysis.json` so the webview can load audio + analysis via
`convertFileSrc` (pattern already used at `ProjectsView.tsx:169`).

### 3.1 `project.json` (editable doc) — schema (Zod, `src/pulse/schema.ts`)

```ts
PulseProject = {
  version: 1,
  song: {
    sourceFolder: string,          // original picked folder
    durationSec: number,
    tempoBpm: number,              // from analysis, user-overridable
  },
  stems: Stem[],                   // one per analyzed stem
  decks: { A: Deck, B: Deck },     // A = live, B = preview/next
  mix: MixState,                   // transition control
}

Stem = {
  id: string,                      // "stem-00"
  file: string,                    // relative path under stems/
  label: string,                  // user-editable display name
  role: StemRole,                  // CLASSIFIED, not from filename
  volume: number,                  // 0..1 — scales VISUAL amplitude
  muted: boolean,
}
// Classified by spectral fingerprint, never the filename:
StemRole = "kick" | "bass" | "drums" | "harmony" | "lead" | "vocal" | "fx" | "unknown"

Deck = {
  effects: EffectInstance[],       // stack, composited in order
}
EffectInstance = {
  id: string,
  type: EffectType,                // "wave" | "noiseField" | "pixelate" | ...
  enabled: boolean,
  locked: boolean,                 // "lock in hard conditions"
  params: Record<string, number>,  // static param values (e.g. pixel size)
  bindings: Binding[],             // music-feature → param modulations
}
Binding = {
  param: string,                   // which effect param it drives
  source: FeatureSource,           // { stem: id | "master", feature: Feature }
  amount: number,                  // gain
  curve: "linear" | "exp" | "log" | "smooth",
  offset: number,
}
Feature = "level" | "bandLow" | "bandMid" | "bandHigh"
        | "onset" | "tempoPhase" | "brightness" | "flux"

MixState = {
  active: "A" | "B" | "transitioning",
  template: TransitionTemplate,    // see §9
  durationSec: number,             // length of A→B transition
  curve: "linear" | "ease" | "exp" | "seesaw" | "step",
  progress: number,                // 0..1, driven during a release
}
```

### 3.2 `analysis.json` (immutable timeline) — `src/pulse/analysis.ts`

```ts
Analysis = {
  version: 1,
  sampleRate: number,
  hopSec: number,                  // ~1/60 — feature frame spacing
  durationSec: number,
  tempoBpm: number,
  beatTimesSec: number[],          // detected beat grid (master)
  stems: AnalyzedStem[],
}
AnalyzedStem = {
  id: string,
  file: string,
  role: StemRole,                  // classification result + confidence
  roleConfidence: number,
  // Per-frame feature arrays (length = durationSec / hopSec), stored as
  // plain number[] (Float not needed for v1; JSON is fine at 60fps*175s ≈
  // 10.5k frames per array — a few MB total, acceptable).
  level: number[],                 // RMS envelope, normalized 0..1
  bandLow: number[], bandMid: number[], bandHigh: number[],
  brightness: number[],            // spectral centroid, normalized
  flux: number[],                  // spectral flux (onset strength)
  onsets: number[],                // onset times (sec)
}
```

`analysis.json` is written **once** by the analyzer and never edited by the
agent. It is loaded into memory on project open and indexed by frame at
playback time (binary-search the audio clock → frame index).

---

## 4. Audio analysis pipeline

**Trigger:** user picks a stems folder (native dialog, reusing
`@tauri-apps/plugin-dialog`). On confirm:

1. **Decode (Rust/ffmpeg).** For each file in the folder, a new Tauri
   command `pulse_import(folder)` shells out to the installed `ffmpeg`
   (`/opt/homebrew/bin/ffmpeg`) to normalize each stem to 48kHz stereo WAV
   into `stems/stem-NN.wav`, and `ffprobe` for duration. (ffmpeg confirmed
   present.) Filenames are *recorded but not trusted*.
2. **Analyze (frontend, OfflineAudioContext).** The frontend loads each
   normalized stem via `fetch(convertFileSrc(...))` → `decodeAudioData` →
   a self-contained analyzer (`src/pulse/analysis.ts`) that walks the buffer
   in hops of `hopSec` computing: RMS level, 3-band energy (low/mid/high via
   a small radix-2 FFT we vendor — ~80 lines, no heavy dep), spectral
   centroid (brightness), spectral flux, and onset peaks from flux.
3. **Classify role (stem-name-agnostic).** From each stem's *aggregate*
   features decide a `StemRole`:
   - dominant low band + sparse strong onsets → `kick`/`bass`
   - broadband transient density → `drums`
   - sustained mid energy, low flux → `harmony`
   - high brightness + melodic continuity → `lead`
   - formant-band mid energy + vibrato-ish flux → `vocal`
   - everything else → `fx`/`unknown` with low confidence.
   Heuristic, returns `roleConfidence`; the user can override `label`/`role`
   in the inspector. **This satisfies "assume stems won't be named the same;
   analyze each and assign."**
4. **Master timeline.** Sum stems → master level + beat tracking (autocorr
   of onset envelope → tempo; phase → `beatTimesSec`). Saved as the master
   feature track.
5. **Persist.** Write `analysis.json`. Write a seeded `project.json` with one
   stem entry per analyzed stem (default `volume: 1`, `role` from
   classification) and a default Deck A with one starter effect.

Progress is streamed to the UI via a `pulse://import-progress` event
(same pattern as `video://export-progress`, `video.rs`).

**Why frontend analysis (not Rust):** Web Audio's `decodeAudioData` handles
every codec the OS supports for free, and the analyzer is tiny. Keeping it in
TS means the agent can *read and tweak the analysis heuristics too* if asked.
ffmpeg is used only to normalize formats so `decodeAudioData` is reliable.

---

## 5. Effects: live code the agent edits

Effects live in the **repo** at `src/pulse/effects/` (not per-project), so
the agent edits real source and Vite HMR reloads instantly. Each effect is
two small files:

```
src/pulse/effects/
  registry.ts            # EffectType union + lazy map; the ONLY file to touch to add an effect
  wave/
    wave.frag.glsl       # fragment shader
    wave.ts              # descriptor: param schema + default bindings + uniform mapping
  noiseField/ ...
  pixelate/ ...
```

**Effect descriptor contract** (`src/pulse/effects/types.ts`):
```ts
EffectDescriptor = {
  type: EffectType,
  label: string,
  frag: string,                          // imported ?raw glsl
  params: ParamSpec[],                   // { name, min, max, default, step }
  uniforms: (p, features) => UniformMap, // maps params+audio features → GLSL uniforms
  blend: "add" | "screen" | "alpha" | "multiply",  // how it composites on the stack
}
```

**Rendering core** (`src/pulse/Stage.tsx`): a single WebGL2 canvas, one
full-screen quad, a ping-pong framebuffer pair. The deck's `effects[]` are
rendered in order, each sampling the previous pass (so effects *affect each
other* — pixelate-of-wave-of-noise, etc., delivering the "affect each other
in creative ways" requirement). Uniforms come from `uniforms(params,
featureFrame)` where `featureFrame` is the current audio frame, scaled per
binding, and **per-stem amplitude is `stem.volume`** so lowering a stem's
volume literally shrinks the visual contribution of effects bound to it.

**Starter effect library (v1 — broad + surprising, all small shaders):**
1. `wave` — traveling sine/SDF wave; amplitude←level, wavelength←tempoPhase.
2. `noiseField` — animated curl/simplex noise; flow speed←brightness.
3. `pixelate` — controllable pixel size + falloff (the explicit ask);
   pixel size←bandLow, falloff←onset (chunky on hits).
4. `bloomPulse` — radial bloom that punches on `onset`.
5. `spectrumBars` — radial/linear bars from the 3 bands.
6. `feedbackTrails` — frame-feedback smear; decay←level (motion memory).
7. `kaleido` — mirror/rotate symmetry; segments←beat count.
8. `chromaShift` — RGB split driven by `flux` (glitch on transients).
9. `contourLines` — iso-lines of the noise field; threshold←brightness.
10. `particleBurst` — GPU points emitted on `onset`, velocity←level.

These ten compose in any order via the stack + blend modes, so the visual
space is large from a small, simple codebase.

---

## 6. Transport: audio-clock, not Remotion frames

The `CanvasPlugin` `Renderer` receives `playerRef` / `durationInFrames`
(substrate contract). Pulse's Renderer **ignores Remotion** internally and
runs its own loop:

- An `<audio>` element per stem (or one mixed element + gain nodes per stem
  via a shared `AudioContext`; v1: one `AudioContext`, a `MediaElementSource`
  per stem → per-stem `GainNode` → destination, so **stem volume = audio gain
  AND visual amplitude**).
- `requestAnimationFrame` loop reads `audioCtx.currentTime`, computes the
  frame index into `analysis.json`, builds the `featureFrame`, and renders
  the active deck(s).
- A thin `PlayerRef`-shaped shim (play/pause/seek/getCurrentFrame) is exposed
  so the substrate's Transport bar and Opt+Space shortcut keep working
  unchanged. `durationInFrames = durationSec * 60`.

This keeps the substrate untouched while the real engine is audio-driven.

---

## 7. Two windows: control + live stage

- **Main window** (existing): the platform shell + `PulseApp`. Left column =
  agent terminal/chat (reused). Center = **preview pane** rendering **Deck B**
  (the "next" visual you're authoring). Right = inspector (stem mixer, effect
  stack, bindings). Bottom = song timeline (waveform + beat grid + onsets).
- **Stage window** (new): a second Tauri `WebviewWindow` at route `/stage`,
  created fullscreen on the **secondary monitor** (falls back to a normal
  window if only one display). It renders **Deck A** (live) at full res,
  chrome-free, driven by the same shared audio clock and docs.

**Sync between windows:** both load the same `project.json`/`analysis.json`
and subscribe to `doc://changed`. The audio clock is owned by the **stage
window** (it's the performance surface); it broadcasts `pulse://clock`
(currentTime) at a low rate; the main window's preview uses its own local
clock for authoring B so it can scrub independently of the live show. On
release, the main window sends `pulse://release` and the stage performs the
transition (§9).

**Window creation:** add to `lib.rs` setup — enumerate monitors via
`app.available_monitors()`, build `WebviewWindowBuilder::new(app, "stage",
WebviewUrl::App("/stage".into())).fullscreen(true)` positioned on monitor[1]
when present. The React entry (`editor/main.tsx`) routes on
`window.location.pathname === "/stage"` to a minimal `<Stage deck="A"/>`
instead of the full platform.

---

## 8. Authoring flow (preview → release → mix)

1. **Bind & lock.** In the inspector you add effects to Deck B, set static
   params (pixel size, falloff), and bind features→params via the stem mixer.
   `locked` bindings are hard conditions the agent must preserve.
2. **Prompt the agent.** You type e.g. "make the noise breathe with the bass
   and add chromatic glitch on the snare." The agent (terminal or chat,
   reused) edits **Deck B in `project.json`** for binding/param changes, or
   **edits/creates shader files in `src/pulse/effects/`** for behaviors that
   don't exist yet. Code edits hot-reload via Vite; doc edits flow through the
   watch+merge loop. The agent works **on a git branch** (`pulse/deck-b-<ts>`)
   so the live stage (Deck A on `main`/working tree) is unaffected until merge.
3. **Preview.** The main-window preview pane renders Deck B live against the
   song (you can scrub the timeline to preview at a specific moment — "see the
   next visual effect meanwhile the stage still renders state 1").
4. **Release.** You hit Release. Thin Tauri git commands
   (`pulse_release`): commit Deck B branch, merge into the working tree,
   **zero out** transition params (`mix.progress=0`, `mix.active="transitioning"`).
   The stage window then runs the selected **transition template** over
   `mix.durationSec` with `mix.curve`, interpolating every Deck A binding/param
   toward its Deck B counterpart. At progress=1, B becomes the new A; B resets
   to a copy for the next authoring round.

**Mix panel** controls `template`, `durationSec`, and `curve` — i.e. the
"time, frequency, and velocity of the remix," because the transition is just
**interpolation of the bindings/params over the time you specify.**

---

## 9. Transition templates

A transition template is a function
`(a: Deck, b: Deck, t01: number) => Deck` producing the deck to render at
normalized progress `t`. v1 templates (`src/pulse/transitions.ts`):

| Template | Behavior |
|---|---|
| `cut` | Hard switch at t=0.5. |
| `crossfade` | Alpha-blend A and B (both rendered, mixed by t). |
| `progressive` | Per-effect staggered handoff (effect 1 morphs, then 2 …). |
| `seesaw` | Oscillating A↔B weight that settles on B (t shaped by a damped sine). |
| `fast` / `slow` | Same as crossfade but with preset short/long `durationSec` + curve. |
| `morphParams` | Interpolate shared params numerically; non-shared effects fade. |

`curve` reshapes `t` (`ease`/`exp`/`seesaw`/`step`). Templates operate on the
deck data; the renderer just renders whatever deck the template returns each
frame — keeping the engine simple.

---

## 10. The agent's contract (skill bundle)

New `src-tauri/skills/pulse/` (installed via the existing `skill.rs` flow):
- `SKILL.md` — routing + hard rules: *"`project.json` is the source of truth
  for bindings/params; edit shaders in `src/pulse/effects/` for new behaviors;
  preserve `locked` bindings; author on the `pulse/deck-b-*` branch; never edit
  `analysis.json`."*
- `effects.md` — the effect descriptor contract + how to add a shader.
- `bindings.md` — the feature bus + how to bind stems→params.
- `transitions.md` — the template contract.

The agent edits exactly two surfaces: **`project.json`** (data) and
**`src/pulse/effects/*` + `transitions.ts`** (code). Both already hot-reload.

---

## 11. Components & isolation (each unit, one purpose)

| Unit | File | Purpose | Depends on |
|---|---|---|---|
| Schema | `src/pulse/schema.ts` | Zod types for `project.json` | zod |
| Analysis types + analyzer | `src/pulse/analysis.ts` | feature extraction + classify | Web Audio, vendored FFT |
| FFT | `src/pulse/fft.ts` | radix-2 FFT (~80 lines) | none |
| Effect contract | `src/pulse/effects/types.ts` | descriptor type | none |
| Effect registry | `src/pulse/effects/registry.ts` | type union + lazy map | descriptors |
| Individual effects | `src/pulse/effects/<n>/` | shader + descriptor | types |
| Stage renderer | `src/pulse/Stage.tsx` | WebGL2 deck compositor | registry |
| Transport | `src/pulse/transport.ts` | audio-clock PlayerRef shim | Web Audio |
| Transitions | `src/pulse/transitions.ts` | template functions | schema |
| Canvas plugin | `editor/canvases/music/index.tsx` | wires `musicCanvas` | Stage, Inspector, Timeline |
| App Root | `editor/canvases/music/PulseApp.tsx` | project lifecycle + layout | substrate |
| Inspector | `editor/canvases/music/Inspector.tsx` | stem mixer + effect stack + bindings | schema |
| Timeline | `editor/canvases/music/Timeline.tsx` | waveform + beats + onsets | analysis |
| Mix panel | `editor/canvases/music/MixPanel.tsx` | transition controls | schema |
| Stage route | `editor/canvases/music/StageWindow.tsx` | fullscreen deck-A view | Stage |
| Rust import | `src-tauri/src/pulse.rs` | ffmpeg import + progress | ffmpeg |
| Rust git | `src-tauri/src/git.rs` | branch/commit/merge for release | git CLI |
| Rust canvas | `src-tauri/src/canvases/music.rs` | MusicCanvas trait impl | canvas trait |
| Skill bundle | `src-tauri/skills/pulse/*` | agent contract | — |

---

## 12. Substrate changes (small, surgical)

1. `editor/canvas.ts`: change `activeCanvas` from a hardcoded const to a
   resolver keyed by the current app id (so `pulse` resolves `musicCanvas`,
   `kinetic` resolves `kineticCanvas`). One small refactor; `KineticApp`
   unaffected because it imports the resolved canvas the same way.
2. `editor/platform/apps.ts`: replace the `tonebench` placeholder (line 115)
   with a real `pulse` manifest (`status: "available"`, `Root: PulseApp`).
3. `editor/main.tsx`: route `/stage` → `StageWindow`, else → platform.
4. `src-tauri/src/lib.rs`: register `pulse.rs` + `git.rs` commands; create the
   stage window on second monitor in `setup()`.
5. `src-tauri/src/canvas.rs`: make `active()` resolve per-project canvas id
   (kinetic | music); add `MusicCanvas`.
6. `tauri.conf.json`: extend asset scope to `stems/**` + `analysis.json`.

No change to: `pty.rs`, `agent_chat.rs`, `doc.rs`, `watch.rs`, `projects.rs`
core (only a new seed template + canvas id), `editor/agent-chat/*`,
`editor/terminal.tsx`. The kinetic app is untouched and keeps working.

---

## 13. Testing strategy

- **Analyzer unit tests** (`src/pulse/__tests__/analysis.test.ts`): feed
  synthetic buffers (pure sine → known centroid; click train → known onsets;
  low-freq tone → `bass`/`kick` classification) and assert features +
  classification. Vitest already configured.
- **FFT test**: known input → known magnitude spectrum.
- **Transition test**: at t=0 returns A, t=1 returns B, monotonic for
  `morphParams` on a shared param.
- **Schema test**: `project.json` round-trips; `resolveConflict` merges a
  user volume change + agent binding change without loss (mirrors kinetic's
  format-issues test).
- **Manual E2E** (the real proof): import the provided stems folder
  `/Users/parandykt/Apps/VisualMachines/Song tune (Cover) Stems`, confirm 6
  stems analyze + classify, bind level→pixelate, play, see it react; author a
  Deck B noise effect via the agent, release with `crossfade`, watch the
  transition on the stage window.

The provided folder (6 × 48kHz stereo WAV, ~175s: Drums/Bass/Keyboard/Synth/
Other/Brass) is the development fixture. Names are used only as a fallback
display hint — classification is independent.

---

## 14. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `analysis.json` size at 60fps | ~10.5k floats/array × ~8 arrays × 6 stems ≈ a few MB JSON. Acceptable v1; if too big, drop hop to 30fps or store as base64 Float32. |
| Second monitor absent | Stage opens as a normal resizable window; user drags it. |
| WebGL2 perf with 10-effect stacks | Ping-pong FBO + cap stack depth; each effect is one cheap pass. Profile on the dev machine. |
| Audio/visual drift | Single `AudioContext.currentTime` is the only clock; visuals derive from it, never from rAF time. |
| Git merge conflicts on release | Deck B edits are scoped to `project.json` decks.B + new effect files; merge is fast-forward in the common case. Surface conflicts to the agent terminal (reuse the merge-prompt path). |
| Agent edits break a shader (HMR error) | Vite overlay shows the error; stage keeps last good frame; agent reads error from terminal and fixes. |

---

## 15. Build order (for the implementation plan)

1. **Substrate seam**: per-app `activeCanvas` resolver + `pulse` app manifest
   + Rust `MusicCanvas` + seed `project.json` + `/stage` routing. (Proves the
   app opens, empty.)
2. **Import + analysis**: `pulse.rs` ffmpeg import, `analysis.ts` + `fft.ts`,
   classification, write `analysis.json`, seed `project.json`. (Proves a real
   song analyzes.)
3. **Engine**: `transport.ts` + `Stage.tsx` + 3 starter effects + feature bus.
   (Proves audio drives pixels.)
4. **Inspector + timeline + mixer**: stem volumes (audio gain + visual amp),
   effect stack, bindings, waveform/beat timeline. (Proves manual authoring.)
5. **Second window**: stage on 2nd monitor, Deck A live, clock broadcast.
6. **Deck B + release + transitions + git**: preview pane, `git.rs`,
   `pulse_release`, transition templates, Mix panel.
7. **Skill bundle**: `src-tauri/skills/pulse/*`; wire to install flow.
8. **Remaining 7 effects** + tests + manual E2E on the provided stems.

Each step is independently runnable and verifiable.
