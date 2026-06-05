# Spec → UI Translation Report — KineticType editor

## How spec→UI translation works in this repo, per layer

This repo's design spec is a **control plane, not a compiler**. Hand-written components *subscribe* to spec entries at specific points; changing a spec entry changes the UI only where code subscribed.

- **Token tier → runtime-bound.** The token tier is a set of CSS custom properties defined once in `editor/index.css` `:root` (`editor/index.css:11-34`). Tailwind v4's `@theme inline` block (`editor/index.css:72-95`) turns each `--token` into a utility class (`bg-primary`, `border-border`, `rounded-md`). Every ReUI/shadcn component and ~25 view files subscribe purely through those classes — **no JS imports the CSS-var plane.** Because the subscription is `var(--…)`, writing a new value onto `:root` repaints every subscriber on the next frame, with **no rebuild**. This is the tier made live in this task.
- **Variant/contract tier → build-bound.** Variants live as data in a single CVA table (`buttonVariants`, `editor/components/ui/button.tsx:7`) plus per-component class strings. Editing the table changes all instances at the next build; choosing which variant an instance uses is a per-call-site code change.
- **Pattern tier → transform-applied.** Cross-component patterns (error display, disclosure, focus feedback, validation timing) are structural; they change via codemod (propose → simulate → apply), not at runtime.
- **Principle tier → decomposed.** UX stances ("grey, no purple"; "one shared button rhythm") map to nothing the UI reads. They expand into lower-tier token/variant/pattern moves and are recorded as directives.

## Token-tier coverage: bound vs hard-coded

**Bound (live-editable now):** 19 tokens — 18 colors + 1 radius (which cascades to `--radius-sm/md/lg` via `calc`). These drive **all 6 contract components** and ~122 utility-class usages across ~25 files. Full inventory in `tokens.yaml`; subscriber map in `binding.manifest.yaml`.

**The dominant deviation — a second, unbound token plane.** `editor/platform/theme.ts` is a parallel JS token object (`color`/`radius`/`space`/`font` + `*Btn()` helpers) consumed as React **inline styles** across **11 files / ~112 `style={{}}` usages**. It is a *finer* palette (5 background shades, 5 text shades, 4 border shades) that **shares no names** with the CSS-var plane and is hand-mirrored to stay in sync (`editor/index.css:8`, `editor/platform/theme.ts:11`). Editing tokens in the control surface does **nothing** to anything styled through `theme.ts` — that is the deviation made visible.

**Top unbound offenders** (ranked, full list in `binding.manifest.yaml` Part 2):

1. **The whole `theme.ts` plane** — 11 importers, ~112 inline-style usages. Highest blast radius.
2. **Amber `#facc15`** — ~7 raw-hex sites for playhead / rotation handle / stale-preview / xterm cursor (`editor/timeline.tsx:992`, `editor/player.tsx:355`, `editor/terminal.tsx:79`, …). An accent that escaped the "no purple, grey" directive; never tokenized.
3. **Timeline clip discriminators** — `#1a2230` / `#231f29` / `#2c3a4e` / `#3a3340` (`editor/timeline.tsx:559-568`).
4. **AddVideo `menuBtn`/`errorStyle` literals** — `#2e2e3c`, `#e4e4ee`, `#ff8b8b`, `#3a1414`, `#5a2020` (`editor/AddVideo.tsx:367-380`).
5. **xterm terminal theme** — `editor/terminal.tsx:77-80`. Structurally unbindable: xterm colors are a JS API, so `var(--…)` cannot resolve there.

## What is live-testable now vs what requires a move/codemod

**Live now (token tier, runtime):** Open the editor, press **⌃⇧D**. Editing any of the 19 tokens writes onto `:root` and updates every Tailwind/ReUI subscriber instantly — button fills, slider range, switch, inputs, popovers, borders, and corner radius. "Copy diff" emits a `tokens.yaml` patch of only the changed entries (clipboard only; nothing persists). Proven by `editor/__tests__/dev-control-surface.test.tsx` (5 tests, green).

**NOT live (by design):**
- **Variant tier** — changing `buttonVariants` or which variant a button uses requires a build / code edit.
- **Pattern tier** — error/disclosure/validation structure requires a codemod.
- **Principle tier** — directives, not values.
- **The `theme.ts` plane and all hard-coded literals** above — require manual code edits (and the xterm sink can't be a CSS var at all). Watch the terminal background and timeline clips stay put while you recolor everything else — that contrast is the binding boundary, on screen.

## Open questions (the static pass could not bind)

- **Motion** (durations/easings) lives as literals — `"…120ms ease…"` in `theme.ts` `btnBase` and `transition-all` / `transition-[color,box-shadow]` utilities in the ui components. No motion token plane exists; a static CSS-var control can't bind it.
- **Type scale / spacing / elevation / z-index** are absent from the CSS-var plane (Tailwind defaults + `theme.ts` `font`/`space` literals + ad-hoc `z-[1000]`). Tokenizing them is a code change, not a binding.
- **Plane reconciliation** — should `theme.ts` eventually be generated from (or replaced by) the CSS-var plane? The repo's own comments say "keep the two in sync until later migration phases retire the inline styles" (`editor/platform/theme.ts:11`). Until then the two can drift silently; the control surface only governs one of them.
