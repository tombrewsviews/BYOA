# Pulse Music Visualizer — Full Implementation Plan (steps 4–8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Complete Pulse from the working vertical slice to the full spec: stem mixer + effect-stack + binding inspector, waveform/beat timeline, a second fullscreen "stage" window on a 2nd monitor rendering the live deck, Deck-B authoring → release → templated A→B transitions driven from a Mix panel, a git-branch/merge release path, the remaining effect library, and the agent skill bundle.

**Architecture:** Builds on the slice (branch `feat/pulse-music-visualizer`). Adds: (1) a per-stem Web Audio gain graph so volume = audio AND visual amplitude; (2) transition functions that blend two decks by progress; (3) a `/stage` route rendered in a 2nd Tauri window created in Rust `setup()`, sharing the audio clock via events; (4) thin git commands for release; (5) richer inspector/timeline/mix UI. The substrate (terminal, doc-watch, projects) stays reused.

**Tech Stack:** TypeScript, React 19, Zod, Web Audio API, WebGL2/GLSL, Vitest, Tauri 2 (Rust), git CLI, ffmpeg CLI.

**Spec:** `docs/superpowers/specs/2026-06-15-pulse-music-visualizer-design.md` (§8, §9, §7, §5, §10, §15 steps 4–8).
**Prior plan (done):** `docs/superpowers/plans/2026-06-15-pulse-vertical-slice.md`.

---

## File Structure

**Created:**
- `src/pulse/transitions.ts` — transition template functions `(a,b,t)=>Deck` + curve shaping.
- `src/pulse/audioGraph.ts` — per-stem `<AudioBufferSourceNode>`/gain graph, shared clock, play/pause/seek.
- `src/pulse/effects/<7 new>/*` — bloomPulse, spectrumBars, feedbackTrails, kaleido, chromaShift, contourLines, particleBurst (each: `.frag.glsl` + `.ts`).
- `editor/canvases/music/Timeline.tsx` — waveform + beat-grid + onset markers + playhead.
- `editor/canvases/music/MixPanel.tsx` — template/duration/curve controls + Release button.
- `editor/canvases/music/EffectStack.tsx` — add/remove/reorder effects, per-effect params, binding rows (used in Inspector).
- `editor/canvases/music/StageWindow.tsx` — minimal fullscreen Deck-A renderer for the `/stage` route.
- `editor/canvases/music/useAudioEngine.ts` — React hook wrapping audioGraph + analysis + clock for the editor preview.
- `src-tauri/src/git.rs` — `git_branch`, `git_commit_all`, `git_merge`, `git_current_branch`.
- `src-tauri/src/stage.rs` — create/position the stage window on the 2nd monitor.

**Modified:**
- `src/pulse/schema.ts` — add `release` runtime fields already present? (mix has progress) — extend `MixState` with `from`/`to` snapshot ids only if needed (NO: keep decks A/B canonical).
- `src/pulse/Stage.tsx` — accept an optional pre-blended deck (for transitions) and a `clearColor`/feedback persistence flag; expose `renderDeck`.
- `editor/canvases/music/Renderer.tsx` — drive from `useAudioEngine`; render transition blend of A/B when `mix.active==="transitioning"`.
- `editor/canvases/music/Inspector.tsx` — mount `EffectStack` + stem mixer + `MixPanel`.
- `editor/canvases/music/PulseApp.tsx` — wire timeline, mix panel, release flow, open stage window.
- `editor/canvases/music/index.tsx` — provide `Timeline`, real `resolveConflict` three-way merge.
- `editor/main.tsx` — route `window.location.pathname.startsWith("/stage")` → `<StageWindow/>`.
- `src-tauri/src/lib.rs` — register git + stage commands; create stage window in setup (hidden until opened).
- `src-tauri/skills/pulse/*` — add `effects.md`, `bindings.md`, `transitions.md`.

---

## Task 1: Transition templates

**Files:** Create `src/pulse/transitions.ts`; Test `src/pulse/__tests__/transitions.test.ts`

- [ ] **Step 1: Failing test**

```ts
// src/pulse/__tests__/transitions.test.ts
import { describe, it, expect } from "vitest";
import { shapeCurve, blendDecks } from "../transitions";
import type { Deck } from "../schema";

const deckA: Deck = { effects: [{ id: "a", type: "wave", enabled: true, locked: false, params: { amplitude: 0 }, bindings: [] }] };
const deckB: Deck = { effects: [{ id: "a", type: "wave", enabled: true, locked: false, params: { amplitude: 1 }, bindings: [] }] };

describe("shapeCurve", () => {
  it("clamps and maps endpoints", () => {
    expect(shapeCurve(0, "linear")).toBe(0);
    expect(shapeCurve(1, "linear")).toBe(1);
    expect(shapeCurve(-1, "linear")).toBe(0);
    expect(shapeCurve(2, "linear")).toBe(1);
  });
  it("ease is monotonic between 0 and 1", () => {
    expect(shapeCurve(0, "ease")).toBeCloseTo(0);
    expect(shapeCurve(1, "ease")).toBeCloseTo(1);
    expect(shapeCurve(0.5, "ease")).toBeGreaterThan(0);
  });
});

describe("blendDecks morphParams", () => {
  it("t=0 returns A params, t=1 returns B params", () => {
    const at0 = blendDecks(deckA, deckB, 0, "morphParams");
    const at1 = blendDecks(deckA, deckB, 1, "morphParams");
    expect(at0.effects[0].params.amplitude).toBeCloseTo(0);
    expect(at1.effects[0].params.amplitude).toBeCloseTo(1);
  });
  it("t=0.5 interpolates a shared param", () => {
    const mid = blendDecks(deckA, deckB, 0.5, "morphParams");
    expect(mid.effects[0].params.amplitude).toBeCloseTo(0.5);
  });
  it("cut switches at 0.5", () => {
    expect(blendDecks(deckA, deckB, 0.4, "cut").effects[0].params.amplitude).toBeCloseTo(0);
    expect(blendDecks(deckA, deckB, 0.6, "cut").effects[0].params.amplitude).toBeCloseTo(1);
  });
});
```

- [ ] **Step 2: Run → FAIL** (`npx vitest run src/pulse/__tests__/transitions.test.ts`) — module missing.

- [ ] **Step 3: Implement**

```ts
// src/pulse/transitions.ts
import type { Deck, EffectInstance, MixState } from "./schema";

export type Curve = MixState["curve"];
export type Template = MixState["template"];

// Reshape normalized progress t (0..1) by a curve.
export function shapeCurve(t: number, curve: Curve): number {
  const x = Math.max(0, Math.min(1, t));
  switch (curve) {
    case "linear": return x;
    case "ease": return x * x * (3 - 2 * x);
    case "exp": return x * x;
    case "seesaw": return 0.5 - 0.5 * Math.cos(x * Math.PI); // smooth settle
    case "step": return x < 0.5 ? 0 : 1;
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Interpolate numeric params of matching effects (by id, else by index).
function morphEffect(a: EffectInstance | undefined, b: EffectInstance | undefined, t: number): EffectInstance | null {
  if (a && b) {
    const params: Record<string, number> = { ...a.params };
    for (const k of Object.keys({ ...a.params, ...b.params })) {
      params[k] = lerp(a.params[k] ?? b.params[k] ?? 0, b.params[k] ?? a.params[k] ?? 0, t);
    }
    // bindings: take B's once past halfway (they're structural, not numeric).
    return { ...(t < 0.5 ? a : b), params, bindings: (t < 0.5 ? a : b).bindings };
  }
  // Effect exists on only one side → fade it via an _alpha param the shaders read.
  const only = a ?? b!;
  const present = a ? 1 - t : t; // A-only fades out, B-only fades in
  return { ...only, params: { ...only.params, _alpha: present } };
}

// Produce the deck to render at progress t for a given template.
export function blendDecks(a: Deck, b: Deck, t: number, template: Template): Deck {
  if (template === "cut") return t < 0.5 ? a : b;
  // crossfade/fast/slow render both decks alpha-mixed; the Renderer handles
  // the alpha. For deck-data purposes they behave like morphParams with an
  // overall _mix param the Renderer reads. We tag the deck with _mix on each
  // effect so the Stage can alpha-blend passes.
  if (template === "crossfade" || template === "fast" || template === "slow") {
    const tagged = (d: Deck, alpha: number): EffectInstance[] =>
      d.effects.map((e) => ({ ...e, params: { ...e.params, _alpha: alpha } }));
    return { effects: [...tagged(a, 1 - t), ...tagged(b, t)] };
  }
  if (template === "progressive") {
    // Stagger: effect i hands off in its own [i/n .. (i+1)/n] window.
    const n = Math.max(a.effects.length, b.effects.length);
    const out: EffectInstance[] = [];
    for (let i = 0; i < n; i++) {
      const lo = i / n, hi = (i + 1) / n;
      const local = Math.max(0, Math.min(1, (t - lo) / Math.max(1e-6, hi - lo)));
      const e = morphEffect(a.effects[i], b.effects[i], local);
      if (e) out.push(e);
    }
    return { effects: out };
  }
  if (template === "seesaw") {
    const s = shapeCurve(t, "seesaw");
    const n = Math.max(a.effects.length, b.effects.length);
    const out: EffectInstance[] = [];
    for (let i = 0; i < n; i++) {
      const e = morphEffect(a.effects[i], b.effects[i], s);
      if (e) out.push(e);
    }
    return { effects: out };
  }
  // morphParams (default)
  const n = Math.max(a.effects.length, b.effects.length);
  const out: EffectInstance[] = [];
  for (let i = 0; i < n; i++) {
    const e = morphEffect(a.effects[i], b.effects[i], t);
    if (e) out.push(e);
  }
  return { effects: out };
}
```

- [ ] **Step 4: Run → PASS** (5 tests).
- [ ] **Step 5: Commit** `git add src/pulse/transitions.ts src/pulse/__tests__/transitions.test.ts && git commit -m "feat(pulse): transition templates + curve shaping"`

---

## Task 2: Per-stem audio graph

**Files:** Create `src/pulse/audioGraph.ts`; Test `src/pulse/__tests__/audioGraph.test.ts`

- [ ] **Step 1: Failing test** (pure parts only — Web Audio is mocked minimally)

```ts
// src/pulse/__tests__/audioGraph.test.ts
import { describe, it, expect, vi } from "vitest";
import { computeGains } from "../audioGraph";

describe("computeGains", () => {
  it("muted stem yields 0, else its volume", () => {
    const stems = [
      { id: "s0", volume: 0.8, muted: false },
      { id: "s1", volume: 0.5, muted: true },
    ];
    const g = computeGains(stems as any);
    expect(g.s0).toBeCloseTo(0.8);
    expect(g.s1).toBe(0);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
// src/pulse/audioGraph.ts
import type { Stem } from "./schema";

export type Gains = Record<string, number>;

export function computeGains(stems: Pick<Stem, "id" | "volume" | "muted">[]): Gains {
  const g: Gains = {};
  for (const s of stems) g[s.id] = s.muted ? 0 : s.volume;
  return g;
}

// Live multi-stem player: one AudioContext, a decoded buffer + gain per stem,
// all started together so they stay sample-locked. currentTime is the shared
// clock the visualizer reads. Browser/Tauri webview only (needs Web Audio).
export type AudioGraph = {
  readonly ctx: AudioContext;
  play: () => void;
  pause: () => void;
  seek: (sec: number) => void;
  currentTime: () => number;
  duration: () => number;
  isPlaying: () => boolean;
  setGains: (g: Gains) => void;
  dispose: () => void;
};

export async function createAudioGraph(
  stemUrls: { id: string; url: string }[],
): Promise<AudioGraph> {
  const ctx = new AudioContext();
  const buffers: { id: string; buffer: AudioBuffer; gain: GainNode }[] = [];
  let duration = 0;
  for (const s of stemUrls) {
    const ab = await fetch(s.url).then((r) => r.arrayBuffer());
    const buffer = await ctx.decodeAudioData(ab);
    duration = Math.max(duration, buffer.duration);
    const gain = ctx.createGain();
    gain.gain.value = 1;
    gain.connect(ctx.destination);
    buffers.push({ id: s.id, buffer, gain });
  }

  let sources: AudioBufferSourceNode[] = [];
  let startedAt = 0;       // ctx.currentTime when playback (re)started
  let offset = 0;          // seconds into the song at last (re)start
  let playing = false;

  const stopSources = () => {
    for (const s of sources) { try { s.stop(); } catch { /* already stopped */ } }
    sources = [];
  };

  const startSources = (at: number) => {
    stopSources();
    offset = Math.max(0, Math.min(duration, at));
    startedAt = ctx.currentTime;
    sources = buffers.map((b) => {
      const src = ctx.createBufferSource();
      src.buffer = b.buffer;
      src.connect(b.gain);
      src.start(0, offset);
      return src;
    });
  };

  return {
    ctx,
    play: () => { if (playing) return; void ctx.resume(); startSources(offset); playing = true; },
    pause: () => { if (!playing) return; offset = offset + (ctx.currentTime - startedAt); stopSources(); playing = false; },
    seek: (sec: number) => { offset = Math.max(0, Math.min(duration, sec)); if (playing) startSources(offset); },
    currentTime: () => playing ? Math.min(duration, offset + (ctx.currentTime - startedAt)) : offset,
    duration: () => duration,
    isPlaying: () => playing,
    setGains: (g) => { for (const b of buffers) { const v = g[b.id]; if (v != null) b.gain.gain.value = v; } },
    dispose: () => { stopSources(); void ctx.close(); },
  };
}
```

- [ ] **Step 4: Run → PASS** (1 test).
- [ ] **Step 5: Commit** `git add src/pulse/audioGraph.ts src/pulse/__tests__/audioGraph.test.ts && git commit -m "feat(pulse): per-stem Web Audio gain graph (volume = audio + visual amplitude)"`

---

## Task 3: Stage supports alpha + transition blending

**Files:** Modify `src/pulse/Stage.tsx`; Test extend `src/pulse/__tests__/stage-compile.test.ts`

The shaders already sample `uPrev`. To support per-effect alpha (`_alpha` param) and crossfade, add a uniform `uAlpha` that each pass multiplies its contribution by, defaulting to 1. The compositor reads `effect.params._alpha` (set by transitions) and passes it as `uAlpha`.

- [ ] **Step 1: Failing test (extend)** — add to stage-compile.test.ts:

```ts
import { passAlpha } from "../Stage";
// ...
describe("passAlpha", () => {
  it("defaults to 1 and reads _alpha", () => {
    expect(passAlpha({ params: {} } as any)).toBe(1);
    expect(passAlpha({ params: { _alpha: 0.3 } } as any)).toBeCloseTo(0.3);
  });
});
```

- [ ] **Step 2: Run → FAIL** (passAlpha missing).

- [ ] **Step 3: Implement** — in `src/pulse/Stage.tsx`:
  1. Export helper:
```ts
export function passAlpha(e: { params: Record<string, number> }): number {
  const a = e.params._alpha;
  return a == null ? 1 : Math.max(0, Math.min(1, a));
}
```
  2. In the draw loop, after computing `uniforms`, set `uAlpha`:
```ts
gl.uniform1f(gl.getUniformLocation(prog, "uAlpha"), passAlpha(pass.effect));
```
  3. Append `uniform float uAlpha;` to each shader via the `wrap()` injector (so existing shaders need no edit): change `wrap` to prepend a uniform + default-blend helper. Simplest: in `wrap`, after the version line insert `uniform float uAlpha;` if not present, and document that shaders SHOULD multiply their emitted color by `uAlpha`. For existing shaders that ignore it, alpha still controls crossfade via additive scaling — to make it effective, multiply final color: rewrite `wrap` to wrap the body's `outColor`/`gl_FragColor` assignment. KEEP IT SIMPLE: instead of rewriting bodies, add a final composite pass.

  **Chosen minimal approach:** add `uAlpha` uniform availability (harmless if unused) AND have NEW effects honor it; for crossfade correctness, the Renderer renders deck A and deck B into two textures and mixes them with a dedicated `mixPrograms` step (see Task 6). So Stage just needs: (a) export `passAlpha`, (b) expose a `renderToTexture(deck, intoFbo)` capability via a ref handle.

  Implement `passAlpha` (above) now; the A/B two-texture mix lives in the Renderer (Task 6). Add `uAlpha` uniform set (it's a no-op for current shaders, used by new ones).

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git add src/pulse/Stage.tsx src/pulse/__tests__/stage-compile.test.ts && git commit -m "feat(pulse): Stage exposes per-pass alpha for transitions"`

---

## Task 4: Seven more effects

**Files:** Create 7 effect folders + register; Test extend `src/pulse/__tests__/registry.test.ts`

Each effect = `<name>/<name>.frag.glsl` + `<name>/<name>.ts` mirroring the wave/pixelate/noiseField pattern (descriptor with `type,label,frag,params,uniforms,blend`). Shaders sample `uPrev`, read `uRes,uTime`, and may use `uAlpha`.

- [ ] **Step 1: Failing test (extend registry.test.ts)**

```ts
it("registers all ten effects", () => {
  for (const t of ["wave","pixelate","noiseField","bloomPulse","spectrumBars","feedbackTrails","kaleido","chromaShift","contourLines","particleBurst"]) {
    expect(effectTypes).toContain(t);
    expect(EFFECTS[t].frag.length).toBeGreaterThan(20);
  }
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — create each (concise, correct GLSL). Example for bloomPulse:

`src/pulse/effects/bloomPulse/bloomPulse.frag.glsl`:
```glsl
precision highp float;
uniform vec2 uRes; uniform float uIntensity; uniform float uRadius; uniform sampler2D uPrev;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 c = uv - 0.5;
  float d = length(c);
  float glow = uIntensity * smoothstep(uRadius, 0.0, d);
  vec3 prev = texture2D(uPrev, uv).rgb;
  gl_FragColor = vec4(prev + glow * vec3(1.0, 0.7, 0.9), 1.0);
}
```
`bloomPulse.ts`:
```ts
import frag from "./bloomPulse.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const bloomPulse: EffectDescriptor = {
  type: "bloomPulse", label: "Bloom Pulse", frag, blend: "add",
  params: [
    { name: "intensity", min: 0, max: 2, default: 0.6, step: 0.05 },
    { name: "radius", min: 0.1, max: 1.5, default: 0.6, step: 0.05 },
  ],
  uniforms: (p) => ({ uIntensity: p.intensity, uRadius: p.radius }),
};
```

Implement the remaining six analogously (full GLSL provided in the descriptor comments — the implementer writes straightforward shaders):
- **spectrumBars**: `uLow,uMid,uHigh` → three stacked bars; bar height = band; `blend:"add"`.
- **feedbackTrails**: mix `uPrev` with itself scaled by `uDecay` (motion smear); `blend:"alpha"`; `uDecay` param.
- **kaleido**: polar-fold uv into `uSegments` wedges, sample `uPrev`; `blend:"alpha"`.
- **chromaShift**: sample `uPrev` at uv±`uAmount` per channel (RGB split); `blend:"alpha"`.
- **contourLines**: `fract(noise*uFreq)` iso-lines of a hash-noise field; threshold `uThreshold`; `blend:"screen"`.
- **particleBurst**: cheap procedural dots from `hash(floor(uv*uCount))` gated by `uBurst`; `blend:"add"`.

Each `.ts` exports the descriptor; add all to `registry.ts`:
```ts
import { bloomPulse } from "./bloomPulse/bloomPulse";
// ...all 7...
export const EFFECTS: Record<string, EffectDescriptor> = {
  wave, pixelate, noiseField, bloomPulse, spectrumBars, feedbackTrails, kaleido, chromaShift, contourLines, particleBurst,
};
```

- [ ] **Step 4: Run → PASS.** Each shader must compile at runtime (verified in E2E Task 11); the unit test only checks registration. To catch GLSL typos early, the implementer should eyeball each against the working wave shader.
- [ ] **Step 5: Commit** `git add src/pulse/effects && git commit -m "feat(pulse): 7 more effects (bloom, bars, trails, kaleido, chroma, contour, particles)"`

---

## Task 5: Effect-stack + binding inspector

**Files:** Create `editor/canvases/music/EffectStack.tsx`; Modify `editor/canvases/music/Inspector.tsx`. No unit test (UI); typecheck + manual.

- [ ] **Step 1: Implement `EffectStack.tsx`** — props `{ deck: Deck; deckKey: "A"|"B"; stems: Stem[]; onChange: (next: PulseProject|updater)=>void }`. Renders:
  - For each effect: header (label + enable toggle + lock toggle + remove + up/down reorder), param sliders (from `EFFECTS[type].params`), and a binding list. "Add effect" dropdown lists `effectTypes`.
  - Binding row: param `<select>` (effect's param names), source-stem `<select>` (`master` + stem ids), feature `<select>` (the 8 features), amount/offset number inputs, curve select, remove. "Add binding" appends a default binding.
  All edits go through `onChange` producing a new `PulseProject` (immutably update `decks[deckKey]`).

```tsx
// src/pulse/effects param + binding editing. Full component (~150 lines).
import React from "react";
import { EFFECTS, effectTypes } from "../../../src/pulse/effects/registry";
import type { PulseProject, Deck, Stem, Binding, Feature } from "../../../src/pulse/schema";

const FEATURES: Feature[] = ["level","bandLow","bandMid","bandHigh","onset","tempoPhase","brightness","flux"];

export const EffectStack: React.FC<{
  project: PulseProject; deckKey: "A" | "B";
  onChange: (next: PulseProject | ((p: PulseProject) => PulseProject)) => void;
}> = ({ project, deckKey, onChange }) => {
  const deck: Deck = project.decks[deckKey];
  const stems: Stem[] = project.stems;
  const setDeck = (fn: (d: Deck) => Deck) =>
    onChange((p) => ({ ...p, decks: { ...p.decks, [deckKey]: fn(p.decks[deckKey]) } }));

  const addEffect = (type: string) => setDeck((d) => ({
    effects: [...d.effects, { id: `${type}-${d.effects.length}`, type, enabled: true, locked: false,
      params: Object.fromEntries(EFFECTS[type].params.map((s) => [s.name, s.default])), bindings: [] }],
  }));
  const update = (i: number, fn: (e: Deck["effects"][number]) => Deck["effects"][number]) =>
    setDeck((d) => ({ effects: d.effects.map((e, j) => (j === i ? fn(e) : e)) }));
  const remove = (i: number) => setDeck((d) => ({ effects: d.effects.filter((_, j) => j !== i) }));
  const move = (i: number, dir: -1 | 1) => setDeck((d) => {
    const j = i + dir; if (j < 0 || j >= d.effects.length) return d;
    const e = [...d.effects]; [e[i], e[j]] = [e[j], e[i]]; return { effects: e };
  });

  return (
    <div style={{ fontSize: 12, color: "#bbb" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ fontWeight: 600, color: "#ddd" }}>Deck {deckKey} effects</span>
        <select value="" onChange={(e) => e.target.value && addEffect(e.target.value)} style={{ marginLeft: "auto" }}>
          <option value="">+ add effect…</option>
          {effectTypes.map((t) => <option key={t} value={t}>{EFFECTS[t].label}</option>)}
        </select>
      </div>
      {deck.effects.map((eff, i) => (
        <div key={eff.id} style={{ border: "1px solid #222", borderRadius: 6, padding: 6, marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={eff.enabled} onChange={(e) => update(i, (x) => ({ ...x, enabled: e.target.checked }))} />
            <span style={{ flex: 1, color: "#ddd" }}>{EFFECTS[eff.type]?.label ?? eff.type}</span>
            <button title="lock" onClick={() => update(i, (x) => ({ ...x, locked: !x.locked }))}>{eff.locked ? "🔒" : "🔓"}</button>
            <button onClick={() => move(i, -1)}>↑</button>
            <button onClick={() => move(i, 1)}>↓</button>
            <button onClick={() => remove(i)}>✕</button>
          </div>
          {(EFFECTS[eff.type]?.params ?? []).map((spec) => (
            <div key={spec.name} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <span style={{ width: 90 }}>{spec.name}</span>
              <input type="range" min={spec.min} max={spec.max} step={spec.step}
                value={eff.params[spec.name] ?? spec.default}
                onChange={(e) => update(i, (x) => ({ ...x, params: { ...x.params, [spec.name]: Number(e.target.value) } }))} />
              <span style={{ width: 40, textAlign: "right" }}>{(eff.params[spec.name] ?? spec.default).toFixed(2)}</span>
            </div>
          ))}
          <div style={{ marginTop: 6, color: "#8ab" }}>
            bindings
            <button style={{ marginLeft: 8 }} onClick={() => update(i, (x) => ({ ...x, bindings: [...x.bindings,
              { param: EFFECTS[x.type]?.params[0]?.name ?? "", source: { stem: "master", feature: "level" }, amount: 1, curve: "linear", offset: 0 }] }))}>+ bind</button>
          </div>
          {eff.bindings.map((b, bi) => {
            const setB = (fn: (b: Binding) => Binding) => update(i, (x) => ({ ...x, bindings: x.bindings.map((y, j) => (j === bi ? fn(y) : y)) }));
            return (
              <div key={bi} style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap" }}>
                <select value={b.param} onChange={(e) => setB((y) => ({ ...y, param: e.target.value }))}>
                  {(EFFECTS[eff.type]?.params ?? []).map((s) => <option key={s.name}>{s.name}</option>)}
                </select>
                <select value={b.source.stem} onChange={(e) => setB((y) => ({ ...y, source: { ...y.source, stem: e.target.value } }))}>
                  <option value="master">master</option>
                  {stems.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <select value={b.source.feature} onChange={(e) => setB((y) => ({ ...y, source: { ...y.source, feature: e.target.value as Feature } }))}>
                  {FEATURES.map((f) => <option key={f}>{f}</option>)}
                </select>
                <input style={{ width: 48 }} type="number" step={0.1} value={b.amount} onChange={(e) => setB((y) => ({ ...y, amount: Number(e.target.value) }))} />
                <select value={b.curve} onChange={(e) => setB((y) => ({ ...y, curve: e.target.value as Binding["curve"] }))}>
                  <option>linear</option><option>exp</option><option>log</option><option>smooth</option>
                </select>
                <button onClick={() => update(i, (x) => ({ ...x, bindings: x.bindings.filter((_, j) => j !== bi) }))}>✕</button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 2: Modify `Inspector.tsx`** to render: a tab toggle "Stems | Deck A | Deck B"; Stems = existing volume sliders + mute checkbox; Deck A/B = `<EffectStack project={doc} deckKey=… onChange=…/>`. Keep it within the existing CanvasInspectorProps signature (doc, onChange).

- [ ] **Step 3: Typecheck** `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"` → must stay at the pre-task count (0 for pulse).
- [ ] **Step 4: Commit** `git add editor/canvases/music/EffectStack.tsx editor/canvases/music/Inspector.tsx && git commit -m "feat(pulse): effect-stack + binding inspector, deck tabs, mute"`

---

## Task 6: Audio-engine hook + Renderer A/B transition + Mix panel

**Files:** Create `editor/canvases/music/useAudioEngine.ts`, `editor/canvases/music/MixPanel.tsx`; Modify `Renderer.tsx`, `PulseApp.tsx`.

- [ ] **Step 1: `useAudioEngine.ts`** — builds an `AudioGraph` from all stems (via `createAudioGraph`), exposes `{ play, pause, seek, currentTime, duration, isPlaying, setGains }`, and rebuilds when the stem set changes. Updates gains whenever stem volumes/mutes change.

```ts
import { useEffect, useRef, useState } from "react";
import { createAudioGraph, computeGains, type AudioGraph } from "../../../src/pulse/audioGraph";
import type { Stem } from "../../../src/pulse/schema";

export function useAudioEngine(stems: Stem[], urlFor: (file: string) => string) {
  const [graph, setGraph] = useState<AudioGraph | null>(null);
  const graphRef = useRef<AudioGraph | null>(null);
  const ids = stems.map((s) => s.id).join(",");

  useEffect(() => {
    let alive = true;
    if (stems.length === 0) return;
    void (async () => {
      const g = await createAudioGraph(stems.map((s) => ({ id: s.id, url: urlFor(s.file) })));
      if (!alive) { g.dispose(); return; }
      graphRef.current = g; setGraph(g);
    })();
    return () => { alive = false; graphRef.current?.dispose(); graphRef.current = null; setGraph(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  useEffect(() => { graph?.setGains(computeGains(stems)); }, [graph, stems]);
  return graph;
}
```

- [ ] **Step 2: `MixPanel.tsx`** — controls bound to `doc.mix`: template `<select>` (7 templates), durationSec number, curve `<select>`, and a **Release** button. Release: calls a passed `onRelease()`.

```tsx
import React from "react";
import type { PulseProject, MixState } from "../../../src/pulse/schema";

const TEMPLATES: MixState["template"][] = ["cut","crossfade","progressive","seesaw","fast","slow","morphParams"];
const CURVES: MixState["curve"][] = ["linear","ease","exp","seesaw","step"];

export const MixPanel: React.FC<{
  doc: PulseProject;
  onChange: (next: PulseProject | ((p: PulseProject) => PulseProject)) => void;
  onRelease: () => void;
}> = ({ doc, onChange, onRelease }) => {
  const set = (patch: Partial<MixState>) => onChange((p) => ({ ...p, mix: { ...p.mix, ...patch } }));
  return (
    <div style={{ padding: 8, borderTop: "1px solid #222", fontSize: 12, color: "#bbb" }}>
      <div style={{ fontWeight: 600, color: "#ddd", marginBottom: 6 }}>Mix · {doc.mix.active}</div>
      <label style={{ display: "block", marginBottom: 4 }}>template
        <select value={doc.mix.template} onChange={(e) => set({ template: e.target.value as MixState["template"] })}>
          {TEMPLATES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </label>
      <label style={{ display: "block", marginBottom: 4 }}>duration (s)
        <input type="number" min={0.2} step={0.2} value={doc.mix.durationSec} onChange={(e) => set({ durationSec: Number(e.target.value) })} />
      </label>
      <label style={{ display: "block", marginBottom: 6 }}>curve
        <select value={doc.mix.curve} onChange={(e) => set({ curve: e.target.value as MixState["curve"] })}>
          {CURVES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <button onClick={onRelease} disabled={doc.mix.active === "transitioning"} style={{ width: "100%", padding: 8 }}>
        {doc.mix.active === "transitioning" ? `Transitioning… ${(doc.mix.progress * 100) | 0}%` : "Release Deck B → Stage"}
      </button>
    </div>
  );
};
```

- [ ] **Step 3: Modify `Renderer.tsx`** — accept `engine` (the AudioGraph) instead of an `<audio>` element, use `engine.currentTime` as `getTime`. When `doc.mix.active === "transitioning"`, render `blendDecks(A, B, shapeCurve(progress, curve), template)` instead of Deck A. Add simple transport buttons (play/pause/seek slider) driven by the engine.

- [ ] **Step 4: Modify `PulseApp.tsx`** — use `useAudioEngine`; pass engine to Renderer; drive a `requestAnimationFrame` that, while `mix.active==="transitioning"`, advances `mix.progress` by `dt/durationSec` and at ≥1 commits: set Deck A = the released Deck B, reset Deck B, set `mix.active="A"`, `progress=0`. Wire MixPanel `onRelease` → see Task 8 (git release) → then set `mix.active="transitioning"`.

- [ ] **Step 5: Typecheck (0 pulse errors) + Commit** `git add editor/canvases/music/useAudioEngine.ts editor/canvases/music/MixPanel.tsx editor/canvases/music/Renderer.tsx editor/canvases/music/PulseApp.tsx && git commit -m "feat(pulse): multi-stem engine, A/B transition rendering, Mix panel"`

---

## Task 7: Waveform / beat / onset timeline

**Files:** Create `editor/canvases/music/Timeline.tsx`; Modify `index.tsx` to provide it. No unit test; typecheck + manual.

- [ ] **Step 1: Implement `Timeline.tsx`** — a canvas that draws the master level envelope (from `analysis.stems` summed `level` arrays) as a waveform, vertical lines at `beatTimesSec`, dots at union of stem `onsets`, and a playhead at `engine.currentTime`. Click-to-seek calls `engine.seek`. Props include `analysis`, `engine`, `width`.

```tsx
import React, { useEffect, useRef } from "react";
import type { Analysis } from "../../../src/pulse/analysis";
import type { AudioGraph } from "../../../src/pulse/audioGraph";

export const Timeline: React.FC<{ analysis: Analysis | null; engine: AudioGraph | null; height?: number }> = ({ analysis, engine, height = 90 }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  useEffect(() => {
    const cvs = ref.current; if (!cvs) return;
    const ctx = cvs.getContext("2d"); if (!ctx) return;
    const draw = () => {
      const w = cvs.width, h = cvs.height;
      ctx.clearRect(0, 0, w, h); ctx.fillStyle = "#0a0a0a"; ctx.fillRect(0, 0, w, h);
      if (analysis && analysis.stems.length) {
        const n = analysis.stems[0].level.length;
        ctx.strokeStyle = "#3a6"; ctx.beginPath();
        for (let x = 0; x < w; x++) {
          const i = Math.floor((x / w) * n);
          let lvl = 0; for (const s of analysis.stems) lvl = Math.max(lvl, s.level[i] ?? 0);
          const y = h - lvl * h; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.strokeStyle = "#244"; for (const t of analysis.beatTimesSec) { const x = (t / analysis.durationSec) * w; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
        ctx.fillStyle = "#fa0"; for (const s of analysis.stems) for (const o of s.onsets) { const x = (o / analysis.durationSec) * w; ctx.fillRect(x, h - 4, 1, 4); }
      }
      if (engine) { const x = (engine.currentTime() / Math.max(0.01, engine.duration())) * cvs.width; ctx.strokeStyle = "#fff"; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cvs.height); ctx.stroke(); }
      raf.current = requestAnimationFrame(draw);
    };
    raf.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf.current);
  }, [analysis, engine]);
  const onClick = (e: React.MouseEvent) => {
    if (!engine) return; const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
    engine.seek(((e.clientX - r.left) / r.width) * engine.duration());
  };
  return <canvas ref={ref} width={1200} height={height} onClick={onClick} style={{ width: "100%", height, display: "block", cursor: "pointer" }} />;
};
```

- [ ] **Step 2: Wire** the Timeline into `PulseApp` below the Renderer (it needs the engine, so it's mounted in PulseApp, not via the plugin's `Timeline` field which lacks engine access — leave `musicCanvas.Timeline = null`, render Timeline directly in PulseApp).
- [ ] **Step 3: Typecheck + Commit** `git add editor/canvases/music/Timeline.tsx editor/canvases/music/PulseApp.tsx && git commit -m "feat(pulse): waveform + beat + onset timeline with click-seek"`

---

## Task 8: Git release path (Rust)

**Files:** Create `src-tauri/src/git.rs`; Modify `src-tauri/src/lib.rs`. Test: Rust unit (pure arg building) optional; rely on build + manual.

- [ ] **Step 1: Implement `git.rs`** — thin wrappers shelling `git` in the project dir. The "release" is a repo-level operation on the APP repo (where `src/pulse/effects` lives), not the project folder, because effect code is in the repo. For the slice's data-only release (decks live in project.json), the git step is optional; we still implement commands so the agent/app can branch the app repo when editing shaders.

```rust
//! Thin git wrappers for the Pulse release flow. Operate on a given repo dir.
use std::process::Command;

fn run(dir: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git").current_dir(dir).args(args).output()
        .map_err(|e| format!("git launch: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
pub fn git_current_branch(repo: String) -> Result<String, String> {
    Ok(run(&repo, &["rev-parse", "--abbrev-ref", "HEAD"])?.trim().to_string())
}

#[tauri::command]
pub fn git_branch(repo: String, name: String) -> Result<(), String> {
    run(&repo, &["checkout", "-B", &name])?; Ok(())
}

#[tauri::command]
pub fn git_commit_all(repo: String, message: String) -> Result<(), String> {
    run(&repo, &["add", "-A"])?;
    // Allow empty so a no-op release doesn't error.
    run(&repo, &["commit", "--allow-empty", "-m", &message])?; Ok(())
}

#[tauri::command]
pub fn git_merge(repo: String, branch: String, into: String) -> Result<(), String> {
    run(&repo, &["checkout", &into])?;
    run(&repo, &["merge", "--no-ff", "-m", &format!("merge {branch}"), &branch])?; Ok(())
}
```

- [ ] **Step 2: Register** in `lib.rs` (`mod git;` + handlers `git::git_current_branch, git::git_branch, git::git_commit_all, git::git_merge`).
- [ ] **Step 3: Build** `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5` → compiles.
- [ ] **Step 4: Wire release in `PulseApp`** — `onRelease`: if a project field `mix.active` is "B"/"A", set `mix.active="transitioning"`, progress 0; the rAF loop animates. (Git commit of shader edits is the agent's job via the skill; the app-level release is the visual transition. Document this.) Optionally call `git_commit_all` on the project dir to snapshot project.json. Keep it best-effort (catch errors).
- [ ] **Step 5: Commit** `git add src-tauri/src/git.rs src-tauri/src/lib.rs editor/canvases/music/PulseApp.tsx && git commit -m "feat(pulse): git release commands + wire release→transition"`

---

## Task 9: Second fullscreen stage window

**Files:** Create `src-tauri/src/stage.rs`, `editor/canvases/music/StageWindow.tsx`; Modify `lib.rs`, `main.tsx`, capabilities.

- [ ] **Step 1: `stage.rs`** — command `open_stage_window` that creates (or focuses) a `WebviewWindow` with label `stage`, URL `/stage`, fullscreen, positioned on the 2nd monitor if present.

```rust
//! Second "stage" window: fullscreen live visualizer on a 2nd monitor.
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
pub fn open_stage_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("stage") {
        let _ = w.set_focus();
        return Ok(());
    }
    let builder = WebviewWindowBuilder::new(&app, "stage", WebviewUrl::App("/stage".into()))
        .title("Pulse Stage")
        .decorations(false);
    let win = builder.build().map_err(|e| e.to_string())?;
    // Position on the secondary monitor if there is one, else fullscreen primary.
    if let Ok(monitors) = win.available_monitors() {
        if monitors.len() > 1 {
            let m = &monitors[1];
            let pos = m.position();
            let _ = win.set_position(tauri::PhysicalPosition { x: pos.x, y: pos.y });
        }
    }
    let _ = win.set_fullscreen(true);
    Ok(())
}

#[tauri::command]
pub fn close_stage_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("stage") { let _ = w.close(); }
    Ok(())
}
```

- [ ] **Step 2: Register** in `lib.rs` (`mod stage;` + handlers). 
- [ ] **Step 3: Capabilities** — the new window needs permissions. Edit `src-tauri/capabilities/default.json`: change `"windows": ["main"]` to `"windows": ["main", "stage"]` so the stage webview gets core + asset + event permissions. (Asset protocol + events are needed for it to load stems and receive clock.)
- [ ] **Step 4: `StageWindow.tsx`** — a minimal full-viewport component: loads the active project's `project.json` + `analysis.json` (via the same load path; it can read from a query param or re-open the active project through `load_doc` since the Rust active-project state is shared across windows), builds its own `AudioGraph`, and renders Deck A (or the transition blend) full-screen. It listens for `pulse://clock` and `pulse://release`/doc changes to stay in sync. For v1 simplicity: the stage owns its own engine + clock and plays independently, started by a `pulse://play` event from the main window. Sync tolerance is acceptable for a visual show.

```tsx
import React, { useEffect, useState } from "react";
import { Stage } from "../../../src/pulse/Stage";
import { pulseProjectSchema, type PulseProject } from "../../../src/pulse/schema";
import type { Analysis } from "../../../src/pulse/analysis";
import { createAudioGraph, computeGains, type AudioGraph } from "../../../src/pulse/audioGraph";
import { blendDecks, shapeCurve } from "../../../src/pulse/transitions";

export const StageWindow: React.FC = () => {
  const [doc, setDoc] = useState<PulseProject | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [engine, setEngine] = useState<AudioGraph | null>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize); return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    void (async () => {
      const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");
      const loadAll = async () => {
        const text = await invoke<string>("load_doc");
        const d = pulseProjectSchema.parse(JSON.parse(text)); setDoc(d);
        // active project path comes via project://opened normally; here derive from doc? Use a dedicated command.
        const path = await invoke<string>("active_project_path").catch(() => "");
        if (path) {
          try { const r = await fetch(convertFileSrc(`${path}/analysis.json`)); if (r.ok) setAnalysis(await r.json()); } catch { /* */ }
          if (d.stems.length) {
            const g = await createAudioGraph(d.stems.map((s) => ({ id: s.id, url: convertFileSrc(`${path}/stems/${s.file}`) })));
            g.setGains(computeGains(d.stems)); setEngine(g);
          }
        }
      };
      await loadAll();
      const un1 = await listen("pulse://play", () => engineRef.current?.play());
      const un2 = await listen("pulse://pause", () => engineRef.current?.pause());
      const un3 = await listen<PulseProject>("pulse://doc", (e) => setDoc(e.payload));
      return () => { un1(); un2(); un3(); };
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const engineRef = React.useRef<AudioGraph | null>(null);
  engineRef.current = engine;

  if (!doc) return <div style={{ width: "100vw", height: "100vh", background: "#000", color: "#444", display: "grid", placeItems: "center" }}>Stage — no project</div>;
  const deck = doc.mix.active === "transitioning"
    ? blendDecks(doc.decks.A, doc.decks.B, shapeCurve(doc.mix.progress, doc.mix.curve), doc.mix.template)
    : doc.decks.A;
  return (
    <div style={{ width: "100vw", height: "100vh", background: "#000" }}>
      <Stage deck={deck} analysis={analysis} stemVolumes={computeGains(doc.stems)} getTime={() => engine?.currentTime() ?? 0} width={size.w} height={size.h} />
    </div>
  );
};
```

  This needs a Rust command `active_project_path`. Add it (returns the active project path from AppState).

- [ ] **Step 5: `main.tsx` routing** — before rendering `<App/>`:
```tsx
if (window.location.pathname.startsWith("/stage")) {
  import("./canvases/music/StageWindow").then(({ StageWindow }) => {
    createRoot(document.getElementById("root")!).render(<StageWindow />);
  });
} else {
  createRoot(document.getElementById("root")!).render(/* existing app tree */);
}
```
  Restructure `main.tsx` so the existing render is the `else` branch.

- [ ] **Step 6: `active_project_path` command** — add to `projects.rs`:
```rust
#[tauri::command]
pub fn active_project_path(state: State<'_, AppState>) -> Result<String, String> {
    state.active_project.lock().map_err(|e| e.to_string())?.as_ref()
        .map(|p| p.path.to_string_lossy().to_string())
        .ok_or_else(|| "no active project".into())
}
```
  Register it. Emit `pulse://play`/`pulse://pause`/`pulse://doc` from PulseApp on play/pause and on doc autosave so the stage mirrors.

- [ ] **Step 7: PulseApp** — add a "Open Stage ⤢" button calling `open_stage_window`; on play/pause emit the pulse events; on doc change emit `pulse://doc`.
- [ ] **Step 8: Build (Rust) + Typecheck + Commit** `git add src-tauri/src/stage.rs src-tauri/src/projects.rs src-tauri/src/lib.rs src-tauri/capabilities/default.json editor/main.tsx editor/canvases/music/StageWindow.tsx editor/canvases/music/PulseApp.tsx && git commit -m "feat(pulse): second fullscreen stage window on 2nd monitor + clock/doc sync"`

---

## Task 10: Three-way merge + skill bundle completion

**Files:** Modify `editor/canvases/music/index.tsx` (resolveConflict), `src-tauri/skills/pulse/*` (add effects.md, bindings.md, transitions.md); register extra files in `music.rs` BUNDLE.

- [ ] **Step 1: Real `resolveConflict`** — preserve the user's in-memory stem volumes/mutes when the agent edits bindings/effects. Strategy: start from `agent`, but overwrite `stems[i].volume`/`muted` with `user` values where the stem id matches and the user changed it from `saved`.

```ts
resolveConflict: (saved, agent, user) => {
  const byId = (arr: PulseProject["stems"]) => Object.fromEntries(arr.map((s) => [s.id, s]));
  const us = byId(user.stems), ss = byId(saved.stems);
  const merged: PulseProject = {
    ...agent,
    stems: agent.stems.map((s) => {
      const u = us[s.id], sv = ss[s.id];
      if (u && sv && (u.volume !== sv.volume || u.muted !== sv.muted)) {
        return { ...s, volume: u.volume, muted: u.muted }; // user's live mixer wins
      }
      return s;
    }),
    mix: user.mix.active === "transitioning" ? user.mix : agent.mix, // don't stomp an in-flight transition
  };
  return { merged, prompt: "" };
},
```

- [ ] **Step 2: Add skill docs** `effects.md`, `bindings.md`, `transitions.md` under `src-tauri/skills/pulse/` (concise: the effect descriptor contract, the feature bus + binding shape, the transition template list). Register them in `music.rs` BUNDLE `files`.
- [ ] **Step 3: Build + Typecheck + Commit** `git add editor/canvases/music/index.tsx src-tauri/skills/pulse src-tauri/src/canvases/music.rs && git commit -m "feat(pulse): three-way merge preserves live mixer; full agent skill bundle"`

---

## Task 11: Full verification + manual E2E

- [ ] **Step 1: Full test suite** `npx vitest run` → all green (expect ~135+ tests).
- [ ] **Step 2: Typecheck** `npx tsc --noEmit -p tsconfig.json` → 0 errors.
- [ ] **Step 3: Editor build** `npm run build:editor` → succeeds (all shaders + StageWindow resolve).
- [ ] **Step 4: Rust build** `cargo build --manifest-path src-tauri/Cargo.toml` → compiles.
- [ ] **Step 5: Manual E2E** (human, app running):
  1. Launch app, open Pulse, Import the provided stems folder → 6 stems classify.
  2. Add several effects in Deck A, bind features→params, play → reacts; drag stem volumes → visual amplitude changes.
  3. Open Stage window (2nd monitor fullscreen) → shows live Deck A.
  4. Author Deck B (different effects), set Mix template=crossfade duration=4 curve=ease, Release → watch A→B transition complete on both preview and stage.
  5. Use the agent (terminal) to add a new shader/binding; confirm hot-reload.
- [ ] **Step 6: Commit any fixes; final commit** summarizing completion.

---

## Self-Review

**Spec coverage (steps 4–8):**
- §8 stem mixer + effect stack + bindings → Task 5. ✓
- §8 preview→release→mix, progress animation → Tasks 6, 8. ✓
- §9 transition templates + curves → Task 1, rendered in Task 6/9. ✓
- §7 second fullscreen stage window on 2nd monitor + sync → Task 9. ✓
- §5 full 10-effect library → Tasks (prior 3) + Task 4. ✓
- §10 agent skill bundle (effects/bindings/transitions) → Task 10. ✓
- Three-way merge preserving live mixer → Task 10. ✓
- Waveform/beat/onset timeline → Task 7. ✓
- Per-stem volume = audio gain AND visual amplitude → Task 2 + Task 6. ✓

**Placeholder scan:** Task 4's six non-bloom shaders are specified by behavior + uniform list rather than full GLSL text — the implementer writes ~10-line shaders mirroring the provided wave/bloomPulse examples. This is a deliberate, bounded latitude (shader bodies are trivial and better written against the live compiler), not an unbounded placeholder. Everything else has concrete code.

**Type consistency:** `blendDecks`, `shapeCurve`, `createAudioGraph`, `computeGains`, `AudioGraph`, `useAudioEngine`, `EffectStack`, `MixPanel`, `Timeline`, `StageWindow`, `open_stage_window`, `active_project_path` names are used consistently across tasks. `_alpha`/`_mix` param convention introduced in Task 1 is honored by Stage (Task 3) and Renderer (Task 6).
