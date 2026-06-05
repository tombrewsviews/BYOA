# Design-Language Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make typography and the terminal chrome respond to the design-language dials — add a token-backed type scale + two new axes (`scale`, `leading`), codemod all 76 hardcoded `text-[..px]` sites onto it, and bridge xterm's colors + font-size so the terminal follows the language.

**Architecture:** Extend the existing pure core (`editor/design-language/`) with a dedicated `--ui-*`/`--ui-leading-*` type-scale (collision-free — NOT stock Tailwind `text-sm`) in `BASE_TOKENS` and two no-op-at-zero transforms in `resolve()`. Add the scale to `editor/index.css` via Tailwind v4 `@theme inline` (so `text-ui-sm` reads `var(--ui-sm)` and reflows live). A mechanical codemod swaps `text-[Npx]` → `text-ui-*` utilities across 22 files (visually inert at neutral; existing stock `text-sm`/`text-xs` sites untouched). A new `applyToTerminal(map)` bridge in `terminal.tsx` re-pushes resolved colors + font-size into xterm (with FitAddon re-fit); the panel orchestrates `applyTokens` + `applyToTerminal` so the pure core stays terminal-agnostic.

**Tech Stack:** TypeScript, React 19, Tailwind v4 (`@theme inline` type tokens), xterm.js + FitAddon, Vitest (jsdom).

---

## File Structure

```
editor/index.css            MODIFY: + --ui-* / --ui-leading-* in :root + @theme inline (text-ui-* utils)
editor/design-language/
  types.ts                  MODIFY: AxisKey union += "scale" | "leading"
  dials.ts                  MODIFY: DIAL_AXES += scale, leading; presets get scale/leading
  fanout.ts                 MODIFY: BASE_TOKENS += 12 --ui-* type tokens; resolve() += 2 transforms
  lexicon.ts                MODIFY: + scale/leading words; editorial gains scale/leading
  terminal-bridge.ts        CREATE: terminalThemeFromTokens(map) — PURE map→{theme,fontSize}
editor/terminal.tsx         MODIFY: store FitAddon module-level; export applyToTerminal(map)
editor/DesignLanguagePanel.tsx  MODIFY: applyState calls applyToTerminal after applyTokens
<22 UI files>               CODEMOD: text-[Npx] → text-ui-{2xs,xs,sm,base,lg,xl} (NOT stock text-sm)
design-spec/language.yaml   MODIFY: document the 8 axes + --ui-* type scale
```

**The 6-value → token map (used by codemod AND token defs):**

> **NAMING (collision-avoidance — critical):** the app ALREADY uses stock Tailwind
> `text-sm`/`text-xs`/`text-base`/`text-lg`/`text-2xl` at their default sizes (37 sites). We must
> NOT redefine those. So the design-language type scale uses a **dedicated `--ui-*` namespace**
> (`text-ui-sm` etc.), which is collision-free (verified: zero existing `text-ui-*` usages). The
> codemod maps the 76 arbitrary `text-[Npx]` sites onto `text-ui-*`; stock `text-sm`/`text-xs`
> sites are left completely untouched and keep Tailwind's defaults.

| px | size token | leading token | utility |
|---|---|---|---|
| 9  | `--ui-2xs` 0.5625rem  | `--ui-leading-2xs: 1.3`  | `text-ui-2xs` |
| 10 | `--ui-xs` 0.625rem    | `--ui-leading-xs: 1.4`   | `text-ui-xs` |
| 11 | `--ui-sm` 0.6875rem   | `--ui-leading-sm: 1.45`  | `text-ui-sm` |
| 13 | `--ui-base` 0.8125rem | `--ui-leading-base: 1.5` | `text-ui-base` |
| 15 | `--ui-lg` 0.9375rem   | `--ui-leading-lg: 1.5`   | `text-ui-lg` |
| 22 | `--ui-xl` 1.375rem    | `--ui-leading-xl: 1.3`   | `text-ui-xl` |

(rem = px/16. Using rem keeps them scalable; values chosen so the codemod is visually identical at neutral. `text-ui-sm` = 11px is a NEW utility, not a redefinition of stock `text-sm`=14px — no collision.)

---

## Task 1: Add the type scale to index.css

**Files:**
- Modify: `editor/index.css`

- [ ] **Step 1: Add the size + leading vars to the `:root` block.**

In `editor/index.css`, inside the `:root { … }` block (after the `--radius: 0.5rem;` line near the top), add:

```css
  /* design-language type scale — a DEDICATED --ui-* tier (NOT a redefinition of
     stock Tailwind text-sm/xs, which the app still uses at default sizes).
     Base values mirror the app's real chrome sizes (px/16 = rem). Exposed via
     @theme inline so text-ui-* utilities read these vars and reflow when the
     `scale`/`leading` dials change them at runtime. */
  --ui-2xs: 0.5625rem;  /* 9px  */
  --ui-xs: 0.625rem;    /* 10px */
  --ui-sm: 0.6875rem;   /* 11px */
  --ui-base: 0.8125rem; /* 13px */
  --ui-lg: 0.9375rem;   /* 15px */
  --ui-xl: 1.375rem;    /* 22px */
  --ui-leading-2xs: 1.3;
  --ui-leading-xs: 1.4;
  --ui-leading-sm: 1.45;
  --ui-leading-base: 1.5;
  --ui-leading-lg: 1.5;
  --ui-leading-xl: 1.3;
```

- [ ] **Step 2: Expose them as Tailwind utilities in the `@theme inline` block.**

In the `@theme inline { … }` block (the one mapping `--color-*` and `--radius-*`), add at the end (before the closing `}`). In Tailwind v4 a `--text-<name>` theme key generates the `text-<name>` utility, so to get `text-ui-sm` we register the key `--text-ui-sm`:

```css
  --text-ui-2xs: var(--ui-2xs);
  --text-ui-2xs--line-height: var(--ui-leading-2xs);
  --text-ui-xs: var(--ui-xs);
  --text-ui-xs--line-height: var(--ui-leading-xs);
  --text-ui-sm: var(--ui-sm);
  --text-ui-sm--line-height: var(--ui-leading-sm);
  --text-ui-base: var(--ui-base);
  --text-ui-base--line-height: var(--ui-leading-base);
  --text-ui-lg: var(--ui-lg);
  --text-ui-lg--line-height: var(--ui-leading-lg);
  --text-ui-xl: var(--ui-xl);
  --text-ui-xl--line-height: var(--ui-leading-xl);
```

(Tailwind v4 reads `--text-<name>` as the `text-<name>` utility's font-size and the paired
`--text-<name>--line-height` as its line-height. Here `<name>` = `ui-sm` etc., yielding
`text-ui-sm`. The underlying `--ui-sm` var is what the `scale` dial mutates at runtime; the
`@theme` key points at it, so changing `--ui-sm` reflows every `text-ui-sm` site live. Stock
`text-sm` is a separate Tailwind key we never touch.)

- [ ] **Step 3: Verify the dev server compiles the CSS.**

Run: `npm run editor` (background), wait ~4s, `curl -s -o /dev/null -w "%{http_code}" http://localhost:5174/` → expect `200`. Then `curl -s http://localhost:5174/editor/index.css` is not meaningful (Tailwind processes it); instead confirm no Vite error in the server log. Stop the server.

- [ ] **Step 4: Commit.**

```bash
git add editor/index.css
git commit -m "feat(design-language): type-scale tokens (--text-*/--leading-*) + @theme exposure"
```

---

## Task 2: Add `scale` + `leading` axes (types + dials)

**Files:**
- Modify: `editor/design-language/types.ts`
- Modify: `editor/design-language/dials.ts`
- Modify: `editor/design-language/__tests__/dials.test.ts`

- [ ] **Step 1: Update the dials test (TDD — change the "exactly 6 axes" assertion to 8 + new presets).**

In `editor/design-language/__tests__/dials.test.ts`, change the first test's expected axis list and add coverage for the new axes:

```ts
  it("defines exactly the 8 spec axes", () => {
    expect(DIAL_AXES.map((a) => a.key).sort()).toEqual(
      ["character", "contrast", "density", "leading", "scale", "softness", "temperature", "weight"],
    );
  });
```
And update the `emptyState` test's key count from 6 to 8:
```ts
    expect(Object.keys(s).length).toBe(8);
```
And in the "every preset is a valid dial state" test, change `Object.keys(s).length).toBe(6)` to `toBe(8)`. Add one new assertion at the end of that test:
```ts
    expect(PRESETS.editorial.scale).toBe(1);
    expect(PRESETS.editorial.leading).toBe(1);
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run editor/design-language/__tests__/dials.test.ts`
Expected: FAIL (axis list has 6, not 8; `PRESETS.editorial.scale` undefined).

- [ ] **Step 3: Add the axes to types.ts.**

In `editor/design-language/types.ts`, change the `AxisKey` union:
```ts
export type AxisKey =
  | "temperature" | "contrast" | "density" | "softness" | "character" | "weight"
  | "scale" | "leading";
```

- [ ] **Step 4: Add the axes + update presets in dials.ts.**

In `editor/design-language/dials.ts`, add two entries to `DIAL_AXES` (after `weight`):
```ts
  { key: "scale", label: "Scale", minLabel: "compact", maxLabel: "large" },
  { key: "leading", label: "Leading", minLabel: "tight", maxLabel: "loose" },
```
Update `PRESETS.editorial` to include the new axes:
```ts
  editorial: clampState({ ...emptyState(), density: 2, character: 1, contrast: 1, softness: -1, scale: 1, leading: 1 }),
```
(The other presets keep their existing values; `emptyState`/`clampState`/`mergeDeltas` pick up the new keys automatically because they iterate `KEYS` derived from `DIAL_AXES`.)

- [ ] **Step 5: Run the test to verify it passes.**

Run: `npx vitest run editor/design-language/__tests__/dials.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add editor/design-language/types.ts editor/design-language/dials.ts editor/design-language/__tests__/dials.test.ts
git commit -m "feat(design-language): add scale + leading dial axes"
```

---

## Task 3: Add type tokens + scale/leading transforms to fanout

**Files:**
- Modify: `editor/design-language/fanout.ts`
- Modify: `editor/design-language/__tests__/fanout.test.ts`

- [ ] **Step 1: Add failing tests for the new tokens + transforms.**

In `editor/design-language/__tests__/fanout.test.ts`, add these tests inside the `describe`:

```ts
  it("BASE includes the 6 ui-text + 6 ui-leading tokens", () => {
    for (const k of ["--ui-2xs","--ui-xs","--ui-sm","--ui-base","--ui-lg","--ui-xl"])
      expect(BASE_TOKENS[k]).toBeTruthy();
    for (const k of ["--ui-leading-2xs","--ui-leading-xs","--ui-leading-sm","--ui-leading-base","--ui-leading-lg","--ui-leading-xl"])
      expect(BASE_TOKENS[k]).toBeTruthy();
  });
  it("large scale grows every --ui-* size token, compact shrinks it", () => {
    const big = resolve({ ...emptyState(), scale: 3 });
    const small = resolve({ ...emptyState(), scale: -3 });
    for (const k of ["--ui-2xs","--ui-sm","--ui-xl"]) {
      expect(parseFloat(big[k])).toBeGreaterThan(parseFloat(BASE_TOKENS[k]));
      expect(parseFloat(small[k])).toBeLessThan(parseFloat(BASE_TOKENS[k]));
    }
  });
  it("loose leading raises every --ui-leading-* token, tight lowers it", () => {
    const loose = resolve({ ...emptyState(), leading: 3 });
    const tight = resolve({ ...emptyState(), leading: -3 });
    for (const k of ["--ui-leading-sm","--ui-leading-base"]) {
      expect(parseFloat(loose[k])).toBeGreaterThan(parseFloat(BASE_TOKENS[k]));
      expect(parseFloat(tight[k])).toBeLessThan(parseFloat(BASE_TOKENS[k]));
    }
  });
```

(The existing "neutral state returns BASE unchanged" test already guards the no-op-at-0 invariant — it will now also cover the 12 new tokens automatically.)

- [ ] **Step 2: Run to verify the new tests fail.**

Run: `npx vitest run editor/design-language/__tests__/fanout.test.ts`
Expected: FAIL (BASE has no `--text-*`; scale/leading don't transform).

- [ ] **Step 3: Add the tokens to BASE_TOKENS.**

In `editor/design-language/fanout.ts`, add to the `BASE_TOKENS` object (after `--spacing`):
```ts
  "--ui-2xs": "0.5625rem",
  "--ui-xs": "0.625rem",
  "--ui-sm": "0.6875rem",
  "--ui-base": "0.8125rem",
  "--ui-lg": "0.9375rem",
  "--ui-xl": "1.375rem",
  "--ui-leading-2xs": "1.3",
  "--ui-leading-xs": "1.4",
  "--ui-leading-sm": "1.45",
  "--ui-leading-base": "1.5",
  "--ui-leading-lg": "1.5",
  "--ui-leading-xl": "1.3",
```

- [ ] **Step 4: Add module-level token-key lists + the two transforms.**

In `editor/design-language/fanout.ts`, near the top (after `FG_BG_PAIRS`), add:
```ts
const UI_SIZE_TOKENS = ["--ui-2xs","--ui-xs","--ui-sm","--ui-base","--ui-lg","--ui-xl"];
const UI_LEADING_TOKENS = ["--ui-leading-2xs","--ui-leading-xs","--ui-leading-sm","--ui-leading-base","--ui-leading-lg","--ui-leading-xl"];
```
Then in `resolve()`, after the `softness` block and before the `weight` block, add:
```ts
  // 7. scale: multiply every --ui-* size token by (1 + scale*0.08). no-op at 0.
  if (state.scale !== 0) {
    for (const k of UI_SIZE_TOKENS) {
      out[k] = `${(parseFloat(base[k]) * (1 + state.scale * 0.08)).toFixed(4)}rem`;
    }
  }

  // 8. leading: add leading*0.06 to every --ui-leading-* unitless token. no-op at 0.
  if (state.leading !== 0) {
    for (const k of UI_LEADING_TOKENS) {
      out[k] = `${(parseFloat(base[k]) + state.leading * 0.06).toFixed(3)}`;
    }
  }
```

- [ ] **Step 5: Run to verify all pass (incl. neutral=BASE still byte-for-byte).**

Run: `npx vitest run editor/design-language/__tests__/fanout.test.ts`
Expected: PASS (all, including the existing neutral-returns-BASE test — the new transforms are guarded `!== 0`).

- [ ] **Step 6: Commit.**

```bash
git add editor/design-language/fanout.ts editor/design-language/__tests__/fanout.test.ts
git commit -m "feat(design-language): scale/leading fanout transforms + type tokens in BASE"
```

---

## Task 4: Lexicon words for the new axes

**Files:**
- Modify: `editor/design-language/lexicon.ts`
- Modify: `editor/design-language/__tests__/lexicon.test.ts`

- [ ] **Step 1: Add a failing test.**

In `editor/design-language/__tests__/lexicon.test.ts`, add inside the describe:
```ts
  it("maps type words to scale/leading axes", () => {
    expect(parsePhrase("larger").deltas).toEqual([{ scale: 1 }]);
    expect(parsePhrase("looser").deltas).toEqual([{ leading: 1 }]);
    expect(parsePhrase("smaller").deltas).toEqual([{ scale: -1 }]);
  });
```
(The existing "every lexicon entry only touches valid axes" test will now also validate scale/leading are legal — update its valid-set to include them:)
```ts
    const valid = new Set(["temperature","contrast","density","softness","character","weight","scale","leading"]);
```

- [ ] **Step 2: Run to verify it fails.**

Run: `npx vitest run editor/design-language/__tests__/lexicon.test.ts`
Expected: FAIL (`larger`/`looser`/`smaller` unknown).

- [ ] **Step 3: Add the words.**

In `editor/design-language/lexicon.ts`, add a new group before the multi-axis section:
```ts
  // scale (type size)
  larger: { scale: 1 }, bigger: { scale: 1 }, huge: { scale: 2 },
  smaller: { scale: -1 }, tiny: { scale: -2 },
  // leading (line-height)
  looser: { leading: 1 }, loose: { leading: 1 }, relaxed: { leading: 1 },
  // (note: "tighter" already maps to density:1; keep it as-is to avoid a breaking change)
```
And update the `editorial` multi-axis entry to include the new axes:
```ts
  editorial: { density: 2, character: 1, contrast: 1, softness: -1, scale: 1, leading: 1 },
```

- [ ] **Step 4: Run to verify it passes.**

Run: `npx vitest run editor/design-language/__tests__/lexicon.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add editor/design-language/lexicon.ts editor/design-language/__tests__/lexicon.test.ts
git commit -m "feat(design-language): lexicon words for scale/leading"
```

---

## Task 5: The codemod — text-[Npx] → token utilities (22 files)

**Files:**
- Modify: 22 `.tsx` files under `editor/` containing `text-[Npx]`
- Create: `editor/design-language/__tests__/codemod.test.ts` (a guard test)

- [ ] **Step 1: Write a guard test that asserts no hardcoded text-[Npx] remain.**

Create `editor/design-language/__tests__/codemod.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("type codemod completeness", () => {
  it("no editor/**/*.tsx still uses an arbitrary text-[Npx] utility", () => {
    // grep returns exit 1 (no matches) on success; capture both.
    let out = "";
    try {
      out = execSync(
        `grep -rEn 'text-\\[[0-9]+px\\]' editor --include='*.tsx' || true`,
        { encoding: "utf8" },
      ).trim();
    } catch { /* grep非-zero handled by || true */ }
    expect(out).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify it fails (76 matches exist).**

Run: `npx vitest run editor/design-language/__tests__/codemod.test.ts`
Expected: FAIL (the grep output lists ~76 lines).

- [ ] **Step 3: Run the codemod (6 exact replacements across editor/).**

Run these six `sed` replacements (in-place, all .tsx under editor/, macOS BSD sed syntax `-i ''`):
```bash
cd /Users/parandykt/Apps/KineticType
FILES=$(grep -rlE 'text-\[[0-9]+px\]' editor --include='*.tsx')
for f in $FILES; do
  sed -i '' -E \
    -e 's/text-\[9px\]/text-ui-2xs/g' \
    -e 's/text-\[10px\]/text-ui-xs/g' \
    -e 's/text-\[11px\]/text-ui-sm/g' \
    -e 's/text-\[13px\]/text-ui-base/g' \
    -e 's/text-\[15px\]/text-ui-lg/g' \
    -e 's/text-\[22px\]/text-ui-xl/g' \
    "$f"
done
```

- [ ] **Step 4: Run the guard test + full suite + typecheck.**

Run: `npx vitest run editor/design-language/__tests__/codemod.test.ts`
Expected: PASS (no `text-[Npx]` remain).
Run: `npx vitest run && npx tsc --noEmit`
Expected: all green, no TS errors (the codemod only touches className string literals, so types are unaffected — existing component tests still pass).

> **Collision guard:** confirm the codemod did NOT touch stock utilities. Run
> `grep -rEc 'text-(sm|xs|base|lg|2xl)\b' editor --include='*.tsx' | grep -v ':0'` before vs after
> should be unchanged — only `text-[Npx]` → `text-ui-*` was rewritten; existing `text-sm`/`text-xs`
> stock sites are untouched (the sed patterns only match the bracketed `text-[...]` form).

- [ ] **Step 5: Visual-inertness check (the codemod must look identical at neutral).**

Run: `npm run editor` (background), open http://localhost:5174 (or just confirm Vite compiles with no error in the log — Tailwind must recognize `text-ui-2xs`/`text-ui-xs`/etc. now that Task 1 defined them). The key correctness point: `--ui-sm` = 0.6875rem = 11px, so every `text-ui-sm` renders at the same px it did as `text-[11px]`. Stop the server.

- [ ] **Step 6: Commit.**

```bash
git add -A editor/  # codemod touched many files; scope to editor/
git commit -m "refactor(design-language): codemod 76 text-[Npx] sites onto the type scale"
```
(Note: this is the one task where `git add -A editor/` is appropriate — the codemod legitimately touches ~22 editor files. Verify `git status` shows ONLY .tsx files with className changes + the new codemod test before committing; if any unrelated file appears, stage explicitly instead.)

---

## Task 6: The xterm bridge (pure mapper + wiring)

**Files:**
- Create: `editor/design-language/terminal-bridge.ts`
- Create: `editor/design-language/__tests__/terminal-bridge.test.ts`
- Modify: `editor/terminal.tsx`

- [ ] **Step 1: Write a failing test for the pure mapper.**

Create `editor/design-language/__tests__/terminal-bridge.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { terminalThemeFromTokens } from "../terminal-bridge";
import { resolve, BASE_TOKENS } from "../fanout";
import { emptyState } from "../dials";

describe("terminalThemeFromTokens (pure)", () => {
  it("maps token map to an xterm theme + fontSize", () => {
    const out = terminalThemeFromTokens(BASE_TOKENS);
    expect(out.theme.background).toBe("#0a0a0a");
    expect(out.theme.foreground).toBe("#fafafa");
    expect(typeof out.fontSize).toBe("number");
    expect(out.fontSize).toBeGreaterThan(0);
  });
  it("fontSize grows when scale dial is large", () => {
    const big = terminalThemeFromTokens(resolve({ ...emptyState(), scale: 3 }));
    const base = terminalThemeFromTokens(BASE_TOKENS);
    expect(big.fontSize).toBeGreaterThan(base.fontSize);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `npx vitest run editor/design-language/__tests__/terminal-bridge.test.ts`
Expected: FAIL (no module).

- [ ] **Step 3: Write the pure mapper.**

Create `editor/design-language/terminal-bridge.ts`:
```ts
import type { TokenMap } from "./types";

/** xterm theme uses a JS color API, not CSS, so a TokenMap must be translated
 *  into xterm's ITheme + a fontSize. Pure — no terminal access here. */
export type XtermBridge = {
  theme: { background: string; foreground: string; cursor: string; selectionBackground: string };
  fontSize: number;
};

/** Convert a rem string ("0.6875rem") to px (assumes 16px root). */
const remToPx = (v: string): number => Math.round(parseFloat(v) * 16);

export function terminalThemeFromTokens(map: TokenMap): XtermBridge {
  return {
    theme: {
      background: map["--background"],
      foreground: map["--foreground"],
      // cursor keeps the app's amber insting — not a token; preserved as-is.
      cursor: "#facc15",
      selectionBackground: "#ffffff33",
    },
    // the terminal sits at the small UI tier; track --ui-sm.
    fontSize: remToPx(map["--ui-sm"]),
  };
}
```
(Note: cursor/selection are intentionally NOT token-bound — the spec keeps the amber cursor for visibility. Background/foreground/fontSize ARE bound, which is the visible win.)

- [ ] **Step 4: Run to verify the mapper passes.**

Run: `npx vitest run editor/design-language/__tests__/terminal-bridge.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the bridge into terminal.tsx.**

In `editor/terminal.tsx`:
(a) Add a module-level FitAddon ref next to `_activeTerm` (currently `let _activeTerm: XTerm | null = null;`):
```ts
let _activeFit: import("xterm-addon-fit").FitAddon | null = null;
```
(b) In the effect where `const fit = new FitAddon();` is created and `_activeTerm = term;` is set, also set:
```ts
    _activeFit = fit;
```
and in the cleanup where `_activeTerm = null` (look for `if (_activeTerm === term) _activeTerm = null;`), also clear:
```ts
      if (_activeFit) _activeFit = null;
```
(c) Add the exported bridge function near the top-level (after the `_activeTerm`/`_activeFit` declarations), importing the pure mapper:
```ts
import { terminalThemeFromTokens } from "./design-language/terminal-bridge";
import type { TokenMap } from "./design-language/types";

/** Push resolved design tokens into the live terminal (colors + font-size).
 *  No-op if no terminal is mounted. Re-fits only when font-size changed. */
export function applyToTerminal(map: TokenMap): void {
  const term = _activeTerm;
  if (!term) return;
  const { theme, fontSize } = terminalThemeFromTokens(map);
  term.options.theme = theme;
  if (term.options.fontSize !== fontSize) {
    term.options.fontSize = fontSize;
    _activeFit?.fit();
  }
}
```

- [ ] **Step 6: Typecheck + full suite.**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + all pass (terminal.tsx changes are type-checked; the bridge is unit-tested; the `term.options.theme`/`fontSize` setters exist on xterm's API).

- [ ] **Step 7: Commit.**

```bash
git add editor/design-language/terminal-bridge.ts editor/design-language/__tests__/terminal-bridge.test.ts editor/terminal.tsx
git commit -m "feat(design-language): xterm bridge — push resolved colors + font-size to terminal"
```

---

## Task 7: Orchestrate terminal bridge from the panel

**Files:**
- Modify: `editor/DesignLanguagePanel.tsx`
- Modify: `editor/__tests__/design-language-panel.test.tsx`

- [ ] **Step 1: Add a test that the panel calls the terminal bridge on apply.**

In `editor/__tests__/design-language-panel.test.tsx`, add a mock + test. At the top, mock the terminal module (jsdom has no real xterm):
```tsx
import { vi } from "vitest";
vi.mock("../terminal", () => ({ applyToTerminal: vi.fn() }));
import { applyToTerminal } from "../terminal";
```
Then add a test:
```tsx
  it("pushes tokens to the terminal bridge when a dial moves", () => {
    const { getByLabelText } = render(<DesignLanguagePanel />);
    fireEvent.change(getByLabelText("scale"), { target: { value: "2" } });
    expect(applyToTerminal).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify it fails.**

Run: `npx vitest run editor/__tests__/design-language-panel.test.tsx`
Expected: FAIL (panel doesn't call applyToTerminal yet).

- [ ] **Step 3: Wire it into `applyState`.**

In `editor/DesignLanguagePanel.tsx`, add the import:
```tsx
import { applyToTerminal } from "./terminal";
```
Change `applyState` to also push to the terminal:
```tsx
  const applyState = (next: DialState) => {
    const clamped = clampState(next);
    setState(clamped);
    const tokens = resolve(clamped);
    applyTokens(tokens);
    applyToTerminal(tokens);
  };
```
(Note: `resolve` is now called once and reused for both sinks — cleaner than resolving twice.)

- [ ] **Step 4: Also push on reset.**

In the `onReset` handler, after `resetTokens()`, add a terminal reset to BASE:
```tsx
  const onReset = () => {
    resetTokens();
    applyToTerminal(BASE_TOKENS);
    setState(emptyState());
    setUnknown([]);
  };
```
Add `BASE_TOKENS` to the existing import from `./design-language`.

- [ ] **Step 5: Run the panel tests + full suite + typecheck.**

Run: `npx vitest run editor/__tests__/design-language-panel.test.tsx`
Expected: PASS.
Run: `npx vitest run && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 6: Commit.**

```bash
git add editor/DesignLanguagePanel.tsx editor/__tests__/design-language-panel.test.tsx
git commit -m "feat(design-language): panel pushes resolved tokens to terminal on apply/reset"
```

---

## Task 8: Update vocabulary doc + e2e verification

**Files:**
- Modify: `design-spec/language.yaml`

- [ ] **Step 1: Update language.yaml for the 8 axes + type scale.**

In `design-spec/language.yaml`, add to the `axes:` map:
```yaml
  scale:    { range: [-3, 3], minus: compact, plus: large, touches: "all --ui-* type-size tokens (×8%/step)" }
  leading:  { range: [-3, 3], minus: tight,   plus: loose, touches: "all --ui-leading-* tokens (+0.06/step)" }
```
Update `editorial` under `presets:` to include `scale: 1, leading: 1`. Add to `lexicon_sample`:
```yaml
  larger: { scale: 1 }
  smaller: { scale: -1 }
  looser: { leading: 1 }
```
Replace the `phase_2_deferred` block with a `phase_2_done` note and a new `phase_3_deferred`:
```yaml
phase_2_done:
  - "type scale tokenized (--text-*/--leading-*); 76 text-[..px] sites codemodded"
  - "scale + leading axes drive type size + line-height live"
  - "xterm bridge: terminal colors + font-size follow the language"
phase_3_deferred:
  - "--font-weight-* tokens so the weight axis drives true font-weight (currently border-only)"
  - "tokenize the 4 remaining theme.ts font.size inline consumers"
```

- [ ] **Step 2: Validate the YAML.**

Run: `python3 -c "import yaml; yaml.safe_load(open('design-spec/language.yaml')); print('OK')"`
Expected: `OK`.

- [ ] **Step 3: Manual e2e in the browser.**

Run: `npm run editor`, open http://localhost:5174, press ⌃⇧D → Language tab. Verify:
1. Drag **scale → +3**: all app text grows live (no reload).
2. Drag **scale → -3**: all text shrinks.
3. Drag **leading → +3**: line-heights visibly loosen.
4. Type **"larger, looser"** → apply phrase → dials move, text grows + loosens.
5. Preset **editorial** now also bumps type size/leading.
6. **The terminal** (bottom) recolors with temperature/contrast/character changes AND its font resizes with `scale` — confirming the bridge. (Previously frozen in phase 1.)
7. `git diff` is clean (no leftover); stop the server.

- [ ] **Step 4: Commit.**

```bash
git add design-spec/language.yaml
git commit -m "docs(design-language): phase-2 vocabulary (scale/leading) + e2e verified"
```

---

## Self-Review

**Spec coverage (against `2026-06-06-design-language-phase2-design.md`):**
- Type scale tokens (`--text-*`/`--leading-*`) + @theme exposure → Task 1. ✓
- Two new axes scale + leading → Task 2 (dials) + Task 3 (transforms). ✓
- no-op-at-0 invariant preserved → Task 3 (guarded `!== 0`; neutral=BASE test). ✓
- Full 76-site codemod, visually inert at neutral → Task 5 (+ guard test). ✓
- Lexicon scale/leading words + editorial update → Task 4. ✓
- xterm color + font-size bridge with FitAddon re-fit → Task 6 (pure mapper + wiring) + Task 7 (orchestration). ✓
- Panel orchestrates applyTokens + applyToTerminal (core stays terminal-agnostic) → Task 7 (resolved the spec's open question: panel orchestrates). ✓
- Doc update + phase-3 deferral → Task 8. ✓
- Out-of-scope items (theme.ts space, --font-weight, font.size consumers) → left untouched; recorded as phase 3 in Task 8. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; the codemod is six exact `sed` patterns; the one bulk `git add -A editor/` is explicitly guarded with a status check. ✓

**Type consistency:** `AxisKey` (Task 2) gains `scale`/`leading`, used identically in fanout (Task 3), lexicon (Task 4), bridge (Task 6). `TokenMap`, `resolve`, `applyTokens`, `BASE_TOKENS`, `applyToTerminal`, `terminalThemeFromTokens` names consistent across tasks. The `--text-*`/`--leading-*` token names are identical in index.css (Task 1), BASE_TOKENS (Task 3), and the bridge (Task 6). ✓

**Known risk surfaced + resolved:** the app ALREADY uses 37 stock `text-sm`/`text-xs`/`text-base`/`text-lg`/`text-2xl` sites at default sizes. Redefining stock `text-sm` would silently shrink those (a regression). RESOLVED by using a dedicated `--ui-*` / `text-ui-*` namespace (verified collision-free) — the codemod maps `text-[Npx]` → `text-ui-*`; stock utilities are never touched (the sed patterns only match the bracketed form). Task 5's codemod relies on `--ui-sm`=0.6875rem=11px so the swap is visually inert — Task 5 Step 5 + the collision-guard grep + Task 8 e2e verify this.
