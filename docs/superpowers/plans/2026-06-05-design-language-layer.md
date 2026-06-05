# Design-Language Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a descriptive design-language layer — mood dials + a word lexicon (with agent fallback) + presets/snapshots — over a pure-function fanout core, so users control color/radius/spacing across the app with high-level words instead of individual tokens.

**Architecture:** Approach A — a framework-free pure core in `editor/design-language/` (`dials`, `lexicon`, `fanout`, `apply`, `snapshots`, `agent`). The fanout `resolve(dialState, base) → TokenMap` is a pure function driven identically by dial drags, lexicon words, and agent output. A new "Language" tab inside the existing `editor/DevControlSurface.tsx` is a thin caller; the existing per-token pickers become a "Tokens" tab. Phase 1 wires color + radius + the global Tailwind v4 `--spacing` multiplier (the already-bindable tiers).

**Tech Stack:** TypeScript, React 19, Tailwind v4 (`--spacing` multiplier + `@theme inline` vars), Vitest + Testing Library (jsdom), the existing Vite dev-server plugin in `vite.editor.config.ts`.

---

## File Structure

```
editor/design-language/
  types.ts        DialState, DialAxis, TokenMap, Delta types
  color.ts        hexToHsl / hslToHex / shiftHue / shiftLightness / shiftSaturation (pure)
  dials.ts        DIAL_AXES, PRESETS, emptyState(), clampState(), mergeDeltas()
  fanout.ts       BASE_TOKENS, resolve(state, base?) → TokenMap   ← pure core
  lexicon.ts      LEXICON, parsePhrase(text) → {deltas, unknownWords}
  apply.ts        applyTokens(map), resetTokens(), toPatch(map) → {cssVars, themeTs, notReached}
  snapshots.ts    SnapshotStore class (in-session Map<name, DialState>)
  agent.ts        proposeDeltas(phrase, state) → Delta | null  (single-shot; disabled if no transport)
  index.ts        re-exports the public surface
  __tests__/      color.test.ts, fanout.test.ts, lexicon.test.ts, apply.test.ts, dials.test.ts

editor/DesignLanguagePanel.tsx   the "Language" tab UI (dials, phrase box, presets, snapshots, apply)
editor/DevControlSurface.tsx     MODIFY: add tab switch (Language | Tokens)
vite.editor.config.ts            MODIFY: add dev-only POST /__apply-tokens endpoint
design-spec/language.yaml        vocabulary documentation (axes, presets, lexicon words)
```

**Correspondence table (CSS var → theme.ts color path), used by `toPatch`** — fixed and reviewed; theme.ts keys with no clean CSS-var source are left untouched and reported as `notReached`:

| CSS var | theme.ts path |
|---|---|
| `--background` | `bg.canvas` |
| `--card` | `bg.surface` |
| `--popover` | `bg.raised` |
| `--muted` | `bg.hover` |
| `--secondary` / `--accent` | `bg.selected` |
| `--border` / `--input` | `border.line` |
| `--foreground` | `text.primary` |
| `--muted-foreground` | `text.muted` |
| `--ring` | `accent.focus` |

`notReached` (no clean source): `border.faint`, `border.strong`, `border.hover`, `text.secondary`, `text.dim`, `text.faint`, `accent.dot`, all of `danger.*`.

---

## Task 1: Pure color math

**Files:**
- Create: `editor/design-language/color.ts`
- Test: `editor/design-language/__tests__/color.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// editor/design-language/__tests__/color.test.ts
import { describe, it, expect } from "vitest";
import { hexToHsl, hslToHex, shiftHue, shiftLightness, shiftSaturation } from "../color";

describe("color math (pure HSL transforms)", () => {
  it("round-trips hex -> hsl -> hex", () => {
    expect(hslToHex(hexToHsl("#242427"))).toBe("#242427");
  });
  it("parses and reserializes pure white/black", () => {
    expect(hslToHex(hexToHsl("#ffffff"))).toBe("#ffffff");
    expect(hslToHex(hexToHsl("#000000"))).toBe("#000000");
  });
  it("shiftLightness raises L (brighter) and clamps at 100", () => {
    const darker = hexToHsl("#242427");
    expect(shiftLightness(darker, 10).l).toBeGreaterThan(darker.l);
    expect(shiftLightness(hexToHsl("#ffffff"), 10).l).toBe(100);
  });
  it("shiftSaturation raises S and clamps 0..100", () => {
    const c = hexToHsl("#f87171");
    expect(shiftSaturation(c, 10).s).toBeGreaterThanOrEqual(c.s);
    expect(shiftSaturation(c, -999).s).toBe(0);
  });
  it("shiftHue wraps modulo 360", () => {
    expect(shiftHue({ h: 350, s: 50, l: 50 }, 20).h).toBeCloseTo(10, 5);
  });
  it("near-grey has near-zero saturation (caveat from spec)", () => {
    expect(hexToHsl("#0a0a0a").s).toBeLessThan(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run editor/design-language/__tests__/color.test.ts`
Expected: FAIL — cannot find module `../color`.

- [ ] **Step 3: Write minimal implementation**

```ts
// editor/design-language/color.ts
/** Pure HSL color math. No DOM, no deps. h in [0,360), s/l in [0,100]. */
export type Hsl = { h: number; s: number; l: number };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function hexToHsl(hex: string): Hsl {
  const m = hex.trim().replace(/^#/, "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = ln - c / 2;
  const to255 = (v: number) => Math.round((v + m) * 255);
  const hx = (v: number) => to255(v).toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

export const shiftHue = (c: Hsl, deg: number): Hsl => ({ ...c, h: (((c.h + deg) % 360) + 360) % 360 });
export const shiftLightness = (c: Hsl, d: number): Hsl => ({ ...c, l: clamp(c.l + d, 0, 100) });
export const shiftSaturation = (c: Hsl, d: number): Hsl => ({ ...c, s: clamp(c.s + d, 0, 100) });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run editor/design-language/__tests__/color.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add editor/design-language/color.ts editor/design-language/__tests__/color.test.ts
git commit -m "feat(design-language): pure HSL color math"
```

---

## Task 2: Types + dial axes, presets, state helpers

**Files:**
- Create: `editor/design-language/types.ts`
- Create: `editor/design-language/dials.ts`
- Test: `editor/design-language/__tests__/dials.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// editor/design-language/__tests__/dials.test.ts
import { describe, it, expect } from "vitest";
import { DIAL_AXES, PRESETS, emptyState, clampState, mergeDeltas } from "../dials";

describe("dials", () => {
  it("defines exactly the 6 spec axes", () => {
    expect(DIAL_AXES.map((a) => a.key).sort()).toEqual(
      ["character", "contrast", "density", "softness", "temperature", "weight"],
    );
  });
  it("emptyState is all-zero for every axis", () => {
    const s = emptyState();
    expect(Object.values(s).every((v) => v === 0)).toBe(true);
    expect(Object.keys(s).length).toBe(6);
  });
  it("clampState bounds each axis to -3..+3", () => {
    expect(clampState({ ...emptyState(), temperature: 9 }).temperature).toBe(3);
    expect(clampState({ ...emptyState(), density: -9 }).density).toBe(-3);
  });
  it("mergeDeltas sums then clamps", () => {
    const s = mergeDeltas(emptyState(), [{ temperature: 2 }, { temperature: 2, density: 1 }]);
    expect(s.temperature).toBe(3); // 2+2 clamped
    expect(s.density).toBe(1);
  });
  it("every preset is a valid dial state", () => {
    for (const name of Object.keys(PRESETS)) {
      const s = PRESETS[name];
      expect(Object.keys(s).length).toBe(6);
      expect(Object.values(s).every((v) => v >= -3 && v <= 3)).toBe(true);
    }
    expect(PRESETS.default).toEqual(emptyState());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run editor/design-language/__tests__/dials.test.ts`
Expected: FAIL — cannot find module `../dials`.

- [ ] **Step 3: Write minimal implementation**

```ts
// editor/design-language/types.ts
export type AxisKey =
  | "temperature" | "contrast" | "density" | "softness" | "character" | "weight";
export type DialState = Record<AxisKey, number>; // each -3..+3
export type Delta = Partial<DialState>;
/** Resolved output: CSS custom property name -> value string. */
export type TokenMap = Record<string, string>;
export type DialAxis = {
  key: AxisKey;
  label: string;
  minLabel: string; // e.g. "cooler"
  maxLabel: string; // e.g. "warmer"
};
```

```ts
// editor/design-language/dials.ts
import type { AxisKey, DialAxis, DialState, Delta } from "./types";

export const DIAL_AXES: DialAxis[] = [
  { key: "temperature", label: "Temperature", minLabel: "cooler", maxLabel: "warmer" },
  { key: "contrast", label: "Contrast", minLabel: "hushed", maxLabel: "punchy" },
  { key: "density", label: "Density", minLabel: "airy", maxLabel: "packed" },
  { key: "softness", label: "Softness", minLabel: "sharp", maxLabel: "rounded" },
  { key: "character", label: "Character", minLabel: "neutral", maxLabel: "expressive" },
  { key: "weight", label: "Weight", minLabel: "light", maxLabel: "bold" },
];

const KEYS = DIAL_AXES.map((a) => a.key) as AxisKey[];
const clamp3 = (n: number) => Math.min(3, Math.max(-3, Math.round(n)));

export const emptyState = (): DialState =>
  KEYS.reduce((s, k) => ((s[k] = 0), s), {} as DialState);

export const clampState = (s: DialState): DialState =>
  KEYS.reduce((o, k) => ((o[k] = clamp3(s[k] ?? 0)), o), {} as DialState);

export const mergeDeltas = (base: DialState, deltas: Delta[]): DialState => {
  const out = { ...base };
  for (const d of deltas) for (const k of KEYS) out[k] = (out[k] ?? 0) + (d[k] ?? 0);
  return clampState(out);
};

export const PRESETS: Record<string, DialState> = {
  default: emptyState(),
  editorial: clampState({ ...emptyState(), density: 2, character: 1, contrast: 1, softness: -1 }),
  brutalist: clampState({ ...emptyState(), contrast: 3, softness: -3, density: -1, character: -1 }),
  "soft-saas": clampState({ ...emptyState(), softness: 2, density: 1, character: 1, contrast: -1 }),
  terminal: clampState({ ...emptyState(), density: -2, softness: -2, contrast: 2, temperature: 1 }),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run editor/design-language/__tests__/dials.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add editor/design-language/types.ts editor/design-language/dials.ts editor/design-language/__tests__/dials.test.ts
git commit -m "feat(design-language): dial axes, presets, state helpers"
```

---

## Task 3: The fanout core (`resolve`)

**Files:**
- Create: `editor/design-language/fanout.ts`
- Test: `editor/design-language/__tests__/fanout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// editor/design-language/__tests__/fanout.test.ts
import { describe, it, expect } from "vitest";
import { resolve, BASE_TOKENS } from "../fanout";
import { emptyState } from "../dials";
import { hexToHsl } from "../color";

describe("fanout.resolve (pure)", () => {
  it("neutral state returns BASE unchanged", () => {
    expect(resolve(emptyState())).toEqual(BASE_TOKENS);
  });
  it("warmer temperature raises hue of mid-grey neutrals toward amber", () => {
    const warm = resolve({ ...emptyState(), temperature: 3 });
    // --card #121212 is near-grey; warming nudges hue toward ~40deg (amber)
    const baseH = hexToHsl(BASE_TOKENS["--card"]).h;
    const warmH = hexToHsl(warm["--card"]).h;
    expect(warm["--card"]).not.toBe(BASE_TOKENS["--card"]);
    // hue moves toward amber band (0..60), not blue
    expect(Math.abs(((warmH - 40 + 540) % 360) - 180)).toBeLessThan(
      Math.abs(((baseH - 40 + 540) % 360) - 180) + 1,
    );
  });
  it("punchy contrast pushes foreground lighter and background darker", () => {
    const punchy = resolve({ ...emptyState(), contrast: 3 });
    expect(hexToHsl(punchy["--foreground"]).l).toBeGreaterThanOrEqual(
      hexToHsl(BASE_TOKENS["--foreground"]).l,
    );
    expect(hexToHsl(punchy["--background"]).l).toBeLessThanOrEqual(
      hexToHsl(BASE_TOKENS["--background"]).l,
    );
  });
  it("airy density increases --spacing, packed decreases it", () => {
    const airy = parseFloat(resolve({ ...emptyState(), density: -3 })["--spacing"]);
    const packed = parseFloat(resolve({ ...emptyState(), density: 3 })["--spacing"]);
    const base = parseFloat(BASE_TOKENS["--spacing"]);
    expect(airy).toBeGreaterThan(base);
    expect(packed).toBeLessThan(base);
  });
  it("rounded softness increases --radius, sharp decreases it", () => {
    expect(parseFloat(resolve({ ...emptyState(), softness: 3 })["--radius"]))
      .toBeGreaterThan(parseFloat(BASE_TOKENS["--radius"]));
    expect(parseFloat(resolve({ ...emptyState(), softness: -3 })["--radius"]))
      .toBeLessThan(parseFloat(BASE_TOKENS["--radius"]));
  });
  it("expressive character raises saturation of --primary", () => {
    const expr = resolve({ ...emptyState(), character: 3 });
    expect(hexToHsl(expr["--primary"]).s).toBeGreaterThanOrEqual(
      hexToHsl(BASE_TOKENS["--primary"]).s,
    );
  });
  it("is relative to BASE, never compounding (idempotent per state)", () => {
    const a = resolve({ ...emptyState(), temperature: 2 });
    const b = resolve({ ...emptyState(), temperature: 2 });
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run editor/design-language/__tests__/fanout.test.ts`
Expected: FAIL — cannot find module `../fanout`.

- [ ] **Step 3: Write minimal implementation**

```ts
// editor/design-language/fanout.ts
import type { DialState, TokenMap } from "./types";
import { hexToHsl, hslToHex, shiftHue, shiftLightness, shiftSaturation, type Hsl } from "./color";

/** BASE token values — mirrors editor/index.css :root defaults, plus the
 *  Tailwind v4 spacing multiplier (default 0.25rem) which we expose so density
 *  can rescale every px-/py-/gap- utility at once. */
export const BASE_TOKENS: TokenMap = {
  "--background": "#0a0a0a",
  "--foreground": "#fafafa",
  "--card": "#121212",
  "--card-foreground": "#fafafa",
  "--popover": "#18181a",
  "--popover-foreground": "#fafafa",
  "--primary": "#fafafa",
  "--primary-foreground": "#0a0a0a",
  "--secondary": "#242427",
  "--secondary-foreground": "#fafafa",
  "--muted": "#1e1e20",
  "--muted-foreground": "#9a9a9d",
  "--accent": "#242427",
  "--accent-foreground": "#fafafa",
  "--destructive": "#f87171",
  "--destructive-foreground": "#0a0a0a",
  "--border": "#2a2a2c",
  "--input": "#2a2a2c",
  "--ring": "rgba(250, 250, 250, 0.22)",
  "--radius": "0.5rem",
  "--spacing": "0.25rem",
};

// Which tokens are "neutrals" (get temperature tint) vs "accents" (get character saturation).
const ACCENTS = ["--primary", "--accent", "--secondary", "--destructive"];
const FG_BG_PAIRS: [string, string][] = [
  ["--foreground", "--background"],
  ["--card-foreground", "--card"],
  ["--popover-foreground", "--popover"],
];

const isHex = (v: string) => /^#[0-9a-fA-F]{3,8}$/.test(v.trim());
const remParts = (v: string) => parseFloat(v); // "0.5rem" -> 0.5

export function resolve(state: DialState, base: TokenMap = BASE_TOKENS): TokenMap {
  const out: TokenMap = { ...base };

  // 1. temperature: hue-shift hex neutrals toward amber(+)/blue(-), scaled by step.
  //    ~6deg per step. Greys have low S so the effect reads as a faint tint.
  const tempDeg = state.temperature * 6; // +18 at max warm
  for (const k of Object.keys(out)) {
    if (!isHex(out[k])) continue;
    const c = hexToHsl(out[k]);
    // warm target hue ~40 (amber); cool target ~220 (blue). Nudge h toward target.
    const target = state.temperature >= 0 ? 40 : 220;
    const nudged: Hsl = shiftHue(c, 0); // base
    // move h a fraction toward target by |tempDeg| degrees, sign by direction
    const diff = ((target - c.h + 540) % 360) - 180; // signed shortest path
    const step = Math.sign(diff) * Math.min(Math.abs(diff), Math.abs(tempDeg));
    out[k] = hslToHex({ ...nudged, h: (((c.h + step) % 360) + 360) % 360,
      // give near-grey a hair of saturation so the tint is visible
      s: Math.max(c.s, Math.abs(state.temperature) * 1.5) });
  }

  // 2. contrast: push fg lighter / bg darker (punchy +) or together (-). ~4% L/step.
  const cL = state.contrast * 4;
  for (const [fg, bg] of FG_BG_PAIRS) {
    if (isHex(out[fg])) out[fg] = hslToHex(shiftLightness(hexToHsl(out[fg]), cL));
    if (isHex(out[bg])) out[bg] = hslToHex(shiftLightness(hexToHsl(out[bg]), -cL));
  }

  // 3. character: saturation of accents. ~8 S/step.
  const sat = state.character * 8;
  for (const k of ACCENTS) {
    if (isHex(out[k])) out[k] = hslToHex(shiftSaturation(hexToHsl(out[k]), sat));
  }

  // 4. density: global --spacing multiplier. airy(-) bigger, packed(+) smaller. ~8%/step.
  const spaceBase = remParts(base["--spacing"]);
  out["--spacing"] = `${(spaceBase * (1 - state.density * 0.08)).toFixed(4)}rem`;

  // 5. softness: --radius. rounded(+) bigger. ~0.12rem/step, floored at 0.
  const radBase = remParts(base["--radius"]);
  out["--radius"] = `${Math.max(0, radBase + state.softness * 0.12).toFixed(3)}rem`;

  // 6. weight (phase 1): nudge --border lightness for prominence. ~3 L/step.
  if (isHex(out["--border"])) {
    out["--border"] = hslToHex(shiftLightness(hexToHsl(out["--border"]), state.weight * 3));
    out["--input"] = out["--border"];
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run editor/design-language/__tests__/fanout.test.ts`
Expected: PASS (7 tests). If the temperature hue assertion is brittle on pure-grey, confirm `--card` changed and the tint direction is amber; adjust the `s:` floor constant (1.5) until visible, keep the test green.

- [ ] **Step 5: Commit**

```bash
git add editor/design-language/fanout.ts editor/design-language/__tests__/fanout.test.ts
git commit -m "feat(design-language): pure fanout resolve(dialState) -> tokens"
```

---

## Task 4: Lexicon (word → dial deltas)

**Files:**
- Create: `editor/design-language/lexicon.ts`
- Test: `editor/design-language/__tests__/lexicon.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// editor/design-language/__tests__/lexicon.test.ts
import { describe, it, expect } from "vitest";
import { parsePhrase, LEXICON } from "../lexicon";

describe("lexicon.parsePhrase", () => {
  it("maps a single known word to a delta", () => {
    const { deltas, unknownWords } = parsePhrase("warmer");
    expect(deltas).toEqual([{ temperature: 1 }]);
    expect(unknownWords).toEqual([]);
  });
  it("collects multiple known words (multi-axis words allowed)", () => {
    const { deltas } = parsePhrase("warmer and more editorial");
    // 'warmer' -> temp+1 ; 'editorial' -> multi-axis
    expect(deltas.length).toBe(2);
  });
  it("captures unknown words, ignores filler", () => {
    const { deltas, unknownWords } = parsePhrase("make it feel like a ski resort");
    expect(deltas).toEqual([]); // nothing known
    expect(unknownWords).toContain("ski");
    expect(unknownWords).not.toContain("a"); // filler stripped
  });
  it("every lexicon entry only touches valid axes", () => {
    const valid = new Set(["temperature","contrast","density","softness","character","weight"]);
    for (const word of Object.keys(LEXICON))
      for (const k of Object.keys(LEXICON[word])) expect(valid.has(k)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run editor/design-language/__tests__/lexicon.test.ts`
Expected: FAIL — cannot find module `../lexicon`.

- [ ] **Step 3: Write minimal implementation**

```ts
// editor/design-language/lexicon.ts
import type { Delta } from "./types";

/** Pre-built word nudges. The lexicon is the navigation aid: each word is a
 *  small, predictable move so users discover the language by trying words.
 *  Multi-axis words act as mini-presets. */
export const LEXICON: Record<string, Delta> = {
  // temperature
  warmer: { temperature: 1 }, warm: { temperature: 1 }, cozier: { temperature: 2 },
  cooler: { temperature: -1 }, cool: { temperature: -1 }, icy: { temperature: -2 },
  // contrast
  punchier: { contrast: 1 }, punchy: { contrast: 1 }, bolder: { contrast: 1, weight: 1 },
  hushed: { contrast: -1 }, softer: { contrast: -1, softness: 1 }, calmer: { contrast: -1 },
  // density
  airier: { density: -1 }, airy: { density: -1 }, spacious: { density: -2 }, roomier: { density: -1 },
  denser: { density: 1 }, packed: { density: 2 }, compact: { density: 1 }, tighter: { density: 1 },
  // softness
  rounder: { softness: 1 }, rounded: { softness: 1 }, pill: { softness: 3 },
  sharper: { softness: -1 }, sharp: { softness: -1 }, crisp: { softness: -1 },
  // character
  expressive: { character: 2 }, vivid: { character: 2 }, vibrant: { character: 2 },
  muted: { character: -2 }, neutral: { character: -1 }, restrained: { character: -1 },
  // multi-axis "mini presets"
  editorial: { density: 2, character: 1, contrast: 1, softness: -1 },
  brutalist: { contrast: 3, softness: -3, character: -1 },
  terminal: { density: -2, softness: -2, contrast: 2 },
};

const FILLER = new Set(["a","an","the","it","is","more","less","and","feel","make","very","bit","touch","of","to","like","please","just"]);

export function parsePhrase(text: string): { deltas: Delta[]; unknownWords: string[] } {
  const words = text.toLowerCase().replace(/[^a-z\s-]/g, "").split(/\s+/).filter(Boolean);
  const deltas: Delta[] = [];
  const unknownWords: string[] = [];
  for (const w of words) {
    if (FILLER.has(w)) continue;
    if (LEXICON[w]) deltas.push(LEXICON[w]);
    else unknownWords.push(w);
  }
  return { deltas, unknownWords };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run editor/design-language/__tests__/lexicon.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add editor/design-language/lexicon.ts editor/design-language/__tests__/lexicon.test.ts
git commit -m "feat(design-language): word lexicon + parsePhrase"
```

---

## Task 5: Apply + patch + snapshots

**Files:**
- Create: `editor/design-language/apply.ts`
- Create: `editor/design-language/snapshots.ts`
- Test: `editor/design-language/__tests__/apply.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// editor/design-language/__tests__/apply.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { applyTokens, resetTokens, toPatch } from "../apply";
import { SnapshotStore } from "../snapshots";
import { resolve, BASE_TOKENS } from "../fanout";
import { emptyState } from "../dials";

afterEach(() => document.documentElement.removeAttribute("style"));

describe("apply", () => {
  it("applyTokens writes every token onto :root", () => {
    applyTokens(resolve({ ...emptyState(), softness: 3 }));
    expect(document.documentElement.style.getPropertyValue("--radius")).not.toBe("");
    expect(document.documentElement.style.getPropertyValue("--spacing")).not.toBe("");
  });
  it("resetTokens clears all overrides", () => {
    applyTokens(resolve({ ...emptyState(), softness: 3 }));
    resetTokens();
    expect(document.documentElement.style.getPropertyValue("--radius")).toBe("");
  });
  it("toPatch emits cssVars for changed tokens and maps to theme.ts paths", () => {
    const map = resolve({ ...emptyState(), softness: 3, temperature: 2 });
    const patch = toPatch(map);
    expect(patch.cssVars["--radius"]).toBe(map["--radius"]);
    // a mapped color (e.g. --card -> bg.surface) appears in themeTs
    expect(patch.themeTs["bg.surface"]).toBe(map["--card"]);
  });
  it("toPatch reports unreachable theme.ts keys, never invents them", () => {
    const patch = toPatch(resolve(emptyState()));
    expect(patch.notReached).toContain("text.secondary");
    expect(Object.keys(patch.themeTs)).not.toContain("text.secondary");
  });
});

describe("SnapshotStore", () => {
  it("saves and recalls dial states by name", () => {
    const s = new SnapshotStore();
    s.save("editorial-v2", { ...emptyState(), density: 2 });
    expect(s.get("editorial-v2")!.density).toBe(2);
    expect(s.names()).toEqual(["editorial-v2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run editor/design-language/__tests__/apply.test.ts`
Expected: FAIL — cannot find modules `../apply` / `../snapshots`.

- [ ] **Step 3: Write minimal implementation**

```ts
// editor/design-language/apply.ts
import type { TokenMap, DialState } from "./types";
import { resolve, BASE_TOKENS } from "./fanout";

/** Fixed, reviewed CSS-var -> theme.ts color-path correspondence (spec table). */
const THEME_MAP: Record<string, string> = {
  "--background": "bg.canvas",
  "--card": "bg.surface",
  "--popover": "bg.raised",
  "--muted": "bg.hover",
  "--secondary": "bg.selected",
  "--border": "border.line",
  "--foreground": "text.primary",
  "--muted-foreground": "text.muted",
  "--ring": "accent.focus",
};
/** theme.ts color keys with NO clean CSS-var source — reported, never guessed. */
const NOT_REACHED = [
  "border.faint","border.strong","border.hover",
  "text.secondary","text.dim","text.faint",
  "accent.dot","danger.bg","danger.border","danger.text",
];

export function applyTokens(map: TokenMap): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(map)) root.style.setProperty(k, v);
}

export function resetTokens(): void {
  const root = document.documentElement;
  for (const k of Object.keys(BASE_TOKENS)) root.style.removeProperty(k);
}

export type Patch = {
  cssVars: TokenMap;                 // for editor/index.css :root
  themeTs: Record<string, string>;   // theme.ts color path -> value
  notReached: string[];
};

/** Diff against BASE so a patch contains only what actually changed. */
export function toPatch(map: TokenMap): Patch {
  const cssVars: TokenMap = {};
  for (const [k, v] of Object.entries(map)) if (v !== BASE_TOKENS[k]) cssVars[k] = v;
  const themeTs: Record<string, string> = {};
  for (const [cssVar, path] of Object.entries(THEME_MAP)) {
    if (map[cssVar] !== undefined && map[cssVar] !== BASE_TOKENS[cssVar]) {
      themeTs[path] = map[cssVar];
    }
  }
  return { cssVars, themeTs, notReached: [...NOT_REACHED] };
}
```

```ts
// editor/design-language/snapshots.ts
import type { DialState } from "./types";

/** In-session named dial states for A/B. No persistence (matches spec). */
export class SnapshotStore {
  private map = new Map<string, DialState>();
  save(name: string, state: DialState) { this.map.set(name, { ...state }); }
  get(name: string): DialState | undefined { const s = this.map.get(name); return s && { ...s }; }
  names(): string[] { return [...this.map.keys()]; }
  delete(name: string) { this.map.delete(name); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run editor/design-language/__tests__/apply.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add editor/design-language/apply.ts editor/design-language/snapshots.ts editor/design-language/__tests__/apply.test.ts
git commit -m "feat(design-language): apply to :root, toPatch, snapshots"
```

---

## Task 6: Agent fallback (single-shot, gracefully disabled)

**Files:**
- Create: `editor/design-language/agent.ts`
- Create: `editor/design-language/index.ts`
- Test: extend `editor/design-language/__tests__/lexicon.test.ts` is NOT right; create `editor/design-language/__tests__/agent.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// editor/design-language/__tests__/agent.test.ts
import { describe, it, expect } from "vitest";
import { validateDeltaResponse } from "../agent";

describe("agent delta validation", () => {
  it("accepts a well-formed delta and clamps to range", () => {
    expect(validateDeltaResponse('{"temperature": 5, "density": -1}'))
      .toEqual({ temperature: 3, density: -1 });
  });
  it("drops unknown axes", () => {
    expect(validateDeltaResponse('{"temperature": 1, "bogus": 9}'))
      .toEqual({ temperature: 1 });
  });
  it("returns null on non-JSON or empty", () => {
    expect(validateDeltaResponse("not json")).toBeNull();
    expect(validateDeltaResponse("{}")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run editor/design-language/__tests__/agent.test.ts`
Expected: FAIL — cannot find module `../agent`.

- [ ] **Step 3: Write minimal implementation**

```ts
// editor/design-language/agent.ts
import type { Delta, DialState, AxisKey } from "./types";

const AXES: AxisKey[] = ["temperature","contrast","density","softness","character","weight"];
const clamp3 = (n: number) => Math.min(3, Math.max(-3, Math.round(n)));

/** Parse + validate the agent's JSON-delta response. Pure; unit-testable. */
export function validateDeltaResponse(raw: string): Delta | null {
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  const out: Delta = {};
  for (const k of AXES) {
    const v = (obj as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = clamp3(v);
  }
  return Object.keys(out).length ? out : null;
}

export function buildPrompt(phrase: string, state: DialState): string {
  return [
    "You map a short design phrase to adjustments on six design dials.",
    "Axes (each integer -3..+3): temperature(cool..warm), contrast(hushed..punchy),",
    "density(airy..packed), softness(sharp..rounded), character(neutral..expressive), weight(light..bold).",
    `Current state: ${JSON.stringify(state)}.`,
    `Phrase: "${phrase}".`,
    "Respond with ONLY a JSON object of the axes to ADJUST (deltas), e.g. {\"temperature\":1,\"density\":-1}.",
    "No prose, no hex colors.",
  ].join("\n");
}

/** Single-shot call. Returns null if no transport is wired (fallback ships
 *  disabled; lexicon-only stands). The actual transport is confirmed during
 *  implementation against what the editor process can reach. */
export async function proposeDeltas(
  phrase: string,
  state: DialState,
  transport?: (prompt: string) => Promise<string>,
): Promise<Delta | null> {
  if (!transport) return null;
  try {
    const raw = await transport(buildPrompt(phrase, state));
    return validateDeltaResponse(raw);
  } catch {
    return null;
  }
}
```

```ts
// editor/design-language/index.ts
export * from "./types";
export { DIAL_AXES, PRESETS, emptyState, clampState, mergeDeltas } from "./dials";
export { resolve, BASE_TOKENS } from "./fanout";
export { LEXICON, parsePhrase } from "./lexicon";
export { applyTokens, resetTokens, toPatch, type Patch } from "./apply";
export { SnapshotStore } from "./snapshots";
export { proposeDeltas, validateDeltaResponse, buildPrompt } from "./agent";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run editor/design-language/__tests__/agent.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add editor/design-language/agent.ts editor/design-language/index.ts editor/design-language/__tests__/agent.test.ts
git commit -m "feat(design-language): agent fallback (validated deltas) + barrel"
```

---

## Task 7: Dev-server apply endpoint

**Files:**
- Modify: `vite.editor.config.ts` (add a branch in the existing `storyJsonPlugin` middleware)

- [ ] **Step 1: Add the endpoint (no unit test — dev-server glue; verified manually in Task 9)**

In `vite.editor.config.ts`, inside `configureServer`'s `server.middlewares.use((req, res, next) => { ... })`, add this branch BEFORE the final `next();` (mirrors the existing `POST /__save-story` handler):

```ts
      // dev-only: apply resolved design tokens to index.css + theme.ts.
      // Body = { cssVars: {"--x": "..."}, themeTs: {"bg.surface": "#..."} }.
      if (req.method === "POST" && req.url === "/__apply-tokens") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            const patch = JSON.parse(body) as {
              cssVars: Record<string, string>;
              themeTs: Record<string, string>;
            };
            const cssPath = path.join(PROJECT_ROOT, "editor", "index.css");
            let css = fs.readFileSync(cssPath, "utf8");
            for (const [k, v] of Object.entries(patch.cssVars || {})) {
              // replace the FIRST :root occurrence "  --k: <old>;"
              const re = new RegExp(`(${k.replace(/[-]/g, "\\-")}:\\s*)([^;]+)(;)`);
              css = css.replace(re, `$1${v}$3`);
            }
            fs.writeFileSync(cssPath, css);

            const themePath = path.join(PROJECT_ROOT, "editor", "platform", "theme.ts");
            let ts = fs.readFileSync(themePath, "utf8");
            for (const [dotPath, v] of Object.entries(patch.themeTs || {})) {
              const key = dotPath.split(".").pop()!; // e.g. "surface"
              const re = new RegExp(`(${key}:\\s*")(#[0-9a-fA-F]{3,8}|rgba\\([^)]*\\))(")`);
              ts = ts.replace(re, `$1${v}$3`);
            }
            fs.writeFileSync(themePath, ts);

            res.statusCode = 200;
            res.end("ok");
          } catch (e) {
            res.statusCode = 400;
            res.end(`apply failed: ${(e as Error).message}`);
          }
        });
        return;
      }
```

- [ ] **Step 2: Verify the dev server still boots**

Run: `npm run editor` (background), then `curl -s -o /dev/null -w "%{http_code}" http://localhost:5174/`
Expected: `200`. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add vite.editor.config.ts
git commit -m "feat(design-language): dev-only POST /__apply-tokens write endpoint"
```

> **Note on the theme.ts regex:** it replaces the first matching `key: "#..."`. Because some
> keys (e.g. `bg` vs `border`) repeat short names, the implementer MUST verify in Task 9 that the
> right keys changed by diffing `git diff editor/platform/theme.ts` after an apply. If collisions
> occur, scope the regex to the enclosing object block. This is called out so it is checked, not
> assumed.

---

## Task 8: The Language panel UI + tab in DevControlSurface

**Files:**
- Create: `editor/DesignLanguagePanel.tsx`
- Modify: `editor/DevControlSurface.tsx` (add a tab switch; keep existing token UI as the "Tokens" tab)
- Test: `editor/__tests__/design-language-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// editor/__tests__/design-language-panel.test.tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import { DesignLanguagePanel } from "../DesignLanguagePanel";

afterEach(() => document.documentElement.removeAttribute("style"));

describe("DesignLanguagePanel", () => {
  it("renders the 6 dials", () => {
    const { getByLabelText } = render(<DesignLanguagePanel />);
    for (const k of ["temperature","contrast","density","softness","character","weight"])
      expect(getByLabelText(k)).toBeTruthy();
  });
  it("moving a dial writes tokens onto :root", () => {
    const { getByLabelText } = render(<DesignLanguagePanel />);
    fireEvent.change(getByLabelText("softness"), { target: { value: "3" } });
    expect(document.documentElement.style.getPropertyValue("--radius")).not.toBe("");
  });
  it("applying a phrase updates dials (lexicon path)", () => {
    const { getByPlaceholderText, getByText, getByLabelText } = render(<DesignLanguagePanel />);
    fireEvent.change(getByPlaceholderText(/warmer/i), { target: { value: "airier" } });
    fireEvent.click(getByText(/apply phrase/i));
    expect((getByLabelText("density") as HTMLInputElement).value).toBe("-1");
  });
  it("selecting a preset snaps dials", () => {
    const { getByText, getByLabelText } = render(<DesignLanguagePanel />);
    fireEvent.click(getByText("editorial"));
    expect(Number((getByLabelText("density") as HTMLInputElement).value)).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run editor/__tests__/design-language-panel.test.tsx`
Expected: FAIL — cannot find module `../DesignLanguagePanel`.

- [ ] **Step 3: Write the panel**

```tsx
// editor/DesignLanguagePanel.tsx
/**
 * The "Language" tab — descriptive control of the live token tier via mood
 * dials, a word lexicon (+ optional agent fallback), presets, and snapshots.
 * Thin caller over editor/design-language/ (all logic + math lives there).
 */
import React, { useMemo, useState } from "react";
import {
  DIAL_AXES, PRESETS, emptyState, mergeDeltas, clampState,
  resolve, parsePhrase, applyTokens, resetTokens, toPatch,
  SnapshotStore, type DialState,
} from "./design-language";

export const DesignLanguagePanel: React.FC = () => {
  const [state, setState] = useState<DialState>(emptyState());
  const [phrase, setPhrase] = useState("");
  const [unknown, setUnknown] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const store = useMemo(() => new SnapshotStore(), []);
  const [snapNames, setSnapNames] = useState<string[]>([]);

  const applyState = (next: DialState) => {
    const clamped = clampState(next);
    setState(clamped);
    applyTokens(resolve(clamped));
  };

  const onDial = (key: string, v: number) => applyState({ ...state, [key]: v });

  const onPhrase = () => {
    const { deltas, unknownWords } = parsePhrase(phrase);
    setUnknown(unknownWords);
    if (deltas.length) applyState(mergeDeltas(state, deltas));
  };

  const onPreset = (name: string) => applyState(PRESETS[name]);

  const onReset = () => { resetTokens(); setState(emptyState()); setUnknown([]); };

  const onSaveSnapshot = () => {
    const name = `snap-${snapNames.length + 1}`;
    store.save(name, state);
    setSnapNames(store.names());
  };
  const onRecall = (name: string) => { const s = store.get(name); if (s) applyState(s); };

  const onCopyPatch = async () => {
    const patch = toPatch(resolve(state));
    try {
      await navigator.clipboard.writeText(JSON.stringify(patch, null, 2));
      setCopied(true); window.setTimeout(() => setCopied(false), 1200);
    } catch { /* visible below */ }
  };

  const onApplyToProject = async () => {
    const { cssVars, themeTs } = toPatch(resolve(state));
    if (!window.confirm("Write these tokens into index.css + theme.ts?")) return;
    try {
      await fetch("/__apply-tokens", {
        method: "POST",
        body: JSON.stringify({ cssVars, themeTs }),
      });
      window.alert("Applied. Reload to see persisted values as the new BASE.");
    } catch (e) {
      window.alert(`Apply failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="flex flex-col gap-3 px-3 py-2">
      {/* dials */}
      <div className="flex flex-col gap-2">
        {DIAL_AXES.map((a) => (
          <label key={a.key} className="flex items-center gap-2 text-[11px]">
            <span className="w-20 capitalize text-muted-foreground">{a.label}</span>
            <input
              aria-label={a.key}
              type="range" min={-3} max={3} step={1}
              value={state[a.key]}
              onChange={(e) => onDial(a.key, Number(e.target.value))}
              className="flex-1 accent-foreground"
            />
            <span className="w-4 text-center font-mono">{state[a.key]}</span>
          </label>
        ))}
      </div>

      {/* phrase box */}
      <div className="flex items-center gap-2">
        <input
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder="warmer, airier, editorial…"
          className="h-7 flex-1 rounded border border-input bg-transparent px-2 text-[11px] text-foreground outline-none focus-visible:border-ring"
        />
        <button onClick={onPhrase}
          className="h-7 rounded-md bg-primary px-2 text-[11px] font-semibold text-primary-foreground">
          apply phrase
        </button>
      </div>
      {unknown.length > 0 && (
        <div className="text-[10px] text-muted-foreground">
          not in lexicon: {unknown.join(", ")} — (agent fallback wired separately)
        </div>
      )}

      {/* presets */}
      <div className="flex flex-wrap gap-1.5">
        {Object.keys(PRESETS).map((name) => (
          <button key={name} onClick={() => onPreset(name)}
            className="h-6 rounded border border-border px-2 text-[10px] text-foreground">
            {name}
          </button>
        ))}
      </div>

      {/* snapshots */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={onSaveSnapshot}
          className="h-6 rounded border border-border px-2 text-[10px] text-muted-foreground">
          save snapshot
        </button>
        {snapNames.map((n) => (
          <button key={n} onClick={() => onRecall(n)}
            className="h-6 rounded border border-border px-2 text-[10px] text-foreground">
            {n}
          </button>
        ))}
      </div>

      {/* actions */}
      <div className="flex items-center gap-2 border-t border-border pt-2">
        <button onClick={onCopyPatch}
          className="h-7 flex-1 rounded-md border border-border px-2 text-[11px] text-foreground">
          {copied ? "copied ✓" : "copy patch"}
        </button>
        <button onClick={onApplyToProject}
          className="h-7 rounded-md bg-primary px-2 text-[11px] font-semibold text-primary-foreground">
          apply to project
        </button>
        <button onClick={onReset}
          className="h-7 rounded-md border border-border px-2 text-[11px] text-muted-foreground">
          reset
        </button>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Add the tab switch to DevControlSurface**

In `editor/DevControlSurface.tsx`: add the import and a `tab` state, and wrap the existing token list + footer so they render only under the "Tokens" tab, with the new panel under "Language". Make these edits:

Add after the existing imports (top of file):
```tsx
import { DesignLanguagePanel } from "./DesignLanguagePanel";
```

Immediately after `if (!open) return null;` add:
```tsx
  // declared via useState near the other hooks; see Step note below
```

Add this hook alongside the other `useState` calls (near `const [edits, setEdits]`):
```tsx
  const [tab, setTab] = useState<"language" | "tokens">("language");
```

Replace the header block's title row so it includes a tab switcher. Change the existing header `<div className="flex items-center justify-between border-b border-border px-3 py-2"> … </div>` to:
```tsx
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex gap-1">
          {(["language", "tokens"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={
                "h-6 rounded px-2 text-[11px] " +
                (tab === t ? "bg-secondary text-foreground" : "text-muted-foreground")
              }>
              {t}
            </button>
          ))}
        </div>
        <div className="text-[10px] text-muted-foreground">⌃⇧D</div>
      </div>
```

Then wrap the existing scrollable token list `<div className="flex-1 overflow-y-auto px-3 py-2"> … </div>` AND the existing footer actions `<div className="flex items-center gap-2 border-t border-border px-3 py-2"> … </div>` so they only show under tokens, and render the panel under language. Surround both existing blocks with:
```tsx
      {tab === "language" && <div className="flex-1 overflow-y-auto"><DesignLanguagePanel /></div>}
      {tab === "tokens" && (
        <>
          {/* existing scrollable token list div */}
          {/* existing footer actions div */}
        </>
      )}
```
(Keep the existing inner JSX verbatim inside the `tab === "tokens"` fragment; only the wrapper and the header changed. The old `changedCount` header readout moves inside the tokens branch if desired, or is dropped — it is not referenced elsewhere.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run editor/__tests__/design-language-panel.test.tsx editor/__tests__/dev-control-surface.test.tsx`
Expected: PASS. The existing dev-control-surface test still passes because the token inputs now live under the "tokens" tab but `defaultOpen` renders the overlay; if that test queries token inputs, update it to click the "tokens" tab first:
```tsx
// in dev-control-surface.test.tsx, after render(<DevControlSurface defaultOpen />):
fireEvent.click(getByText("tokens"));
```
Apply that one-line addition to each test there that queries `--*` inputs (import `fireEvent` if not already).

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green, no TS errors.

- [ ] **Step 7: Commit**

```bash
git add editor/DesignLanguagePanel.tsx editor/DevControlSurface.tsx editor/__tests__/design-language-panel.test.tsx editor/__tests__/dev-control-surface.test.tsx
git commit -m "feat(design-language): Language tab UI (dials, phrase, presets, snapshots, apply)"
```

---

## Task 9: Vocabulary doc + manual end-to-end verification

**Files:**
- Create: `design-spec/language.yaml`

- [ ] **Step 1: Write the vocabulary documentation**

```yaml
# design-spec/language.yaml
# Human-readable source-of-truth for the design-language vocabulary.
# The transform MATH lives in editor/design-language/fanout.ts; this file
# documents the axes, presets, and lexicon words for humans.
axes:
  temperature: { range: [-3, 3], minus: cooler, plus: warmer, touches: "hue of all neutrals" }
  contrast:    { range: [-3, 3], minus: hushed, plus: punchy,  touches: "fg/bg lightness spread" }
  density:     { range: [-3, 3], minus: airy,   plus: packed,  touches: "--spacing multiplier (+radius nudge)" }
  softness:    { range: [-3, 3], minus: sharp,  plus: rounded, touches: "--radius" }
  character:   { range: [-3, 3], minus: neutral, plus: expressive, touches: "saturation of accents" }
  weight:      { range: [-3, 3], minus: light,  plus: bold,    touches: "border prominence (phase 1); type weight (phase 2)" }
presets:
  default:   { all: 0 }
  editorial: { density: 2, character: 1, contrast: 1, softness: -1 }
  brutalist: { contrast: 3, softness: -3, character: -1 }
  soft-saas: { softness: 2, density: 1, character: 1, contrast: -1 }
  terminal:  { density: -2, softness: -2, contrast: 2, temperature: 1 }
lexicon_sample: [warmer, cooler, airier, packed, rounder, sharp, vivid, muted, editorial, brutalist]
phase_2_deferred:
  - "tokenize type scale (--font-size-*, --leading-*, --font-weight-*)"
  - "codemod the 66 arbitrary text-[..] sites + theme.ts numbers onto tokens"
  - "bridge xterm via getComputedStyle re-push so the terminal obeys the language"
```

- [ ] **Step 2: Manual end-to-end test in the browser**

Run: `npm run editor`, open http://localhost:5174, press ⌃⇧D.
Verify each, recording the result:
1. "Language" tab is shown by default; 6 dials render.
2. Drag **softness → +3**: ReUI corners visibly round (live, no reload).
3. Drag **density → -3**: spacing across the editor visibly opens up (the `--spacing` lever).
4. Type **"warmer, airier, editorial"** → apply phrase → dials jump (density/character/temp), UI shifts warm + airy.
5. Click preset **brutalist** → sharp corners, high contrast.
6. **save snapshot**, change dials, recall the snapshot → returns to saved look.
7. **copy patch** → paste → confirm JSON has `cssVars` + `themeTs` + `notReached`.
8. **apply to project** → confirm dialog → `git diff editor/index.css editor/platform/theme.ts` shows ONLY the intended token lines changed (verify the theme.ts regex didn't hit the wrong key — see Task 7 note). Then `git checkout` those two files to undo the test write.
9. Confirm the **terminal background and timeline clips do NOT move** (phase-2 chrome, by design).

- [ ] **Step 3: Commit**

```bash
git add design-spec/language.yaml
git commit -m "docs(design-language): vocabulary source-of-truth + e2e verified"
```

---

## Self-Review

**Spec coverage check (against `2026-06-05-design-language-layer-design.md`):**
- Both-layered vocabulary (dials + presets + phrase) → Tasks 2, 4, 8. ✓
- Lexicon-first + agent fallback (deltas only, clamped) → Tasks 4, 6. ✓
- Pure fanout core, 6 axes, HSL, relative-to-BASE → Task 3. ✓
- `--spacing` density lever → Task 3 (`resolve`), verified Task 9 step 3. ✓
- In-memory loop + snapshots + apply-to-project (two-plane patch, notReached) → Tasks 5, 7, 8. ✓
- Correspondence table + "not reached, never guessed" → Task 5 (`toPatch`). ✓
- Module architecture (Approach A, thin UI) → Tasks 1–6 core, Task 8 UI. ✓
- Tokens tab preserved (escape hatch) → Task 8. ✓
- `language.yaml` vocabulary doc → Task 9. ✓
- Phase-2 deferrals recorded, not built → Task 9 yaml. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the one risky regex (theme.ts) is flagged for explicit verification in Task 9, not left vague. ✓

**Type consistency:** `DialState`/`Delta`/`TokenMap` defined in Task 2 (`types.ts`) and used identically in Tasks 3–8. `resolve`, `applyTokens`, `resetTokens`, `toPatch`, `parsePhrase`, `mergeDeltas`, `clampState`, `emptyState`, `SnapshotStore`, `PRESETS`, `DIAL_AXES` — names consistent across tasks and re-exported in `index.ts` (Task 6). ✓

**Known risk surfaced:** Task 7's theme.ts string-replace can mis-target repeated short keys; Task 9 step 8 mandates a `git diff` check and undo. Acceptable for a dev-only write path with a human confirm dialog.
