# Pulse Music Visualizer — Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Pulse music-visualizer app end-to-end for one path: open the app from The Square, import the provided stems folder, analyze it into `analysis.json`, and render an audio-reactive WebGL effect in the preview that visibly reacts to the playing song.

**Architecture:** New `CanvasPlugin` (`musicCanvas`) sibling to `kinetic`, reusing the platform substrate (terminal/chat, doc-watch, projects). The `activeCanvas` global becomes a per-app resolver. Audio analysis runs in the frontend via Web Audio `OfflineAudioContext` + a vendored FFT; ffmpeg (installed) normalizes formats. The renderer is a WebGL2 fragment-shader stage driven by an audio-clock transport, not Remotion frames. This plan covers spec build-steps 1–3 (the proof-of-concept slice); steps 4–8 (inspector/mixer, second window, Deck B/release/transitions, full effect library, skills) get a follow-up plan once the engine exists.

**Tech Stack:** TypeScript, React 19, Zod, Web Audio API, WebGL2/GLSL, Vitest, Tauri 2 (Rust), ffmpeg CLI.

**Spec:** `docs/superpowers/specs/2026-06-15-pulse-music-visualizer-design.md`

**Dev fixture:** `/Users/parandykt/Apps/VisualMachines/Song tune (Cover) Stems` (6 × 48kHz stereo WAV, ~175s).

---

## File Structure (decomposition locked here)

**Created — frontend domain (`src/pulse/`):**
- `src/pulse/schema.ts` — Zod schema + types for `project.json`.
- `src/pulse/fft.ts` — radix-2 iterative FFT (real input → magnitudes).
- `src/pulse/features.ts` — per-frame feature extraction (level, 3 bands, brightness, flux) from a Float32 channel.
- `src/pulse/classify.ts` — stem role classification from aggregate features.
- `src/pulse/analysis.ts` — orchestrates decode → features → classify → `Analysis` object; types for `analysis.json`.
- `src/pulse/transport.ts` — audio-clock `PlayerRef`-shaped shim over `AudioContext`.
- `src/pulse/featureBus.ts` — given `Analysis` + currentTime → `FeatureFrame`.
- `src/pulse/effects/types.ts` — `EffectDescriptor` contract.
- `src/pulse/effects/registry.ts` — `EffectType` union + descriptor map.
- `src/pulse/effects/wave/wave.frag.glsl`, `wave.ts` — first effect.
- `src/pulse/effects/pixelate/pixelate.frag.glsl`, `pixelate.ts` — second effect (the explicit pixel-size/falloff ask).
- `src/pulse/effects/noiseField/noiseField.frag.glsl`, `noiseField.ts` — third effect.
- `src/pulse/Stage.tsx` — WebGL2 deck compositor (ping-pong FBO).

**Created — editor wiring (`editor/canvases/music/`):**
- `editor/canvases/music/index.tsx` — `musicCanvas: CanvasPlugin<PulseProject>`.
- `editor/canvases/music/PulseApp.tsx` — Root component (project lifecycle + minimal layout).
- `editor/canvases/music/Renderer.tsx` — wraps `Stage` + transport into `CanvasRendererProps`.
- `editor/canvases/music/Inspector.tsx` — minimal stem list (full mixer is the follow-up plan).
- `editor/canvases/music/import.ts` — frontend import/analyze driver (calls `pulse_import`, runs analysis, writes docs).

**Created — Rust (`src-tauri/src/`):**
- `src-tauri/src/pulse.rs` — `pulse_import` command (ffmpeg normalize + progress).
- `src-tauri/src/canvases/music.rs` — `MusicCanvas` + skill `BUNDLE` (stub bundle for this slice).
- `src-tauri/templates/seed-pulse.json` — empty seed `project.json`.
- `src-tauri/skills/pulse/SKILL.md` — minimal routing skill (stub; full bundle in follow-up).

**Modified:**
- `editor/canvas.ts` — `activeCanvas` const → `resolveCanvas(appId)` resolver.
- `editor/platform/apps.ts:115` — replace `tonebench` placeholder with real `pulse` manifest.
- `src-tauri/src/canvas.rs` — add `MusicCanvas`; `active()` resolves per active canvas id.
- `src-tauri/src/canvases/mod.rs` — `pub mod music;`.
- `src-tauri/src/lib.rs` — register `pulse_import` command + `mod pulse;`.
- `tauri.conf.json` — asset scope `stems/**` + `analysis.json`.

---

## Task 1: Pulse project schema (`project.json`)

**Files:**
- Create: `src/pulse/schema.ts`
- Test: `src/pulse/__tests__/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/pulse/__tests__/schema.test.ts
import { describe, it, expect } from "vitest";
import { pulseProjectSchema, seedProject, type PulseProject } from "../schema";

describe("pulseProjectSchema", () => {
  it("accepts a seed project and round-trips through JSON", () => {
    const seed = seedProject("/songs/demo");
    const json = JSON.stringify(seed);
    const parsed = pulseProjectSchema.parse(JSON.parse(json));
    expect(parsed.version).toBe(1);
    expect(parsed.song.sourceFolder).toBe("/songs/demo");
    expect(parsed.decks.A.effects).toEqual([]);
    expect(parsed.decks.B.effects).toEqual([]);
    expect(parsed.mix.active).toBe("A");
  });

  it("rejects an out-of-range stem volume", () => {
    const seed = seedProject("/x") as PulseProject;
    const bad = { ...seed, stems: [{ id: "s0", file: "stem-00.wav", label: "S0", role: "unknown", volume: 5, muted: false }] };
    expect(() => pulseProjectSchema.parse(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pulse/__tests__/schema.test.ts`
Expected: FAIL — cannot find module `../schema`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/pulse/schema.ts
import { z } from "zod";

export const stemRoleSchema = z.enum([
  "kick", "bass", "drums", "harmony", "lead", "vocal", "fx", "unknown",
]);
export type StemRole = z.infer<typeof stemRoleSchema>;

export const featureSchema = z.enum([
  "level", "bandLow", "bandMid", "bandHigh", "onset", "tempoPhase", "brightness", "flux",
]);
export type Feature = z.infer<typeof featureSchema>;

export const bindingSchema = z.object({
  param: z.string(),
  source: z.object({ stem: z.string(), feature: featureSchema }),
  amount: z.number(),
  curve: z.enum(["linear", "exp", "log", "smooth"]).default("linear"),
  offset: z.number().default(0),
});
export type Binding = z.infer<typeof bindingSchema>;

export const effectInstanceSchema = z.object({
  id: z.string(),
  type: z.string(),
  enabled: z.boolean().default(true),
  locked: z.boolean().default(false),
  params: z.record(z.string(), z.number()).default({}),
  bindings: z.array(bindingSchema).default([]),
});
export type EffectInstance = z.infer<typeof effectInstanceSchema>;

export const deckSchema = z.object({ effects: z.array(effectInstanceSchema).default([]) });
export type Deck = z.infer<typeof deckSchema>;

export const stemSchema = z.object({
  id: z.string(),
  file: z.string(),
  label: z.string(),
  role: stemRoleSchema,
  volume: z.number().min(0).max(1),
  muted: z.boolean().default(false),
});
export type Stem = z.infer<typeof stemSchema>;

export const mixSchema = z.object({
  active: z.enum(["A", "B", "transitioning"]).default("A"),
  template: z.enum(["cut", "crossfade", "progressive", "seesaw", "fast", "slow", "morphParams"]).default("crossfade"),
  durationSec: z.number().default(4),
  curve: z.enum(["linear", "ease", "exp", "seesaw", "step"]).default("ease"),
  progress: z.number().min(0).max(1).default(0),
});
export type MixState = z.infer<typeof mixSchema>;

export const pulseProjectSchema = z.object({
  version: z.literal(1),
  song: z.object({
    sourceFolder: z.string(),
    durationSec: z.number().default(0),
    tempoBpm: z.number().default(0),
  }),
  stems: z.array(stemSchema).default([]),
  decks: z.object({ A: deckSchema, B: deckSchema }),
  mix: mixSchema,
});
export type PulseProject = z.infer<typeof pulseProjectSchema>;

export function seedProject(sourceFolder: string): PulseProject {
  return {
    version: 1,
    song: { sourceFolder, durationSec: 0, tempoBpm: 0 },
    stems: [],
    decks: { A: { effects: [] }, B: { effects: [] } },
    mix: { active: "A", template: "crossfade", durationSec: 4, curve: "ease", progress: 0 },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pulse/__tests__/schema.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pulse/schema.ts src/pulse/__tests__/schema.test.ts
git commit -m "feat(pulse): project.json schema + seed"
```

---

## Task 2: Radix-2 FFT

**Files:**
- Create: `src/pulse/fft.ts`
- Test: `src/pulse/__tests__/fft.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/pulse/__tests__/fft.test.ts
import { describe, it, expect } from "vitest";
import { fftMagnitudes } from "../fft";

describe("fftMagnitudes", () => {
  it("puts energy in the bin matching a pure sine", () => {
    const N = 64;
    const k = 8; // 8 cycles across the window
    const sig = new Float32Array(N);
    for (let n = 0; n < N; n++) sig[n] = Math.sin((2 * Math.PI * k * n) / N);
    const mags = fftMagnitudes(sig); // length N/2
    let peak = 0, peakBin = -1;
    for (let i = 0; i < mags.length; i++) if (mags[i] > peak) { peak = mags[i]; peakBin = i; }
    expect(peakBin).toBe(k);
  });

  it("returns near-zero for a DC-removed silent signal", () => {
    const mags = fftMagnitudes(new Float32Array(64));
    const sum = mags.reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThan(1e-6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pulse/__tests__/fft.test.ts`
Expected: FAIL — cannot find module `../fft`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/pulse/fft.ts
// Iterative radix-2 Cooley–Tukey FFT. Input length must be a power of 2.
// Real-input convenience: returns the magnitude spectrum (length N/2).
function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const tRe = re[b] * curRe - im[b] * curIm;
        const tIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - tRe; im[b] = im[a] - tIm;
        re[a] += tRe; im[a] += tIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe; curRe = nRe;
      }
    }
  }
}

export function fftMagnitudes(input: Float32Array): Float32Array {
  const n = input.length;
  if ((n & (n - 1)) !== 0) throw new Error("fft: length must be a power of 2");
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = input[i];
  fftInPlace(re, im);
  const half = n >> 1;
  const out = new Float32Array(half);
  for (let i = 0; i < half; i++) out[i] = Math.hypot(re[i], im[i]) / n;
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pulse/__tests__/fft.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pulse/fft.ts src/pulse/__tests__/fft.test.ts
git commit -m "feat(pulse): radix-2 FFT magnitude spectrum"
```

---

## Task 3: Per-frame feature extraction

**Files:**
- Create: `src/pulse/features.ts`
- Test: `src/pulse/__tests__/features.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/pulse/__tests__/features.test.ts
import { describe, it, expect } from "vitest";
import { extractFrame } from "../features";

const sine = (freq: number, sr: number, N: number) => {
  const b = new Float32Array(N);
  for (let n = 0; n < N; n++) b[n] = Math.sin((2 * Math.PI * freq * n) / sr);
  return b;
};

describe("extractFrame", () => {
  it("low tone has higher bandLow than bandHigh", () => {
    const sr = 48000, N = 2048;
    const f = extractFrame(sine(80, sr, N), sr);
    expect(f.bandLow).toBeGreaterThan(f.bandHigh);
  });

  it("high tone has higher brightness than a low tone", () => {
    const sr = 48000, N = 2048;
    const low = extractFrame(sine(80, sr, N), sr);
    const high = extractFrame(sine(8000, sr, N), sr);
    expect(high.brightness).toBeGreaterThan(low.brightness);
  });

  it("level of silence is ~0", () => {
    const f = extractFrame(new Float32Array(2048), 48000);
    expect(f.level).toBeLessThan(1e-4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pulse/__tests__/features.test.ts`
Expected: FAIL — cannot find module `../features`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/pulse/features.ts
import { fftMagnitudes } from "./fft";

export type Frame = {
  level: number;      // RMS 0..~1
  bandLow: number;    // <250 Hz energy
  bandMid: number;    // 250..2000 Hz
  bandHigh: number;   // >2000 Hz
  brightness: number; // spectral centroid, normalized 0..1
};

function nextPow2(n: number) { let p = 1; while (p < n) p <<= 1; return p; }

// Hann-windowed magnitude spectrum of a mono frame.
function spectrum(frame: Float32Array): { mags: Float32Array; sr2bin: number } {
  const N = nextPow2(frame.length);
  const buf = new Float32Array(N);
  for (let i = 0; i < frame.length; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frame.length - 1));
    buf[i] = frame[i] * w;
  }
  return { mags: fftMagnitudes(buf), sr2bin: N };
}

export function extractFrame(frame: Float32Array, sampleRate: number): Frame {
  // RMS level.
  let sumSq = 0;
  for (let i = 0; i < frame.length; i++) sumSq += frame[i] * frame[i];
  const level = Math.sqrt(sumSq / frame.length);

  const { mags, sr2bin } = spectrum(frame);
  const binHz = sampleRate / sr2bin;
  let low = 0, mid = 0, high = 0, weighted = 0, total = 0;
  for (let i = 1; i < mags.length; i++) {
    const hz = i * binHz, m = mags[i];
    if (hz < 250) low += m; else if (hz < 2000) mid += m; else high += m;
    weighted += hz * m; total += m;
  }
  const centroidHz = total > 0 ? weighted / total : 0;
  const brightness = Math.min(1, centroidHz / (sampleRate / 2));
  return { level, bandLow: low, bandMid: mid, bandHigh: high, brightness };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pulse/__tests__/features.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pulse/features.ts src/pulse/__tests__/features.test.ts
git commit -m "feat(pulse): per-frame audio feature extraction"
```

---

## Task 4: Stem role classification (name-agnostic)

**Files:**
- Create: `src/pulse/classify.ts`
- Test: `src/pulse/__tests__/classify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/pulse/__tests__/classify.test.ts
import { describe, it, expect } from "vitest";
import { classifyStem } from "../classify";

describe("classifyStem", () => {
  it("classifies low-energy, sparse-onset content as bass/kick", () => {
    const agg = { bandLowFrac: 0.8, bandMidFrac: 0.15, bandHighFrac: 0.05, brightnessMean: 0.05, onsetDensity: 0.4, fluxMean: 0.2 };
    const r = classifyStem(agg);
    expect(["bass", "kick"]).toContain(r.role);
    expect(r.confidence).toBeGreaterThan(0);
  });

  it("classifies bright, high-flux content as lead/fx, not bass", () => {
    const agg = { bandLowFrac: 0.1, bandMidFrac: 0.3, bandHighFrac: 0.6, brightnessMean: 0.7, onsetDensity: 0.5, fluxMean: 0.6 };
    const r = classifyStem(agg);
    expect(r.role).not.toBe("bass");
  });

  it("never throws and always returns a known role", () => {
    const r = classifyStem({ bandLowFrac: 0.33, bandMidFrac: 0.33, bandHighFrac: 0.34, brightnessMean: 0.4, onsetDensity: 0.1, fluxMean: 0.1 });
    expect(["kick","bass","drums","harmony","lead","vocal","fx","unknown"]).toContain(r.role);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pulse/__tests__/classify.test.ts`
Expected: FAIL — cannot find module `../classify`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/pulse/classify.ts
import type { StemRole } from "./schema";

export type Aggregate = {
  bandLowFrac: number;   // fraction of total band energy in low
  bandMidFrac: number;
  bandHighFrac: number;
  brightnessMean: number; // 0..1
  onsetDensity: number;   // onsets per second, normalized 0..1 (1 ≈ very busy)
  fluxMean: number;       // 0..1
};

export type Classification = { role: StemRole; confidence: number };

// Heuristic, filename-independent. Returns the best role + a rough
// confidence (margin between top and runner-up score).
export function classifyStem(a: Aggregate): Classification {
  const scores: Record<StemRole, number> = {
    kick:    a.bandLowFrac * 1.2 + a.onsetDensity * 0.3 - a.brightnessMean,
    bass:    a.bandLowFrac * 1.3 + (1 - a.fluxMean) * 0.3 - a.brightnessMean,
    drums:   a.onsetDensity * 1.2 + a.fluxMean * 0.6 + a.bandHighFrac * 0.4,
    harmony: a.bandMidFrac * 1.1 + (1 - a.fluxMean) * 0.5 - a.onsetDensity * 0.3,
    lead:    a.bandMidFrac * 0.6 + a.brightnessMean * 0.8 - a.onsetDensity * 0.2,
    vocal:   a.bandMidFrac * 0.9 + a.brightnessMean * 0.4 + a.fluxMean * 0.2,
    fx:      a.bandHighFrac * 0.8 + a.brightnessMean * 0.6,
    unknown: 0.25,
  };
  const ranked = (Object.entries(scores) as [StemRole, number][]).sort((x, y) => y[1] - x[1]);
  const [role, top] = ranked[0];
  const second = ranked[1][1];
  const confidence = Math.max(0, Math.min(1, top - second));
  return { role, confidence };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pulse/__tests__/classify.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pulse/classify.ts src/pulse/__tests__/classify.test.ts
git commit -m "feat(pulse): filename-agnostic stem role classification"
```

---

## Task 5: Analysis orchestration + types

**Files:**
- Create: `src/pulse/analysis.ts`
- Test: `src/pulse/__tests__/analysis.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/pulse/__tests__/analysis.test.ts
import { describe, it, expect } from "vitest";
import { analyzeChannel } from "../analysis";

// Build a 1-second 48k mono buffer: low tone for 0.5s then high tone.
function twoTone(sr: number): Float32Array {
  const buf = new Float32Array(sr);
  for (let n = 0; n < sr; n++) {
    const f = n < sr / 2 ? 80 : 8000;
    buf[n] = Math.sin((2 * Math.PI * f * n) / sr);
  }
  return buf;
}

describe("analyzeChannel", () => {
  it("produces per-frame arrays of equal length and a role", () => {
    const sr = 48000;
    const res = analyzeChannel(twoTone(sr), sr, 1 / 60);
    expect(res.level.length).toBe(res.brightness.length);
    expect(res.level.length).toBeGreaterThan(50);
    expect(res.brightness[5]).toBeLessThan(res.brightness[res.brightness.length - 5]); // bright at the end
    expect(typeof res.role).toBe("string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pulse/__tests__/analysis.test.ts`
Expected: FAIL — cannot find module `../analysis`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/pulse/analysis.ts
import { extractFrame } from "./features";
import { classifyStem, type Aggregate } from "./classify";
import type { StemRole } from "./schema";

export type AnalyzedStem = {
  id: string; file: string; role: StemRole; roleConfidence: number;
  level: number[]; bandLow: number[]; bandMid: number[]; bandHigh: number[];
  brightness: number[]; flux: number[]; onsets: number[];
};

export type Analysis = {
  version: 1; sampleRate: number; hopSec: number; durationSec: number;
  tempoBpm: number; beatTimesSec: number[]; stems: AnalyzedStem[];
};

const WIN = 2048;

// Analyze one mono channel into per-frame feature arrays + classification.
export function analyzeChannel(samples: Float32Array, sampleRate: number, hopSec: number) {
  const hop = Math.max(1, Math.round(hopSec * sampleRate));
  const level: number[] = [], bandLow: number[] = [], bandMid: number[] = [],
        bandHigh: number[] = [], brightness: number[] = [], flux: number[] = [];
  const onsets: number[] = [];
  let prevHigh = 0;
  for (let start = 0; start + WIN <= samples.length; start += hop) {
    const f = extractFrame(samples.subarray(start, start + WIN), sampleRate);
    level.push(f.level); bandLow.push(f.bandLow); bandMid.push(f.bandMid);
    bandHigh.push(f.bandHigh); brightness.push(f.brightness);
    const total = f.bandLow + f.bandMid + f.bandHigh + 1e-9;
    const fx = Math.max(0, total - prevHigh); flux.push(fx); prevHigh = total;
  }
  // Onset peaks: local maxima of flux above mean.
  const mean = flux.reduce((a, b) => a + b, 0) / Math.max(1, flux.length);
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] > mean * 1.5 && flux[i] > flux[i - 1] && flux[i] >= flux[i + 1]) {
      onsets.push((i * hop) / sampleRate);
    }
  }
  // Normalize level + flux + brightness to 0..1 by max.
  const norm = (arr: number[]) => { const m = Math.max(1e-9, ...arr); return arr.map((v) => v / m); };
  const nLevel = norm(level), nLow = norm(bandLow), nMid = norm(bandMid), nHigh = norm(bandHigh), nFlux = norm(flux);
  const sum = bandLow.reduce((a, b) => a + b, 0) + bandMid.reduce((a, b) => a + b, 0) + bandHigh.reduce((a, b) => a + b, 0) + 1e-9;
  const agg: Aggregate = {
    bandLowFrac: bandLow.reduce((a, b) => a + b, 0) / sum,
    bandMidFrac: bandMid.reduce((a, b) => a + b, 0) / sum,
    bandHighFrac: bandHigh.reduce((a, b) => a + b, 0) / sum,
    brightnessMean: brightness.reduce((a, b) => a + b, 0) / Math.max(1, brightness.length),
    onsetDensity: Math.min(1, onsets.length / Math.max(1, samples.length / sampleRate) / 8),
    fluxMean: nFlux.reduce((a, b) => a + b, 0) / Math.max(1, nFlux.length),
  };
  const cls = classifyStem(agg);
  return {
    role: cls.role, roleConfidence: cls.confidence,
    level: nLevel, bandLow: nLow, bandMid: nMid, bandHigh: nHigh,
    brightness, flux: nFlux, onsets,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pulse/__tests__/analysis.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/pulse/analysis.ts src/pulse/__tests__/analysis.test.ts
git commit -m "feat(pulse): channel analysis orchestration + Analysis types"
```

---

## Task 6: Feature bus (currentTime → FeatureFrame)

**Files:**
- Create: `src/pulse/featureBus.ts`
- Test: `src/pulse/__tests__/featureBus.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/pulse/__tests__/featureBus.test.ts
import { describe, it, expect } from "vitest";
import { sampleFeatures } from "../featureBus";
import type { Analysis } from "../analysis";

const mk = (): Analysis => ({
  version: 1, sampleRate: 48000, hopSec: 0.1, durationSec: 0.3, tempoBpm: 120, beatTimesSec: [0, 0.5],
  stems: [{
    id: "s0", file: "stem-00.wav", role: "bass", roleConfidence: 0.5,
    level: [0, 0.5, 1], bandLow: [0,0,0], bandMid: [0,0,0], bandHigh: [0,0,0],
    brightness: [0,0,0], flux: [0,0,0], onsets: [],
  }],
});

describe("sampleFeatures", () => {
  it("indexes the correct frame for a given time", () => {
    const a = mk();
    expect(sampleFeatures(a, 0.0).stems.s0.level).toBeCloseTo(0);
    expect(sampleFeatures(a, 0.1).stems.s0.level).toBeCloseTo(0.5);
    expect(sampleFeatures(a, 0.25).stems.s0.level).toBeCloseTo(1);
  });
  it("clamps past the end", () => {
    expect(sampleFeatures(mk(), 99).stems.s0.level).toBeCloseTo(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pulse/__tests__/featureBus.test.ts`
Expected: FAIL — cannot find module `../featureBus`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/pulse/featureBus.ts
import type { Analysis } from "./analysis";

export type StemFeatures = {
  level: number; bandLow: number; bandMid: number; bandHigh: number; brightness: number; flux: number;
};
export type FeatureFrame = {
  timeSec: number;
  tempoPhase: number;                 // 0..1 within the current beat
  master: StemFeatures;
  stems: Record<string, StemFeatures>;
};

const at = (arr: number[], i: number) => arr[Math.max(0, Math.min(arr.length - 1, i))] ?? 0;

export function sampleFeatures(a: Analysis, timeSec: number): FeatureFrame {
  const i = Math.floor(timeSec / a.hopSec);
  const stems: Record<string, StemFeatures> = {};
  const acc: StemFeatures = { level: 0, bandLow: 0, bandMid: 0, bandHigh: 0, brightness: 0, flux: 0 };
  for (const s of a.stems) {
    const f: StemFeatures = {
      level: at(s.level, i), bandLow: at(s.bandLow, i), bandMid: at(s.bandMid, i),
      bandHigh: at(s.bandHigh, i), brightness: at(s.brightness, i), flux: at(s.flux, i),
    };
    stems[s.id] = f;
    acc.level = Math.max(acc.level, f.level);
    acc.bandLow += f.bandLow; acc.bandMid += f.bandMid; acc.bandHigh += f.bandHigh;
    acc.brightness = Math.max(acc.brightness, f.brightness); acc.flux = Math.max(acc.flux, f.flux);
  }
  // tempoPhase from beat grid.
  let phase = 0;
  const beats = a.beatTimesSec;
  if (beats.length >= 2) {
    let b = 0; while (b < beats.length - 1 && beats[b + 1] <= timeSec) b++;
    const t0 = beats[b], t1 = beats[Math.min(beats.length - 1, b + 1)];
    phase = t1 > t0 ? Math.max(0, Math.min(1, (timeSec - t0) / (t1 - t0))) : 0;
  }
  return { timeSec, tempoPhase: phase, master: acc, stems };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pulse/__tests__/featureBus.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pulse/featureBus.ts src/pulse/__tests__/featureBus.test.ts
git commit -m "feat(pulse): feature bus — currentTime to FeatureFrame"
```

---

## Task 7: Effect contract + binding resolver

**Files:**
- Create: `src/pulse/effects/types.ts`
- Create: `src/pulse/bindings.ts`
- Test: `src/pulse/__tests__/bindings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/pulse/__tests__/bindings.test.ts
import { describe, it, expect } from "vitest";
import { resolveParam } from "../bindings";
import type { FeatureFrame } from "../featureBus";

const frame: FeatureFrame = {
  timeSec: 0, tempoPhase: 0.5,
  master: { level: 0.5, bandLow: 0.2, bandMid: 0, bandHigh: 0, brightness: 0.3, flux: 0 },
  stems: { s0: { level: 1, bandLow: 1, bandMid: 0, bandHigh: 0, brightness: 0, flux: 0 } },
};

describe("resolveParam", () => {
  it("returns base param when there is no binding", () => {
    expect(resolveParam(10, [], "size", frame, 1)).toBe(10);
  });
  it("adds a stem-bound feature scaled by amount and stem volume", () => {
    const bindings = [{ param: "size", source: { stem: "s0", feature: "level" as const }, amount: 4, curve: "linear" as const, offset: 0 }];
    // base 10 + level(1) * amount(4) * volume(0.5) = 12
    expect(resolveParam(10, bindings, "size", frame, 0.5)).toBe(12);
  });
  it("uses master features when stem is 'master'", () => {
    const bindings = [{ param: "size", source: { stem: "master", feature: "level" as const }, amount: 2, curve: "linear" as const, offset: 1 }];
    // base 0 + (level 0.5 * 2 + offset 1) * vol 1 = 2
    expect(resolveParam(0, bindings, "size", frame, 1)).toBeCloseTo(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pulse/__tests__/bindings.test.ts`
Expected: FAIL — cannot find module `../bindings`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/pulse/effects/types.ts
import type { FeatureFrame } from "../featureBus";

export type ParamSpec = { name: string; min: number; max: number; default: number; step: number };
export type UniformMap = Record<string, number | number[]>;

export type EffectDescriptor = {
  type: string;
  label: string;
  frag: string;                 // GLSL fragment source
  params: ParamSpec[];
  // Given resolved param values + the current audio frame, produce uniforms.
  uniforms: (resolved: Record<string, number>, frame: FeatureFrame) => UniformMap;
  blend: "add" | "screen" | "alpha" | "multiply";
};
```

```ts
// src/pulse/bindings.ts
import type { Binding, Feature } from "./schema";
import type { FeatureFrame, StemFeatures } from "./featureBus";

const featureValue = (f: StemFeatures, frame: FeatureFrame, name: Feature): number => {
  switch (name) {
    case "level": return f.level;
    case "bandLow": return f.bandLow;
    case "bandMid": return f.bandMid;
    case "bandHigh": return f.bandHigh;
    case "brightness": return f.brightness;
    case "flux": return f.flux;
    case "onset": return f.flux;          // onset proxy: instantaneous flux
    case "tempoPhase": return frame.tempoPhase;
  }
};

const shape = (v: number, curve: Binding["curve"]): number => {
  switch (curve) {
    case "linear": return v;
    case "exp": return v * v;
    case "log": return Math.sqrt(Math.max(0, v));
    case "smooth": return v * v * (3 - 2 * v);
  }
};

// Resolve a single effect param: base value + sum of its bindings, each
// scaled by binding.amount and the stem's volume (visual amplitude).
export function resolveParam(
  base: number,
  bindings: Binding[],
  param: string,
  frame: FeatureFrame,
  stemVolume: number,
): number {
  let v = base;
  for (const b of bindings) {
    if (b.param !== param) continue;
    const src = b.source.stem === "master" ? frame.master : frame.stems[b.source.stem];
    if (!src) continue;
    const raw = featureValue(src, frame, b.source.feature);
    const vol = b.source.stem === "master" ? 1 : stemVolume;
    v += (shape(raw, b.curve) * b.amount + b.offset) * vol;
  }
  return v;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pulse/__tests__/bindings.test.ts`
Expected: PASS (3 tests).

> Note: the `master` test adds `offset` inside the volume scale; with stem `master` volume is forced to 1, so `(0.5*2 + 1)*1 = 2`. Confirm the assertion matches.

- [ ] **Step 5: Commit**

```bash
git add src/pulse/effects/types.ts src/pulse/bindings.ts src/pulse/__tests__/bindings.test.ts
git commit -m "feat(pulse): effect descriptor contract + binding resolver"
```

---

## Task 8: Three starter effects (shaders + descriptors)

**Files:**
- Create: `src/pulse/effects/wave/wave.frag.glsl`, `src/pulse/effects/wave/wave.ts`
- Create: `src/pulse/effects/pixelate/pixelate.frag.glsl`, `src/pulse/effects/pixelate/pixelate.ts`
- Create: `src/pulse/effects/noiseField/noiseField.frag.glsl`, `src/pulse/effects/noiseField/noiseField.ts`
- Create: `src/pulse/effects/registry.ts`
- Test: `src/pulse/__tests__/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/pulse/__tests__/registry.test.ts
import { describe, it, expect } from "vitest";
import { EFFECTS, effectTypes } from "../effects/registry";

describe("effect registry", () => {
  it("registers wave, pixelate, noiseField with non-empty GLSL", () => {
    for (const t of ["wave", "pixelate", "noiseField"]) {
      expect(effectTypes).toContain(t);
      expect(EFFECTS[t].frag.length).toBeGreaterThan(20);
      expect(EFFECTS[t].params.length).toBeGreaterThan(0);
    }
  });
  it("pixelate exposes a pixel-size and falloff param", () => {
    const names = EFFECTS.pixelate.params.map((p) => p.name);
    expect(names).toContain("pixelSize");
    expect(names).toContain("falloff");
  });
  it("uniforms() returns a uTime and the param uniforms", () => {
    const frame = { timeSec: 1, tempoPhase: 0, master: { level: 0.5, bandLow: 0, bandMid: 0, bandHigh: 0, brightness: 0, flux: 0 }, stems: {} };
    const u = EFFECTS.wave.uniforms({ amplitude: 0.3, wavelength: 0.2 }, frame as any);
    expect(typeof u.uAmplitude).toBe("number");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pulse/__tests__/registry.test.ts`
Expected: FAIL — cannot find module `../effects/registry`.

- [ ] **Step 3: Write minimal implementation**

`src/pulse/effects/wave/wave.frag.glsl`:
```glsl
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uAmplitude; uniform float uWavelength;
uniform sampler2D uPrev;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float w = sin((uv.x / max(0.01, uWavelength) + uTime) * 6.2831);
  float d = abs(uv.y - 0.5 - w * uAmplitude);
  float line = smoothstep(0.02, 0.0, d);
  vec3 prev = texture2D(uPrev, uv).rgb;
  gl_FragColor = vec4(prev + vec3(line) * vec3(0.4, 0.8, 1.0), 1.0);
}
```

`src/pulse/effects/wave/wave.ts`:
```ts
import frag from "./wave.frag.glsl?raw";
import type { EffectDescriptor } from "../types";

export const wave: EffectDescriptor = {
  type: "wave", label: "Wave", frag, blend: "add",
  params: [
    { name: "amplitude", min: 0, max: 0.5, default: 0.15, step: 0.01 },
    { name: "wavelength", min: 0.02, max: 1, default: 0.2, step: 0.01 },
  ],
  uniforms: (p, frame) => ({ uTime: frame.timeSec, uAmplitude: p.amplitude, uWavelength: p.wavelength }),
};
```

`src/pulse/effects/pixelate/pixelate.frag.glsl`:
```glsl
precision highp float;
uniform vec2 uRes; uniform float uPixelSize; uniform float uFalloff; uniform sampler2D uPrev;
void main() {
  float px = max(1.0, uPixelSize);
  vec2 grid = floor(gl_FragCoord.xy / px) * px + px * 0.5;
  vec2 uv = grid / uRes;
  vec3 c = texture2D(uPrev, uv).rgb;
  // falloff darkens cell edges toward the cell center distance.
  vec2 f = fract(gl_FragCoord.xy / px) - 0.5;
  float edge = 1.0 - clamp(length(f) * 2.0 * uFalloff, 0.0, 1.0);
  gl_FragColor = vec4(c * edge, 1.0);
}
```

`src/pulse/effects/pixelate/pixelate.ts`:
```ts
import frag from "./pixelate.frag.glsl?raw";
import type { EffectDescriptor } from "../types";

export const pixelate: EffectDescriptor = {
  type: "pixelate", label: "Pixelate", frag, blend: "alpha",
  params: [
    { name: "pixelSize", min: 1, max: 80, default: 12, step: 1 },
    { name: "falloff", min: 0, max: 1, default: 0.3, step: 0.01 },
  ],
  uniforms: (p) => ({ uPixelSize: p.pixelSize, uFalloff: p.falloff }),
};
```

`src/pulse/effects/noiseField/noiseField.frag.glsl`:
```glsl
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uScale; uniform float uSpeed; uniform sampler2D uPrev;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float n = noise(uv * uScale + uTime * uSpeed);
  vec3 prev = texture2D(uPrev, uv).rgb;
  gl_FragColor = vec4(mix(prev, vec3(n, n*0.6, 1.0-n), 0.5), 1.0);
}
```

`src/pulse/effects/noiseField/noiseField.ts`:
```ts
import frag from "./noiseField.frag.glsl?raw";
import type { EffectDescriptor } from "../types";

export const noiseField: EffectDescriptor = {
  type: "noiseField", label: "Noise Field", frag, blend: "screen",
  params: [
    { name: "scale", min: 1, max: 40, default: 8, step: 0.5 },
    { name: "speed", min: 0, max: 4, default: 0.5, step: 0.05 },
  ],
  uniforms: (p, frame) => ({ uTime: frame.timeSec, uScale: p.scale, uSpeed: p.speed }),
};
```

`src/pulse/effects/registry.ts`:
```ts
import type { EffectDescriptor } from "./types";
import { wave } from "./wave/wave";
import { pixelate } from "./pixelate/pixelate";
import { noiseField } from "./noiseField/noiseField";

export const EFFECTS: Record<string, EffectDescriptor> = {
  wave, pixelate, noiseField,
};
export const effectTypes = Object.keys(EFFECTS);
```

> **GLSL import note:** `?raw` imports of `.glsl` work in Vite by default (treated as text). Vitest also resolves `?raw`. If Vitest errors on the `.glsl?raw` import, add `assetsInclude: ["**/*.glsl"]` to `vitest.config.ts` (and `vite.editor.config.ts`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pulse/__tests__/registry.test.ts`
Expected: PASS (3 tests). If it fails on `.glsl?raw` resolution, apply the assetsInclude note, then re-run.

- [ ] **Step 5: Commit**

```bash
git add src/pulse/effects vitest.config.ts
git commit -m "feat(pulse): wave/pixelate/noiseField effects + registry"
```

---

## Task 9: Audio-clock transport

**Files:**
- Create: `src/pulse/transport.ts`
- Test: `src/pulse/__tests__/transport.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/pulse/__tests__/transport.test.ts
import { describe, it, expect, vi } from "vitest";
import { makeTransport } from "../transport";

describe("makeTransport", () => {
  it("exposes a PlayerRef-shaped API and maps time<->frame at 60fps", () => {
    const t = makeTransport({ durationSec: 10, fps: 60, getTime: () => 2 });
    expect(t.getCurrentFrame()).toBe(120);
    expect(typeof t.play).toBe("function");
    expect(typeof t.pause).toBe("function");
    expect(typeof t.seekTo).toBe("function");
    expect(typeof t.isPlaying).toBe("function");
  });
  it("seekTo(frame) calls the seek callback with seconds", () => {
    const seek = vi.fn();
    const t = makeTransport({ durationSec: 10, fps: 60, getTime: () => 0, onSeek: seek });
    t.seekTo(180);
    expect(seek).toHaveBeenCalledWith(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pulse/__tests__/transport.test.ts`
Expected: FAIL — cannot find module `../transport`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/pulse/transport.ts
// A PlayerRef-shaped shim so the substrate Transport bar + Opt+Space work
// while the real clock is audio. Only the methods the shell calls are real.
export type TransportOpts = {
  durationSec: number;
  fps: number;
  getTime: () => number;        // returns audio currentTime in seconds
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (sec: number) => void;
  isPlaying?: () => boolean;
};

export type TransportShim = {
  getCurrentFrame: () => number;
  seekTo: (frame: number) => void;
  play: () => void;
  pause: () => void;
  isPlaying: () => boolean;
  getContainerNode: () => null;
  addEventListener: () => void;
  removeEventListener: () => void;
};

export function makeTransport(o: TransportOpts): TransportShim {
  let playing = false;
  return {
    getCurrentFrame: () => Math.round(o.getTime() * o.fps),
    seekTo: (frame: number) => o.onSeek?.(frame / o.fps),
    play: () => { playing = true; o.onPlay?.(); },
    pause: () => { playing = false; o.onPause?.(); },
    isPlaying: () => (o.isPlaying ? o.isPlaying() : playing),
    getContainerNode: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pulse/__tests__/transport.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pulse/transport.ts src/pulse/__tests__/transport.test.ts
git commit -m "feat(pulse): audio-clock transport shim"
```

---

## Task 10: WebGL2 Stage compositor

**Files:**
- Create: `src/pulse/Stage.tsx`
- Test: `src/pulse/__tests__/stage-compile.test.ts` (shader-string sanity only; full GL is verified manually in Task 15)

- [ ] **Step 1: Write the failing test**

```ts
// src/pulse/__tests__/stage-compile.test.ts
import { describe, it, expect } from "vitest";
import { buildDeckPasses } from "../Stage";
import type { Deck } from "../schema";

describe("buildDeckPasses", () => {
  it("maps deck effects to passes with frag + blend, skipping disabled/unknown", () => {
    const deck: Deck = { effects: [
      { id: "e0", type: "wave", enabled: true, locked: false, params: { amplitude: 0.2, wavelength: 0.3 }, bindings: [] },
      { id: "e1", type: "pixelate", enabled: false, locked: false, params: {}, bindings: [] },
      { id: "e2", type: "doesNotExist", enabled: true, locked: false, params: {}, bindings: [] },
    ]};
    const passes = buildDeckPasses(deck);
    expect(passes.length).toBe(1);
    expect(passes[0].type).toBe("wave");
    expect(passes[0].frag.length).toBeGreaterThan(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pulse/__tests__/stage-compile.test.ts`
Expected: FAIL — cannot find module `../Stage` or `buildDeckPasses`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/pulse/Stage.tsx
import React, { useEffect, useRef } from "react";
import { EFFECTS } from "./effects/registry";
import { resolveParam } from "./bindings";
import type { Deck } from "./schema";
import type { Analysis } from "./analysis";
import { sampleFeatures, type FeatureFrame } from "./featureBus";

export type DeckPass = { type: string; frag: string; effect: Deck["effects"][number]; descriptor: (typeof EFFECTS)[string] };

// Pure helper (unit-tested): deck -> ordered render passes.
export function buildDeckPasses(deck: Deck): DeckPass[] {
  const out: DeckPass[] = [];
  for (const e of deck.effects) {
    if (!e.enabled) continue;
    const d = EFFECTS[e.type];
    if (!d) continue;
    out.push({ type: e.type, frag: d.frag, effect: e, descriptor: d });
  }
  return out;
}

const VERT = `#version 300 es
in vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const wrap = (frag: string) =>
  frag.startsWith("#version") ? frag : `#version 300 es\n${frag.replace("gl_FragColor", "outColor").replace("texture2D", "texture")}\nout vec4 outColor;`;

type StageProps = {
  deck: Deck;
  analysis: Analysis | null;
  stemVolumes: Record<string, number>;
  getTime: () => number;
  width: number; height: number;
};

// WebGL2 ping-pong compositor. Each pass samples uPrev (previous pass output).
export const Stage: React.FC<StageProps> = ({ deck, analysis, stemVolumes, getTime, width, height }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const gl = canvas.getContext("webgl2"); if (!gl) return;
    const passes = buildDeckPasses(deck);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

    const compile = (frag: string) => {
      const vs = gl.createShader(gl.VERTEX_SHADER)!; gl.shaderSource(vs, VERT); gl.compileShader(vs);
      const fs = gl.createShader(gl.FRAGMENT_SHADER)!; gl.shaderSource(fs, wrap(frag)); gl.compileShader(fs);
      if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) console.error("[pulse] shader:", gl.getShaderInfoLog(fs));
      const p = gl.createProgram()!; gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
      return p;
    };
    const programs = passes.map((p) => compile(p.frag));

    const makeTarget = () => {
      const tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fbo };
    };
    let a = makeTarget(), b = makeTarget();

    const draw = () => {
      const time = getTime();
      const frame: FeatureFrame = analysis
        ? sampleFeatures(analysis, time)
        : { timeSec: time, tempoPhase: 0, master: { level: 0, bandLow: 0, bandMid: 0, bandHigh: 0, brightness: 0, flux: 0 }, stems: {} };

      gl.viewport(0, 0, width, height);
      // seed: clear a to black
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo); gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);

      passes.forEach((pass, i) => {
        const prog = programs[i]; gl.useProgram(prog);
        const loc = gl.getAttribLocation(prog, "aPos");
        gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        // resolve params
        const resolved: Record<string, number> = {};
        const vol = pass.effect.bindings.length ? (stemVolumes[pass.effect.bindings[0].source.stem] ?? 1) : 1;
        for (const spec of pass.descriptor.params) {
          const base = pass.effect.params[spec.name] ?? spec.default;
          resolved[spec.name] = resolveParam(base, pass.effect.bindings, spec.name, frame, vol);
        }
        const uniforms = pass.descriptor.uniforms(resolved, frame);
        gl.uniform2f(gl.getUniformLocation(prog, "uRes"), width, height);
        for (const [name, val] of Object.entries(uniforms)) {
          const ul = gl.getUniformLocation(prog, name); if (ul == null) continue;
          if (Array.isArray(val)) { if (val.length === 2) gl.uniform2f(ul, val[0], val[1]); }
          else gl.uniform1f(ul, val);
        }
        // bind previous output as uPrev
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a.tex);
        gl.uniform1i(gl.getUniformLocation(prog, "uPrev"), 0);
        // render into b
        gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        [a, b] = [b, a]; // ping-pong
      });

      // blit final (a) to screen
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, a.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0,0,width,height, 0,0,width,height, gl.COLOR_BUFFER_BIT, gl.NEAREST);

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [deck, analysis, stemVolumes, getTime, width, height]);

  return <canvas ref={ref} width={width} height={height} style={{ width: "100%", height: "100%", display: "block", background: "#000" }} />;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pulse/__tests__/stage-compile.test.ts`
Expected: PASS (1 test). (Only `buildDeckPasses` is exercised in jsdom; real GL is verified in Task 15.)

- [ ] **Step 5: Commit**

```bash
git add src/pulse/Stage.tsx src/pulse/__tests__/stage-compile.test.ts
git commit -m "feat(pulse): WebGL2 ping-pong deck compositor"
```

---

## Task 11: Rust — MusicCanvas + seed + per-app canvas resolution

**Files:**
- Create: `src-tauri/templates/seed-pulse.json`
- Create: `src-tauri/src/canvases/music.rs`
- Modify: `src-tauri/src/canvases/mod.rs`
- Modify: `src-tauri/src/canvas.rs`
- Create: `src-tauri/skills/pulse/SKILL.md`

- [ ] **Step 1: Write the seed + skill stub**

`src-tauri/templates/seed-pulse.json`:
```json
{
  "version": 1,
  "song": { "sourceFolder": "", "durationSec": 0, "tempoBpm": 0 },
  "stems": [],
  "decks": { "A": { "effects": [] }, "B": { "effects": [] } },
  "mix": { "active": "A", "template": "crossfade", "durationSec": 4, "curve": "ease", "progress": 0 }
}
```

`src-tauri/skills/pulse/SKILL.md`:
```markdown
---
name: pulse
description: Routing skill for the Pulse music visualizer canvas.
---

# Pulse

`project.json` is the source of truth for stems, effect stacks, bindings, and
mix state. Never edit `analysis.json` (it is the immutable analyzed timeline).

To add a NEW visual behavior, edit/create a shader under
`src/pulse/effects/<name>/` and register it in `src/pulse/effects/registry.ts`.
Vite HMR hot-reloads it live.

Preserve any binding marked `"locked": true`. Author next-visual changes in
deck `B`; the user releases B to the live stage A via the Mix panel.
```

- [ ] **Step 2: Implement MusicCanvas**

`src-tauri/src/canvases/music.rs`:
```rust
//! The music-visualizer canvas (Pulse).
use crate::skill::SkillBundle;
use once_cell::sync::Lazy;

pub static BUNDLE: Lazy<SkillBundle> = Lazy::new(|| SkillBundle {
    canvas_id: "pulse",
    files: vec![("SKILL.md", include_str!("../../skills/pulse/SKILL.md").to_string())],
    claude_md: String::new(),
});
```

> Check the exact `SkillBundle` field names/types in `src-tauri/src/skill.rs` and match them (the kinetic bundle in `src-tauri/src/canvases/kinetic.rs` is the reference). Adjust the struct literal above to match.

`src-tauri/src/canvases/mod.rs` — add:
```rust
pub mod music;
```

`src-tauri/src/canvas.rs` — add the struct + extend `active()` to resolve by id:
```rust
/// The music-visualizer canvas (Pulse).
pub struct MusicCanvas;

impl Canvas for MusicCanvas {
    fn id(&self) -> &'static str { "pulse" }
    fn doc_filename(&self) -> &'static str { "project.json" }
    fn seed_bytes(&self) -> &'static [u8] { include_bytes!("../templates/seed-pulse.json") }
    fn summarise(&self, project_dir: &std::path::Path) -> ProjectSummary {
        let count = std::fs::read_to_string(project_dir.join(self.doc_filename()))
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v.get("stems").and_then(|b| b.as_array()).map(|a| a.len()))
            .unwrap_or(0);
        ProjectSummary { count }
    }
    fn skill_bundle(&self) -> &'static crate::skill::SkillBundle {
        &crate::canvases::music::BUNDLE
    }
}

/// Resolve the active canvas by id. Falls back to kinetic.
pub fn active_by_id(id: &str) -> &'static dyn Canvas {
    match id {
        "pulse" => &MusicCanvas,
        _ => &KineticCanvas,
    }
}
```

> Keep the existing `active()` returning `&KineticCanvas` for back-compat; callers that know the app id should switch to `active_by_id`. For this slice, projects created under the pulse app must persist their canvas id — write `.pulse/canvas` = `"pulse"` at create time and have the doc/watch path read it. If that wiring is larger than expected, a pragmatic v1 shortcut: gate on the presence of `project.json` vs `story.json` in the project dir. Document whichever you choose in the commit message.

- [ ] **Step 3: Build to verify it compiles**

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20`
Expected: builds (warnings ok). If `once_cell` isn't a dep, mirror however `kinetic.rs` declares its `BUNDLE` (it may use `std::sync::OnceLock` or a `const`); match that pattern instead of adding a dependency.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/templates/seed-pulse.json src-tauri/src/canvases/music.rs src-tauri/src/canvases/mod.rs src-tauri/src/canvas.rs src-tauri/skills/pulse/SKILL.md
git commit -m "feat(pulse): Rust MusicCanvas + seed + skill stub + per-id resolver"
```

---

## Task 12: Rust — `pulse_import` (ffmpeg normalize + progress)

**Files:**
- Create: `src-tauri/src/pulse.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Implement the import command**

`src-tauri/src/pulse.rs`:
```rust
//! Pulse stem import: normalize a user-picked folder of audio files into
//! the project's stems/ dir as 48kHz stereo WAV using the system ffmpeg.
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

#[derive(serde::Serialize, Clone)]
pub struct ImportedStem { pub id: String, pub file: String, pub source_name: String }

#[derive(serde::Serialize, Clone)]
struct Progress { index: usize, total: usize, name: String }

#[tauri::command]
pub async fn pulse_import(app: AppHandle, project_path: String, folder: String) -> Result<Vec<ImportedStem>, String> {
    let src = PathBuf::from(&folder);
    let stems_dir = PathBuf::from(&project_path).join("stems");
    std::fs::create_dir_all(&stems_dir).map_err(|e| e.to_string())?;

    let mut entries: Vec<PathBuf> = std::fs::read_dir(&src).map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| matches!(p.extension().and_then(|x| x.to_str()).map(|s| s.to_lowercase()).as_deref(),
            Some("wav" | "mp3" | "aiff" | "aif" | "flac" | "m4a" | "ogg")))
        .collect();
    entries.sort();
    let total = entries.len();
    if total == 0 { return Err("No audio files found in folder".into()); }

    let mut out = Vec::new();
    for (i, path) in entries.iter().enumerate() {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("stem").to_string();
        let _ = app.emit("pulse://import-progress", Progress { index: i, total, name: name.clone() });
        let id = format!("stem-{:02}", i);
        let out_file = format!("{id}.wav");
        let out_path = stems_dir.join(&out_file);
        let status = std::process::Command::new("ffmpeg")
            .args(["-y", "-i"]).arg(path)
            .args(["-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le"])
            .arg(&out_path)
            .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
            .status().map_err(|e| format!("ffmpeg failed to launch: {e}"))?;
        if !status.success() { return Err(format!("ffmpeg failed on {name}")); }
        out.push(ImportedStem { id, file: out_file, source_name: name });
    }
    let _ = app.emit("pulse://import-progress", Progress { index: total, total, name: "done".into() });
    Ok(out)
}
```

`src-tauri/src/lib.rs` — register:
```rust
// near other `mod` declarations:
mod pulse;
// in the invoke_handler list, add:
//   pulse::pulse_import,
```

> Match the exact `tauri::generate_handler![...]` macro list formatting already in `lib.rs`. Add `pulse::pulse_import` to it.

- [ ] **Step 2: Build to verify it compiles**

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20`
Expected: builds.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/pulse.rs src-tauri/src/lib.rs
git commit -m "feat(pulse): pulse_import ffmpeg normalize command"
```

---

## Task 13: Frontend canvas plugin + per-app resolver + app manifest

**Files:**
- Create: `editor/canvases/music/index.tsx`
- Create: `editor/canvases/music/Renderer.tsx`
- Create: `editor/canvases/music/Inspector.tsx`
- Modify: `editor/canvas.ts`
- Modify: `editor/platform/apps.ts`

- [ ] **Step 1: Resolver + plugin**

`editor/canvas.ts` — replace the hardcoded const with a resolver (keep `activeCanvas` as the kinetic default for existing imports):
```ts
import { kineticCanvas } from "./canvases/kinetic";
import { musicCanvas } from "./canvases/music";

export const activeCanvas: CanvasPlugin<unknown> =
  kineticCanvas as CanvasPlugin<unknown>;

export function resolveCanvas(appId: string): CanvasPlugin<unknown> {
  if (appId === "pulse") return musicCanvas as CanvasPlugin<unknown>;
  return kineticCanvas as CanvasPlugin<unknown>;
}
```

`editor/canvases/music/Inspector.tsx` (minimal — full mixer is the follow-up plan):
```tsx
import React from "react";
import type { CanvasInspectorProps } from "../../canvas";
import type { PulseProject } from "../../../src/pulse/schema";

export const Inspector: React.FC<CanvasInspectorProps<PulseProject>> = ({ doc, onChange }) => (
  <div style={{ padding: 12, fontSize: 12, color: "#aaa", overflow: "auto" }}>
    <div style={{ fontWeight: 600, color: "#ddd", marginBottom: 8 }}>Stems</div>
    {doc.stems.length === 0 && <div>No stems imported yet.</div>}
    {doc.stems.map((s, i) => (
      <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ width: 70 }}>{s.role}</span>
        <span style={{ flex: 1, color: "#ccc" }}>{s.label}</span>
        <input type="range" min={0} max={1} step={0.01} value={s.volume}
          onChange={(e) => {
            const v = Number(e.target.value);
            onChange((prev) => ({ ...prev, stems: prev.stems.map((x, j) => j === i ? { ...x, volume: v } : x) }));
          }} />
      </div>
    ))}
  </div>
);
```

`editor/canvases/music/Renderer.tsx`:
```tsx
import React, { useMemo, useRef } from "react";
import type { CanvasRendererProps } from "../../canvas";
import type { PulseProject } from "../../../src/pulse/schema";
import { Stage } from "../../../src/pulse/Stage";
import type { Analysis } from "../../../src/pulse/analysis";

// For this slice, the Renderer plays stem-00 via one <audio> element as the
// clock and renders Deck A. (Per-stem gain graph + multi-window come in the
// follow-up plan.) analysis is loaded by PulseApp and passed via window-level
// context; here we read it from a ref set on the doc by import (kept simple:
// the analysis is loaded alongside the doc and handed in through props.doc as
// a non-persisted field is NOT allowed — instead PulseApp loads analysis and
// stores it on a module ref). See PulseApp wiring in Task 14.
export const Renderer: React.FC<CanvasRendererProps<PulseProject> & { analysis?: Analysis | null; audioSrc?: string }> = (props) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const stemVolumes = useMemo(() => Object.fromEntries(props.doc.stems.map((s) => [s.id, s.muted ? 0 : s.volume])), [props.doc.stems]);
  const getTime = () => audioRef.current?.currentTime ?? 0;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#000" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Stage deck={props.doc.decks.A} analysis={props.analysis ?? null} stemVolumes={stemVolumes} getTime={getTime} width={960} height={540} />
      </div>
      {props.audioSrc && <audio ref={audioRef} src={props.audioSrc} controls style={{ width: "100%" }} />}
    </div>
  );
};
```

`editor/canvases/music/index.tsx`:
```tsx
import React from "react";
import { pulseProjectSchema, type PulseProject } from "../../../src/pulse/schema";
import type { CanvasPlugin, ConflictResolution } from "../../canvas";
import type { Selection } from "../../selection";
import { Renderer } from "./Renderer";
import { Inspector } from "./Inspector";

export const musicCanvas: CanvasPlugin<PulseProject> = {
  id: "pulse",
  docFilename: "project.json",
  parse: (raw) => pulseProjectSchema.parse(raw),
  durationInFrames: (doc, fps) => Math.max(1, Math.round((doc.song.durationSec || 0) * fps)),
  resolveConflict: (_saved, agent, _user): ConflictResolution<PulseProject> => ({ merged: agent, prompt: "" }),
  pruneSelection: (_doc, sel) => sel as Selection,
  Renderer: Renderer as CanvasPlugin<PulseProject>["Renderer"],
  Inspector,
  Timeline: null,
};
```

> `resolveConflict` here is last-write-wins (agent wins) for the slice; the real three-way merge (preserve user volume edits vs agent binding edits) is in the follow-up plan. Note this in the commit.

- [ ] **Step 2: Register the app manifest**

`editor/platform/apps.ts` — replace the `tonebench` entry (the `coming-soon` object starting at line ~115) with:
```ts
  {
    id: "pulse",
    name: "Pulse",
    blurb: "Agent-native music visualizer",
    description:
      "Pick a folder of stems; Pulse analyzes each into a live timeline and drives GPU shader effects from the music. Bind stems to visuals, author the next look with the agent, and crossfade it onto a fullscreen stage.",
    creator: "altramanera",
    version: "0.1.0",
    tokens: 0,
    files: 30,
    loc: 2200,
    rating: 0,
    ratingCount: 0,
    tags: ["music", "visualizer", "agent-native"],
    hue: 142,
    status: "available",
    Root: PulseApp,
    releasedAt: "2026-06-15",
    sizeBytes: 3_000_000,
    category: "audio",
  },
```
And add the import at the top of `apps.ts`:
```ts
import { PulseApp } from "../canvases/music/PulseApp";
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i pulse | head` (expect no pulse errors once Task 14 lands PulseApp; this step may report the missing `PulseApp` import until Task 14 — that's expected and resolved next task).

- [ ] **Step 4: Commit**

```bash
git add editor/canvas.ts editor/canvases/music/index.tsx editor/canvases/music/Renderer.tsx editor/canvases/music/Inspector.tsx editor/platform/apps.ts
git commit -m "feat(pulse): canvas plugin + resolver + app manifest entry"
```

---

## Task 14: PulseApp Root (project lifecycle + import + analysis wiring)

**Files:**
- Create: `editor/canvases/music/PulseApp.tsx`
- Create: `editor/canvases/music/import.ts`

- [ ] **Step 1: Import/analysis driver**

`editor/canvases/music/import.ts`:
```ts
import { analyzeChannel, type Analysis } from "../../../src/pulse/analysis";

const HOP = 1 / 60;

// Decode a normalized stem WAV via Web Audio and analyze its mono mix.
async function analyzeStem(audioCtx: AudioContext, url: string, id: string, file: string) {
  const buf = await fetch(url).then((r) => r.arrayBuffer());
  const decoded = await audioCtx.decodeAudioData(buf);
  // Mono mix.
  const ch0 = decoded.getChannelData(0);
  const mono = new Float32Array(ch0.length);
  const n = decoded.numberOfChannels;
  for (let c = 0; c < n; c++) { const d = decoded.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / n; }
  const res = analyzeChannel(mono, decoded.sampleRate, HOP);
  return { id, file, durationSec: decoded.duration, sampleRate: decoded.sampleRate, ...res };
}

export async function runAnalysis(
  convert: (p: string) => string,
  projectPath: string,
  imported: { id: string; file: string; source_name: string }[],
): Promise<{ analysis: Analysis; firstAudioUrl: string }> {
  const audioCtx = new AudioContext();
  const stems = [];
  let durationSec = 0;
  for (const im of imported) {
    const url = convert(`${projectPath}/stems/${im.file}`);
    const a = await analyzeStem(audioCtx, url, im.id, im.file);
    durationSec = Math.max(durationSec, a.durationSec);
    stems.push({
      id: a.id, file: a.file, role: a.role, roleConfidence: a.roleConfidence,
      level: a.level, bandLow: a.bandLow, bandMid: a.bandMid, bandHigh: a.bandHigh,
      brightness: a.brightness, flux: a.flux, onsets: a.onsets,
    });
  }
  const analysis: Analysis = {
    version: 1, sampleRate: 48000, hopSec: HOP, durationSec, tempoBpm: 0, beatTimesSec: [], stems,
  };
  await audioCtx.close();
  return { analysis, firstAudioUrl: convert(`${projectPath}/stems/${imported[0].file}`) };
}
```

- [ ] **Step 2: PulseApp**

`editor/canvases/music/PulseApp.tsx`:
```tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "../../runtime";
import { Terminal } from "../../terminal";
import { musicCanvas } from "./index";
import { seedProject, type PulseProject } from "../../../src/pulse/schema";
import type { Analysis } from "../../../src/pulse/analysis";
import { runAnalysis } from "./import";
import { Renderer } from "./Renderer";
import { Inspector } from "./Inspector";

type ProjectMeta = { name: string; path: string };

const PulseEditor: React.FC<{ project: ProjectMeta }> = ({ project }) => {
  const [doc, setDoc] = useState<PulseProject | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | undefined>();
  const [status, setStatus] = useState<string>("");
  const savedRef = useRef("");

  // Load existing project.json + analysis.json if present.
  useEffect(() => {
    void (async () => {
      if (!isTauri()) { setDoc(seedProject("(browser)")); return; }
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        const text = await invoke<string>("load_doc");
        const parsed = musicCanvas.parse(JSON.parse(text)) as PulseProject;
        setDoc(parsed); savedRef.current = JSON.stringify(parsed);
        const { convertFileSrc } = await import("@tauri-apps/api/core");
        // best-effort load analysis.json
        try {
          const ares = await fetch(convertFileSrc(`${project.path}/analysis.json`));
          if (ares.ok) setAnalysis(await ares.json());
        } catch { /* none yet */ }
        if (parsed.stems[0]) setAudioSrc(convertFileSrc(`${project.path}/stems/${parsed.stems[0].file}`));
      } catch { setDoc(seedProject("")); }
    })();
  }, [project.path]);

  // Autosave project.json.
  useEffect(() => {
    if (!doc || !isTauri()) return;
    const flat = JSON.stringify(doc);
    if (flat === savedRef.current) return;
    const t = setTimeout(async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_doc", { json: JSON.stringify(doc, null, 2) });
      savedRef.current = flat;
    }, 400);
    return () => clearTimeout(t);
  }, [doc]);

  const pickAndImport = useCallback(async () => {
    if (!isTauri()) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const folder = await open({ directory: true, title: "Choose a folder of stems" });
    if (!folder || typeof folder !== "string") return;
    const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
    setStatus("Importing stems…");
    const imported = await invoke<{ id: string; file: string; source_name: string }[]>(
      "pulse_import", { projectPath: project.path, folder });
    setStatus("Analyzing…");
    const { analysis, firstAudioUrl } = await runAnalysis((p) => convertFileSrc(p), project.path, imported);
    // write analysis.json
    await invoke("save_named", { name: "analysis.json", json: JSON.stringify(analysis) }).catch(async () => {
      // fallback: write via a generic command if save_named doesn't exist — see note.
    });
    // seed doc stems
    setDoc((prev) => {
      const base = prev ?? seedProject(folder);
      return {
        ...base,
        song: { ...base.song, sourceFolder: folder, durationSec: analysis.durationSec },
        stems: analysis.stems.map((s) => ({ id: s.id, file: s.file, label: imported.find((i) => i.id === s.id)?.source_name ?? s.id, role: s.role, volume: 1, muted: false })),
        decks: {
          A: { effects: [
            { id: "fx-wave", type: "wave", enabled: true, locked: false, params: { amplitude: 0.15, wavelength: 0.2 }, bindings: [{ param: "amplitude", source: { stem: "master", feature: "level" }, amount: 0.3, curve: "linear", offset: 0 }] },
            { id: "fx-px", type: "pixelate", enabled: true, locked: false, params: { pixelSize: 12, falloff: 0.3 }, bindings: [{ param: "pixelSize", source: { stem: analysis.stems[0]?.id ?? "master", feature: "bandLow" }, amount: 30, curve: "linear", offset: 0 }] },
          ] },
          B: { effects: [] },
        },
      };
    });
    setAnalysis(analysis);
    setAudioSrc(convertFileSrc(`${project.path}/stems/${imported[0].file}`));
    setStatus("");
  }, [project.path]);

  if (!doc) return <div style={{ padding: 40, color: "#888" }}>Loading…</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr 300px", height: "100%", background: "#000" }}>
      <div style={{ borderRight: "1px solid #222", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ padding: 8, borderBottom: "1px solid #222" }}>
          <button onClick={pickAndImport} style={{ width: "100%", padding: 8 }}>Import stems folder…</button>
          {status && <div style={{ marginTop: 6, fontSize: 12, color: "#9ad" }}>{status}</div>}
        </div>
        <div style={{ flex: 1, minHeight: 0 }}><Terminal /></div>
      </div>
      <div style={{ minWidth: 0 }}>
        <Renderer doc={doc} analysis={analysis} audioSrc={audioSrc}
          durationInFrames={Math.round(doc.song.durationSec * 60)} fps={60}
          playerRef={{ current: null }} selection={{ kind: "story" } as any} onChange={setDoc} loop />
      </div>
      <div style={{ borderLeft: "1px solid #222", minHeight: 0 }}>
        <Inspector doc={doc} selection={{ kind: "story" } as any} onSelect={() => {}} onChange={setDoc} />
      </div>
    </div>
  );
};

export const PulseApp: React.FC<{ onExit: () => void }> = () => {
  const [project, setProject] = useState<ProjectMeta | null>(null);
  useEffect(() => {
    if (!isTauri()) { setProject({ name: "Browser", path: "(browser)" }); return; }
    let off: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const un = await listen<ProjectMeta>("project://opened", (e) => setProject(e.payload));
      off = () => un();
    })();
    return () => { if (off) off(); };
  }, []);
  if (!project) {
    // For the slice, auto-create/open a single pulse project via existing commands.
    return <PulseBootstrap onReady={setProject} />;
  }
  return <PulseEditor key={project.path} project={project} />;
};

const PulseBootstrap: React.FC<{ onReady: (m: ProjectMeta) => void }> = ({ onReady }) => {
  useEffect(() => {
    void (async () => {
      if (!isTauri()) return;
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        const list = await invoke<ProjectMeta[]>("projects_list").catch(() => [] as ProjectMeta[]);
        const existing = Array.isArray(list) ? list.find((p) => p.path) : null;
        const meta = existing ?? await invoke<ProjectMeta>("projects_create", { name: "Pulse Session" });
        await invoke("project_open", { path: meta.path }).catch(() => {});
        onReady(meta);
      } catch { /* surfaced via Loading */ }
    })();
  }, [onReady]);
  return <div style={{ padding: 40, color: "#888" }}>Opening Pulse session…</div>;
};
```

> **Two integration unknowns to resolve against the real backend while implementing (do not guess — read the files):**
> 1. **Writing `analysis.json`.** `save_doc` writes the *canvas docFilename* (`project.json`). Check `src-tauri/src/doc.rs` for a generic "write arbitrary project file" command. If none exists, add a tiny `pulse_write_analysis(project_path, json)` command in `pulse.rs` (mirror `save_doc`'s tmp+rename) and call that instead of the `save_named` placeholder above.
> 2. **Project create/open command names.** Verify the exact command names + arg casing in `src-tauri/src/projects.rs` (`projects_create`, `projects_list`, `project_open`/`project_close`) and how kinetic's `ProjectsView.tsx` calls them; match exactly. The `project://opened` event is emitted by `projects.rs` — confirm payload shape.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "pulse|canvases/music" | head -30`
Expected: resolve all pulse type errors (fix casts/props until clean).

- [ ] **Step 3: Commit**

```bash
git add editor/canvases/music/PulseApp.tsx editor/canvases/music/import.ts
git commit -m "feat(pulse): PulseApp root — import, analyze, render Deck A"
```

---

## Task 15: Wire backend file-write for analysis + asset scope + manual E2E

**Files:**
- Modify: `src-tauri/src/pulse.rs` (add `pulse_write_analysis` if needed)
- Modify: `src-tauri/src/lib.rs` (register it)
- Modify: `tauri.conf.json` (asset scope)

- [ ] **Step 1: Add the analysis writer (if no generic writer exists)**

Append to `src-tauri/src/pulse.rs`:
```rust
#[tauri::command]
pub fn pulse_write_analysis(project_path: String, json: String) -> Result<(), String> {
    let dir = std::path::PathBuf::from(&project_path);
    let tmp = dir.join("analysis.json.tmp");
    let dst = dir.join("analysis.json");
    std::fs::write(&tmp, json.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &dst).map_err(|e| e.to_string())?;
    Ok(())
}
```
Register `pulse::pulse_write_analysis` in `lib.rs`'s handler list, and replace the `save_named` placeholder call in `import.ts`/`PulseApp.tsx` with:
```ts
await invoke("pulse_write_analysis", { projectPath: project.path, json: JSON.stringify(analysis) });
```

- [ ] **Step 2: Extend asset scope**

`tauri.conf.json` — add to `assetProtocol.scope` array:
```json
"$HOME/KineticStudio/**/stems/**",
"$HOME/KineticStudio/**/analysis.json"
```

- [ ] **Step 3: Build + run the app**

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5`
Then launch per the project's dev-server gotcha (read the output file; do NOT spawn a wait-loop that SIGTERMs the server — see `project_devserver_restart_gotcha` memory):
Run: `npm run tauri:dev` (foreground, or per the documented launch pattern).

- [ ] **Step 4: Manual E2E verification (the real proof)**

1. Open the app → The Square → click **Pulse**.
2. Click **Import stems folder…**, choose
   `/Users/parandykt/Apps/VisualMachines/Song tune (Cover) Stems`.
3. Confirm: progress shows 6 stems; after analysis the right panel lists 6
   stems with classified roles (NOT necessarily matching the filenames) and
   volume sliders.
4. Press play on the audio element. Confirm the WebGL canvas animates and
   visibly reacts to the music (pixelate size pulses with low-band energy;
   wave amplitude tracks level).
5. Drag a stem volume slider down → its visual contribution shrinks.
6. Confirm `~/KineticStudio/<slug>/project.json` and `analysis.json` exist on
   disk and `analysis.json` has 6 stems with per-frame arrays.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pulse.rs src-tauri/src/lib.rs tauri.conf.json editor/canvases/music/import.ts editor/canvases/music/PulseApp.tsx
git commit -m "feat(pulse): analysis.json writer + asset scope; vertical slice runs E2E"
```

---

## Self-Review (completed)

**Spec coverage (slice scope = build-steps 1–3):**
- App registers + opens from The Square → Tasks 11, 13, 14. ✓
- Stem import, format-agnostic, name-agnostic classification → Tasks 4, 12, 14. ✓
- Analysis timeline persisted to disk + live in memory → Tasks 5, 14, 15. ✓
- Audio drives GPU shader effects (wave, animated noise, pixel size + falloff) → Tasks 7, 8, 10. ✓
- Stem volume scales visual amplitude → Task 7 (`resolveParam` × volume), Task 13 (Inspector slider), Task 10 (Stage uses stemVolumes). ✓
- Substrate reuse (terminal, doc save/watch, projects) → Tasks 11–15. ✓

**Deferred to follow-up plan (explicitly out of this slice, in spec §15 steps 4–8):** full stem mixer UI, waveform/beat timeline, second fullscreen window on monitor 2, Deck B preview + release + git branch/merge, transition templates + Mix panel, remaining 7 effects, full skill bundle, three-way `resolveConflict`. These are noted where they touch a task (Tasks 11, 13).

**Placeholder scan:** no TBD/TODO. Two explicit "read the real backend, don't guess" notes (analysis writer command, project command names) are integration verifications with concrete fallbacks provided — not placeholders.

**Type consistency:** `PulseProject`, `Analysis`, `FeatureFrame`, `EffectDescriptor`, `Binding`, `resolveParam`, `buildDeckPasses`, `makeTransport`, `analyzeChannel`, `sampleFeatures`, `classifyStem` names are used identically across tasks. `pulse_import` / `pulse_write_analysis` command names match between Rust and TS call sites.
