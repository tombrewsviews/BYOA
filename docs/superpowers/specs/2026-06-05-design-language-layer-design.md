# Design-Language Layer — Design Spec

**Date:** 2026-06-05
**Status:** Awaiting user review
**Branch:** `feat/spec-ui-binding`

## Context

The repo already has a **token-tier control surface** (`editor/DevControlSurface.tsx`, ⌃⇧D) that
edits the 18 color CSS vars + `--radius` live. But it controls *each token separately* — a
coding-level interface, not a design language.

This feature adds a **descriptive design-language layer on top**: control color, spacing,
typography, and radius across the app with *high-level words and dials* ("warmer, airier, more
editorial") instead of individual hex values. The user explicitly wants a higher-level design
language — not a coding language — optimized for fast, low-friction experimentation.

### Decisions locked during brainstorming
- **Vocabulary:** *Both layered* — perceptual **mood dials** are the substrate; **presets** are
  named dial positions; a **phrase box** resolves words to dial state.
- **Phrase→dials:** *Lexicon-first* (pre-built nudges that double as a navigation aid, optimized
  for experimentation) with **agent fallback** for novel phrases. The agent returns **dial
  deltas only**, never raw hex.
- **Persistence:** In-memory experiment loop + **named session snapshots** (A/B) + a deliberate
  **"Apply to project"** that writes resolved tokens to `index.css` + `theme.ts`. Copy-diff
  retained. No DB, no browser storage of values.
- **Reach:** Full app eventually (color + spacing + type, incl. `theme.ts` chrome).
- **Staging:** *Vertical slice first* — build the complete machine wired to the already-bindable
  tiers (color + radius + global `--spacing`); defer type-scale tokenization, the arbitrary-size
  codemod, and the xterm bridge to phase 2.
- **Architecture:** *Approach A* — a pure-function core in `editor/design-language/`; the UI and
  agent are thin callers.

### Ground-truth constraints (from extraction)
- Substrate: **Tailwind v4**, no custom theme scale; color + radius are the only CSS-var tokens
  (`editor/index.css:11-34`, exposed via `@theme inline` `:72-95`).
- **Spacing/type are NOT variable-bound:** ~196 `px-/py-/gap-` utilities + 66 arbitrary
  `text-[..]` sizes + `theme.ts` numbers. Tailwind v4's single live lever is the **`--spacing`
  multiplier** (rescales all spacing *steps* at once); arbitrary `text-[11px]` literals and
  `theme.ts` numbers will **not** follow a variable — they need a phase-2 codemod.
- **Two token planes:** `index.css` (CSS vars, ReUI/Tailwind) and `editor/platform/theme.ts`
  (finer JS palette, inline styles + xterm). They share no names; xterm can't read CSS vars.
- `theme.ts:space` is a **dead export (0 usages)**; `font.size` has 4 usages.

## Architecture (Approach A — pure core, thin shell)

```
editor/design-language/
  dials.ts       DIAL_AXES (name, range -3..+3, default 0) + PRESETS (named dial positions)
  lexicon.ts     LEXICON (word → partial dial-deltas) + parsePhrase(text) → {deltas, unknownWords}
  fanout.ts      resolve(dialState, base) → TokenMap        ← PURE CORE (no React/DOM)
  apply.ts       applyTokens(TokenMap) → setProperty(:root)  +  toPatch(TokenMap) → {cssVars, themeTs}
  snapshots.ts   in-session Map<name, dialState> for A/B (no persistence)
  agent.ts       proposeDeltas(phrase, dialState) → dial-deltas  (Claude call; fallback only)
  index.ts       public surface
```

**Unit boundaries (each independently testable):**
- `fanout.resolve` — the entire intellectual core as a **pure function**: `(dialState, baseTokens)
  → tokenMap`. Identical whether driven by a dial drag, a lexicon word, or the agent.
- `apply` — the only DOM-touching unit; reuses the existing `setProperty`/`removeProperty` path.
- UI — a new **"Language" tab inside the existing `DevControlSurface.tsx`** (not a new overlay).
  The current per-token pickers become a **"Tokens (advanced)" tab** — the escape hatch beneath
  the language.
- `agent.ts` — isolated, lazy, invoked only on lexicon miss; app works fully offline without it.

**Reuses:** `setProperty` apply path, copy-diff serializer, the ⌃⇧D overlay shell + localStorage
visibility flag, and the dev-server POST-write pattern that already saves `story.json`.

**Source-of-truth split:** the *vocabulary* (axes, ranges, presets, lexicon words) is also
recorded in `design-spec/language.yaml` as human-readable documentation; the transform **math**
lives in typed `fanout.ts`.

## Vocabulary + fanout model

Six dial axes, each `-3 … +3`, default `0`. Colors transform in **HSL space** (hex → HSL → shift
→ hex), always computed against the **BASE** token values (captured from `index.css` at mount) so
dials are relative to ground truth and never compound.

| Axis | − | + | Fanout rule |
|---|---|---|---|
| **temperature** | cooler | warmer | Hue-shift every neutral toward amber(+)/blue(−), scaled by saturation headroom, ≈±6°/step. A tint, not a recolor. |
| **contrast** | hushed | punchy | Push fg/bg pairs apart(+)/together(−) in lightness, ≈±4% L/step. |
| **density** | airy | packed | Scale global **`--spacing`** (base `0.25rem`) ≈∓8%/step (airy = larger); slight `--radius` nudge when packed. |
| **softness** | sharp | rounded | Scale **`--radius`** (base `0.5rem`) ≈±0.12rem/step. |
| **character** | neutral | expressive | Raise saturation of `--primary`/`--accent`/`--destructive`/`--ring` (+); desaturate (−). Structural neutrals untouched. |
| **weight** | light | bold | Phase 1: adjust `--border` prominence only. Full type-weight (`--font-weight-ui`) lands in phase 2. |

**Phrase resolution (lexicon-first):**
```
"warmer and more editorial, a touch airier"
  parsePhrase → warmer:{temp:+1}, editorial:{density:+1,character:+1,contrast:+1}, airier:{density:+1}
  merge (sum, clamp -3..+3) → {temperature:+1, density:+2, character:+1, contrast:+1}
  resolve(dialState, BASE) → TokenMap → applyTokens → repaint
```
The lexicon is the **navigation aid**: each word is a pre-built nudge; multi-axis words
(`editorial`) act as mini-presets. On a lexicon miss (`unknownWords` non-empty), the panel offers
`agent.proposeDeltas`, which returns deltas in the same shape.

**Presets** (`dials.ts`): `default`, `editorial`, `brutalist`, `soft-saas`, `terminal`. Picking
one **snaps the dials**, which then resolve normally — a preset is a saved point in dial-space.
**Snapshots** are user-created presets held in-session for A/B.

**Honest caveat:** near-grey neutrals (`#0a0a0a`, `#fafafa`) have little saturation to shift, so
`temperature` reads subtly on the extremes and more on mid-greys. Per-token scaling will be tuned
to be perceptible without going garish.

## Data flow, apply/commit, agent contract

**Live loop (in-memory, instant):** `dial/preset/phrase → resolve(dialState, BASE) → applyTokens
→ setProperty(:root) → repaint`. Reset = re-apply BASE.

**Snapshots (session-only):** `Map<name, dialState>`; save names current dials, click re-applies.
Stores dial state only, not tokens. Lost on reload.

**Commit — "Apply to project" (deliberate, the one risky action):**
- `toPatch(map)` emits **two** artifacts:
  1. CSS-var overrides for `index.css` `:root`.
  2. A `theme.ts` `color` patch via a **fixed, reviewed correspondence table**
     (`--card → bg.surface`, `--border → border.line`, `--background → bg.canvas`, …). Keys with
     no clean CSS-var equivalent (theme.ts's 5 text shades) are **left untouched** and reported as
     **"not reached"** — never guessed.
- Writes go through a new **dev-only `POST /__apply-tokens`** endpoint (mirrors the existing
  `/__save-story` plugin in `vite.editor.config.ts`). The panel shows the exact diff first.
- **Phase-1 commit scope:** `index.css` vars + the safe `theme.ts` color subset +
  `--spacing`/`--radius`. Type scale, the 66 `text-[..]` sites, and xterm are explicitly **out**.

**Agent contract (`agent.ts`, fallback only):** on lexicon miss, panel offers "interpret with
agent". Input: axis list + ranges + current dial state + the unknown phrase. Output: **JSON
dial-deltas only**, validated and clamped `-3..+3`; non-conforming output rejected. Offline/failure
→ silent no-op + "couldn't interpret" note. Never blocks the lexicon path.

> **Resolved ambiguity:** `agent.ts` is a **standalone, single-shot call**, NOT routed through the
> `editor/agent-chat/` conversational stack (that stack is for the user's project-editing agent and
> carries session/turn state this feature doesn't want). It is a one-shot
> request→JSON-deltas→done. The exact transport (which Claude endpoint/SDK the app can reach from
> the editor process) is a phase-1 implementation detail to confirm against what's wired; if no
> call path exists from the editor, the agent fallback ships **disabled** and lexicon-only stands —
> the feature is still complete without it.

## Testing

- `fanout.resolve` — pure unit tests per axis at `±2` (HSL shift / spacing multiplier / radius);
  combined dials; clamping; BASE round-trip.
- `lexicon.parsePhrase` — word→delta, multi-word merge, unknown-word capture.
- `toPatch` — correct CSS + theme.ts mapping; "not reached" keys reported, not invented.
- `applyTokens` — jsdom asserts the right `:root` props (same style as the existing
  `dev-control-surface.test.tsx`).
- Agent path — mocked: malformed / out-of-range responses rejected.

## Scope boundaries

**Phase 1 (this build):** full dial+lexicon+agent+snapshot+apply machine wired to **color +
radius + `--spacing`**. Language tab in the existing overlay. Pure core + tests.

**Phase 2 (deferred, separate plan):** introduce `--font-size-*`/`--leading-*`/`--font-weight-*`
tokens; route the 6 ui components; **codemod** the 66 arbitrary `text-[..]` sites + `theme.ts`
numbers onto tokens; bridge xterm via `getComputedStyle` re-push. Only after phase 2 do `density`
(type), `weight` (type), and the chrome fully obey the language.

**Explicitly NOT in scope:** browser-storage of values, a backend/DB, recoloring via agent raw-hex
output, unrelated refactors of the existing components.

## Open questions

- Final lexicon word list (starter set in phase 1; grows from use).
- Exact per-axis transform magnitudes — will be tuned during implementation against the live app
  for perceptibility; the spec fixes the *direction* and *mechanism*, not final constants.
