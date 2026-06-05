# Design-Language Layer — Phase 2 Design Spec

**Date:** 2026-06-06
**Status:** Awaiting user review
**Branch:** `feat/spec-ui-binding` (continues phase 1)
**Builds on:** `2026-06-05-design-language-layer-design.md` (phase 1: color + radius + --spacing, shipped)

## Context

Phase 1 made color, radius, and global spacing respond to mood dials live. Phase 2 closes the
two boundaries phase 1 deliberately left: **typography** (frozen in hardcoded `text-[..px]`
utilities) and the **terminal chrome** (xterm, which can't read CSS vars). After phase 2, typing
"larger, looser, editorial" reflows the whole app's type, and the terminal recolors and resizes
with everything else.

### Decisions locked (this session)
- **Full type codemod** — all 76 `text-[..px]` sites across 22 files become token-backed utilities,
  so ALL app type reflows when a type dial moves.
- **Two new dial axes** — `scale` (type size, compact↔large) and `leading` (line-height,
  tight↔loose). Dial set goes from 6 → 8.
- **Color + font-size xterm bridge** — after `applyTokens`, re-push resolved colors AND font-size
  into the live terminal via its JS API + FitAddon re-fit.

### Ground truth (re-measured)
- 76 `text-[..px]` occurrences, only **6 distinct values**: 9, 10, 11, 13, 15, 22px. Across 22 files.
- `text-[Npx]` always appears as a standalone class token inside a className string → regex-safe to
  swap for a named utility.
- Tailwind v4, no `@theme` type scale yet (`editor/index.css` has no `--text-*`/`--leading-*`).
- `editor/platform/theme.ts`: `space` export has **0 consumers** (dead — out of scope);
  `font.size` has 4 inline consumers; `font.family` a handful.
- xterm (`editor/terminal.tsx`): module-level `_activeTerm`, options at `term.options.theme`
  (JS color object) and `term.options.fontSize`; a `FitAddon` is loaded (`fit.fit()` re-fits).

## The type scale (new tokens)

Defined in `editor/index.css` `:root` AND exposed via `@theme inline` so Tailwind generates the
utilities. Base values = the 6 observed sizes; line-heights are a sensible default set.

| px | size token | utility | leading token (default) |
|---|---|---|---|
| 9  | `--text-2xs`  | `text-2xs`  | `--leading-2xs: 1.3` |
| 10 | `--text-xs`   | `text-xs`   | `--leading-xs: 1.4` |
| 11 | `--text-sm`   | `text-sm`   | `--leading-sm: 1.45` |
| 13 | `--text-base` | `text-base` | `--leading-base: 1.5` |
| 15 | `--text-lg`   | `text-lg`   | `--leading-lg: 1.5` |
| 22 | `--text-xl`   | `text-xl`   | `--leading-xl: 1.3` |

> Tailwind v4 note: `text-sm` reads `var(--text-sm)` once `--text-sm` is in the `@theme` block, and
> picks up the matched `--leading-sm` as its line-height. So changing `--text-sm` at runtime reflows
> every `text-sm` site live — that is the binding mechanism, mirroring how `--color-*` works in
> phase 1. **Caveat:** these utility *names* (`text-sm` = 11px) intentionally differ from Tailwind's
> stock scale (where `text-sm` = 14px). We are overriding the scale with the app's real values; this
> is a deliberate, documented redefinition, not stock Tailwind.

## The two new axes (`fanout.ts`)

Both no-op at 0 (preserves the `resolve(emptyState()) === BASE` invariant). Added to `BASE_TOKENS`:
the 6 `--text-*` + 6 `--leading-*` tokens.

- **`scale`** (compact ↔ large): multiply every `--text-*` token by `(1 + scale·0.08)`. ~±8%/step.
  Whole type scale grows/shrinks together; spacing (`density`) stays independent.
- **`leading`** (tight ↔ loose): add `leading·0.06` to every `--leading-*` token. ~±0.06/step.

Lexicon additions (in `lexicon.ts`): `larger/bigger → {scale:1}`, `smaller → {scale:-1}`,
`loose/airy-type → {leading:1}`, `tight → {leading:-1}`, and `editorial` gains `scale:1, leading:1`.
(`editorial` already touches density/character/contrast/softness — extend, don't replace.)

## The codemod (76 sites → token utilities)

A mechanical, reviewable transform. For each file with `text-[Npx]`:
`text-[9px]→text-2xs`, `text-[10px]→text-xs`, `text-[11px]→text-sm`, `text-[13px]→text-base`,
`text-[15px]→text-lg`, `text-[22px]→text-xl`.

- Applied as exact string replacements on the 6 patterns (word-boundary safe: `text-[11px]` can't
  partially match anything else).
- **Verification per file:** the swap must be visually inert at neutral dials (the token's base
  value equals the px it replaced), so the app looks identical before any dial moves. A snapshot of
  computed font-sizes before/after the codemod (at neutral) must match.
- The 22 files include design-language's own panel/overlay — those get codemodded too for
  consistency.

## The xterm bridge (`terminal.tsx` + a hook)

xterm has a JS API, not CSS — so after every `applyTokens`, we read the resolved values via
`getComputedStyle(document.documentElement)` and push them into the live terminal:

- **Colors:** map computed `--background → theme.background`, `--foreground → theme.foreground`,
  `--ring`/accent → cursor/selection, then `_activeTerm.options.theme = {…}`.
- **Font-size:** read computed `--text-sm` (the terminal's tier ≈ 11–12px), set
  `_activeTerm.options.fontSize`, then call the FitAddon's `fit()` to reflow cols/rows.
- Exposed as `applyToTerminal(map)` in `terminal.tsx` (reads `_activeTerm`; no-op if no terminal
  mounted). `applyTokens` (or the panel's apply path) calls it after writing `:root`.
- Debounced/guarded so dragging a dial doesn't thrash `fit()` (only re-fit on font-size change).

## Architecture (unchanged shape, extended)

```
editor/design-language/
  dials.ts     + scale, leading axes (now 8) + presets updated
  fanout.ts    + --text-*/--leading-* in BASE; + scale/leading transforms (no-op at 0)
  lexicon.ts   + scale/leading words
  apply.ts     applyTokens now ALSO calls the terminal bridge (or panel orchestrates both)
editor/index.css        + --text-*/--leading-* in :root + @theme inline
editor/terminal.tsx     + applyToTerminal(map) bridge (color + fontSize + re-fit)
<22 UI files>           codemod: text-[Npx] → text-{2xs..xl}
```

The pure core stays pure; the only new impurity is `applyToTerminal` (DOM/terminal side-effect),
isolated in `terminal.tsx` exactly like `applyTokens` is isolated in `apply.ts`.

## Testing

- **fanout:** `scale: ±2` scales `--text-*` the right direction; `leading: ±2` moves `--leading-*`;
  both no-op at 0; `resolve(emptyState())` still === BASE byte-for-byte (now incl. the 12 new tokens).
- **dials:** axis set is exactly the 8 keys; presets valid; `editorial` includes scale/leading.
- **lexicon:** new words map to the new axes; existing words unchanged.
- **codemod:** a test (or scripted check) asserting ZERO `text-[..px]` remain in `editor/**` after
  the codemod, and that the 6 → token mapping was applied (no stray pattern).
- **xterm bridge:** unit-test the pure part — a `terminalThemeFromTokens(map)` helper that maps a
  TokenMap to xterm's theme object + fontSize (pure, testable); the actual `_activeTerm` push is a
  thin wrapper verified manually/e2e.
- **e2e:** boot editor, move `scale` dial → all app text resizes live; move `leading` → line-heights
  change; terminal recolors + resizes with the dials.

## Scope boundaries

**In:** type-scale tokens, scale+leading axes, full 76-site codemod, xterm color+fontSize bridge,
lexicon/preset updates, tests.

**Out (explicitly):** `theme.ts` `space` export (dead, 0 consumers — leave it); rewriting the 4
`font.size`/`font.family` inline consumers (small; can fold into the codemod's spirit later but not
required for the dials to work); `--font-weight-*` tokenization (the `weight` axis stays
phase-1 border-only — true font-weight tokens are a phase-3 nicety, not blocking type reflow);
non-px spacing utilities (already handled by `--spacing` in phase 1).

## Open questions

- Final per-axis magnitudes (`scale` 0.08/step, `leading` 0.06/step) — fix direction now, tune
  against the live app during implementation.
- Whether `apply.ts` should import the terminal bridge directly (couples the pure-ish apply to
  xterm) or the panel orchestrates `applyTokens` + `applyToTerminal` separately (cleaner). Lean:
  **panel orchestrates** — keep `apply.ts` free of terminal knowledge; `applyToTerminal` lives in
  `terminal.tsx` and the panel calls both. Resolve in planning.
