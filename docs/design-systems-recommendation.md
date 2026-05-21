# Design-System / Component-Library Recommendation

**For:** KineticType editor UI
**Date:** 2026-05-21
**Status:** Recommendation — no code changed, this is a decision doc.

---

## TL;DR

**Adopt [Base UI](https://base-ui.com/) (the MUI team's headless successor to Radix-style primitives) as the component layer, and keep `editor/platform/theme.ts` as the single source of styling truth.** Base UI is headless (zero CSS shipped), it has a `Combobox`/`Autocomplete` and a `Slider`/`Dialog`/`Popover`/`Select`/`Tabs`/`Tooltip` that Radix lacks or under-serves, it went 1.0-stable in Feb 2026, and it lets you keep styling components with your existing token object instead of throwing it away for Tailwind. It is the lowest-migration-cost path that still gives the user "all possible components."

The rest of this doc shows the work.

---

## What we're replacing

Today every control in `editor/controls.tsx` is a raw HTML element (`<input type="range">`, `<select>`, `<input type="color">`) styled with inline `style={{...}}` objects that read from `editor/platform/theme.ts`. There is **no Tailwind, no CSS-in-JS runtime, no component framework** — just React 19.2 and a plain TS token object (`color.*`, `radius.*`, `space.*`, `font.*`, `primaryBtn()`, `secondaryBtn()`, `tabBtn()`).

That setup is honest and dependency-light, but it caps out fast:

- `Dropdown` is a native `<select>` — you cannot style its option menu, render icons/curve thumbnails inside options, or build a searchable combobox.
- `Slider` is a native `<input type="range">` — no two-thumb ranges, no custom track marks, weak keyboard story.
- There is **no drawer, no dialog/modal, no real popover, no tabs primitive, no tooltip** — all things the user explicitly asked for.
- Every control re-implements focus, keyboard nav, and ARIA from scratch (mostly: not at all).

The goal: a component library that supplies those interactions and a11y for free, **without** forcing a CSS-framework rewrite of the token system that already defines the app's dark, dense, pro-tool look.

### Why the Tauri context matters

The editor runs in a **Tauri 2 webview = a single, modern Chromium**. That removes the usual headless-vs-styled tiebreaker: there are **no legacy browsers to support**, so `:has()`, container queries, the native Popover API, and anchor positioning are all on the table. This makes headless libraries (which lean on modern CSS for positioning/layering) safe, and it means we are **not** forced into a heavyweight styled framework just to get cross-browser consistency.

---

## The five candidates (verified, 2026)

### 1. Radix UI Primitives + shadcn/ui
**One-liner:** The incumbent headless standard — copy-paste-able via shadcn — but development has slowed under WorkOS and it still has no first-party Combobox.

- **Coverage:** Select ✓, Slider ✓, Dialog ✓, Tabs ✓, Tooltip ✓, Popover ✓. **Drawer** = not first-party (shadcn ships one via the third-party `vaul` library). **Combobox/Autocomplete** = **the long-standing gap** — open since 2022 ([issue #1342](https://github.com/radix-ui/primitives/issues/1342)); shadcn fakes it by composing Popover + the `cmdk` Command component. ~30+ primitives.
- **Styling model:** Fully headless (ships behavior + ARIA, no styles). shadcn/ui layers Tailwind + CSS variables on top and copies source into your repo. Radix alone is style-agnostic.
- **Theming:** None of its own at the primitive level — you bring it. shadcn assumes Tailwind tokens.
- **Bundle:** Tree-shakeable per-component; tiny if you only import what you use.
- **React 19:** Supported, but the rollout was rough — `element.ref` deprecation warnings and slow fixes post-acquisition. Stable now.
- **License:** MIT.
- **Migration cost from inline styles:** **Medium-high.** Radix-alone is fine (style its `data-*` parts with your tokens), but the whole shadcn ecosystem the user would actually reach for assumes Tailwind — adopting that means introducing a CSS framework you don't have today.

### 2. Base UI (MUI team)  ← **recommended**
**One-liner:** The spiritual successor to Radix, built by the people who made Radix, Floating UI, and Material UI; headless, 1.0-stable since Feb 2026, and it ships the Combobox/Autocomplete Radix never did.

- **Coverage:** **35 components** including Select ✓, Slider ✓, Dialog ✓, Tabs ✓, Tooltip ✓, Popover ✓, **Combobox ✓, Autocomplete ✓** (the headline win vs Radix), plus Menu, Context Menu, Number Field, OTP/PIN, Toast, Scroll Area, Navigation Menu, Preview Card, Field/Form. **Drawer**: there is no component literally named "Drawer," but a side drawer is built from `Dialog` + the modern CSS / animation hooks (the same pattern Radix users use `vaul` for). No other notable gaps for this app.
- **Styling model:** **Fully headless** — zero CSS shipped. It exposes `data-*` state attributes and lets you style with *anything*: plain CSS, CSS Modules, or **inline styles driven by your existing `theme.ts`**. This is the key fit: you do not have to adopt a CSS framework.
- **Theming:** None imposed — your tokens are the theme. Style via `className`/`style` on each part, reading from `theme.ts`.
- **Bundle:** Tree-shakeable; pulls Floating UI for positioning. Reasonable per-component footprint.
- **React 19:** Yes. `peerDependencies` is `^17 || ^18 || ^19` and the team targets current React; 1.0 shipped in the React-19 era. Works with React 19.2.
- **License:** MIT.
- **Migration cost from inline styles:** **Lowest of the headless options.** Because it's unstyled and accepts `style`/`className`, you can wrap each Base UI primitive and pass your `theme.ts` objects through almost verbatim — the same CSSProperties you already write. No Tailwind, no CSS-in-JS runtime required.
- **Caveat:** the package was renamed `@base-ui-components/react` → `@base-ui/react` around 1.0 — install the new name.

### 3. Ark UI (Chakra team)
**One-liner:** The widest, framework-agnostic headless set (45+ components, built on Zag.js state machines), unusual extras like Signature Pad / PIN Input / Splitter — but more machinery than this single-framework app needs.

- **Coverage:** **45+ components** — Select ✓, Slider ✓, Dialog ✓, Tabs ✓, Tooltip ✓, Combobox ✓, Popover ✓, plus a true **Splitter** (handy for an editor's resizable panes) and rarities like Signature Pad, PIN Input, Color Picker, Date Picker. **Drawer**: built from `Dialog` (same pattern). Broadest catalog of the five.
- **Styling model:** **Fully headless**, framework-agnostic (React/Vue/Solid/Svelte) via Zag.js. Style with anything, including your tokens.
- **Theming:** None imposed — you bring styling (Park UI, below, is the styled layer on top).
- **Bundle:** Heavier per-component than Radix/Base UI because each component drags in its Zag.js state machine; the cross-framework abstraction is overhead you don't use in a React-only Tauri app.
- **React 19:** Yes — current `@ark-ui/react` (5.36.x line, mid-2026) tracks React 19.
- **License:** MIT.
- **Migration cost from inline styles:** **Medium.** Headless and token-friendly like Base UI, but its `render`-prop / `asChild` composition and Zag.js machines are a steeper API surface, and you pay for multi-framework portability you'll never use.

### 4. Mantine (batteries-included, styled)
**One-liner:** A complete, opinionated, *styled* 120+ component suite with its own theming — fastest to a polished result, but it brings its own look and CSS-Modules system that would sit awkwardly beside `theme.ts`.

- **Coverage:** **120+ components** — everything: Slider + RangeSlider ✓, Select + Combobox (with virtualization) ✓, Drawer ✓ (a real, named Drawer — the only candidate that ships one out of the box), Modal/Dialog ✓, Tabs ✓, Tooltip ✓, Popover ✓, plus color pickers, date pickers, rich text, notifications, charts. Zero gaps for this app.
- **Styling model:** **Styled**, via **CSS Modules + native CSS variables** (Emotion was dropped in v7; no runtime CSS-in-JS). Components arrive pre-styled; you override via CSS variables, the `styles`/`classNames` props, or CSS Modules.
- **Theming:** First-class `MantineProvider` + theme object exposing CSS variables (`--mantine-color-*`). You'd map `theme.ts` values into that theme.
- **Bundle:** Largest of the five — it's a full suite, though tree-shakeable per import.
- **React 19:** **Mantine 9.0 (released 31 Mar 2026) requires React 19.2+** — a direct match for this project's `react@^19.2`. (Mantine 8.x supports older React.)
- **License:** MIT.
- **Migration cost from inline styles:** **High in philosophy, low in effort-to-first-result.** You'd get drawers/sliders working in an afternoon, but you'd be running *two* styling systems (your inline tokens + Mantine's CSS Modules/variables) and re-skinning Mantine's default look to match the dark pro-tool aesthetic. It pulls the project away from "tokens are the source of truth," not toward it.

### 5. Park UI (Ark UI + Panda CSS)
**One-liner:** A beautifully pre-styled, copy-paste (shadcn-style, you-own-the-source) layer over Ark UI — but it's wedded to **Panda CSS**, a build-time CSS framework this project doesn't have.

- **Coverage:** Inherits Ark UI's 45+ (Select ✓, Slider ✓, Dialog/Drawer ✓, Tabs ✓, Tooltip ✓, Combobox ✓, Popover ✓). Same broad catalog as Ark UI, pre-designed.
- **Styling model:** **Styled via Panda CSS** (a zero-runtime, build-time CSS-in-JS / token engine). Components are distributed as **source you copy in** (CLI or copy-paste), shadcn-style, so you own and edit them. Historically a Tailwind variant has also been offered, but Panda CSS is the documented primary.
- **Theming:** Panda CSS token system + recipes. You'd port `theme.ts` into Panda's token config.
- **Bundle:** Ark UI runtime + Panda's generated CSS (build-time, no runtime cost).
- **React 19:** Yes (rides Ark UI / React).
- **License:** MIT.
- **Migration cost from inline styles:** **Highest.** It mandates adopting **Panda CSS** — a whole build-time styling framework and its codegen — on top of learning Ark UI. That's the biggest leap from today's "plain inline styles" baseline of any option here.

---

## Side-by-side

| | Radix + shadcn | **Base UI** | Ark UI | Mantine | Park UI |
|---|---|---|---|---|---|
| **Model** | Headless (shadcn adds Tailwind) | **Headless** | Headless (Zag.js) | **Styled** (CSS Modules) | Styled (Panda CSS) |
| **# components** | ~30+ | 35 | 45+ | 120+ | 45+ (Ark-based) |
| **Dropdown / Select** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Combobox / Autocomplete** | ✗ first-party (compose) | **✓** | ✓ | ✓ (virtualized) | ✓ |
| **Slider** | ✓ | ✓ | ✓ | ✓ (+Range) | ✓ |
| **Drawer** | via `vaul` | via Dialog | via Dialog | **✓ named** | ✓ |
| **Dialog / Tabs / Tooltip / Popover** | ✓ / ✓ / ✓ / ✓ | ✓ / ✓ / ✓ / ✓ | ✓ / ✓ / ✓ / ✓ | ✓ / ✓ / ✓ / ✓ | ✓ / ✓ / ✓ / ✓ |
| **CSS framework required?** | Tailwind (in practice) | **None** | None | Its own CSS Modules | **Panda CSS** |
| **Keeps `theme.ts` as-is?** | Partly | **Yes** | Yes | No (its theme system) | No (Panda tokens) |
| **React 19.2** | ✓ | ✓ | ✓ | ✓ (9.0 *requires* it) | ✓ |
| **License** | MIT | MIT | MIT | MIT | MIT |
| **Migration cost from inline styles** | Med-high | **Low** | Medium | High (dual system) | Highest |

---

## Recommendation: Base UI

For *this* app, weigh the constraints:

1. **Inline styles + `theme.ts` are the source of truth, and migration cost matters.** The two styled options (Mantine, Park UI) each impose their *own* styling system (CSS Modules / Panda CSS) and a default look you'd fight to make dark-pro-tool. That sidelines `theme.ts`. The headless options (Radix, Base UI, Ark UI) let your tokens stay in charge. **Base UI is the headless option with the cleanest "pass a `style`/`className` object through" story** — i.e., it accepts exactly the `CSSProperties` you already author.

2. **The user wants Combobox + everything.** Radix — the obvious incumbent — *still* has no first-party Combobox and no named Drawer, and its momentum stalled post-WorkOS. Base UI ships the Combobox/Autocomplete Radix never did, plus Select/Slider/Dialog/Tabs/Tooltip/Popover and 28 more, all from the team that *originally built Radix*. You get Radix's design quality without Radix's gaps or its stall.

3. **Ark UI is the close runner-up** — even more components and a `Splitter` that'd suit an editor's resizable panes. But its Zag.js machines and multi-framework abstraction are weight and API surface this React-only Tauri app doesn't need. If you later want the Splitter or exotic inputs (color/date pickers), Ark UI is the natural escalation; Base UI covers everything in the current panel.

4. **Tauri removes the only real headless risk.** Headless libraries rely on modern CSS for positioning/layering; in a single Chromium webview that's a non-issue, so the lighter, unstyled choice carries no downside.

5. **Versioning lines up.** Base UI is 1.0-stable (Feb 2026), MIT, and supports React 19 — matching `react@^19.2`.

**If the priority were "fully built, fastest, don't care about the dual styling system," Mantine** (9.0, React-19.2-required, a real named Drawer, 120+ components) would be the pick — note it for a future reassessment. But it pulls *against* the token-driven approach this codebase is built on, so it's the wrong fit *today*.

---

## Phased adoption path (reuse `theme.ts`, stay incremental)

The whole point is to keep `editor/platform/theme.ts` as the styling brain and let Base UI supply only behavior + a11y. Each control stays a thin wrapper that consumes your tokens — same public props (`value`, `onChange`) the panel already calls, so `panel.tsx` barely changes.

### Phase 0 — Bridge the tokens (no UI change)
- Add `@base-ui/react` as a dependency.
- Create a tiny style-adapter alongside `controls.tsx` that maps `theme.ts` tokens to the `style`/`className` each Base UI part needs (track, thumb, popup, item, etc.). Base UI parts expose `data-*` state attrs (`data-highlighted`, `data-checked`, `data-disabled`); style those off your existing `color.bg.hover`, `color.bg.selected`, `color.border.strong`, etc. **No new color/spacing values invented — the bridge only re-points existing tokens.**

### Phase 1 — Migrate the highest-pain control first: `Dropdown`
- It's the weakest today (native `<select>`, unstylable menu) and the most-used in `panel.tsx` (kind, direction, blend mode, shader style, ken-burns dir, bg kind).
- Replace its internals with Base UI `Select`, styling the trigger and popup from `theme.ts`. Keep the exact `{ value, options, onChange }` signature so every call site in `panel.tsx` is untouched.
- This single swap proves the bridge end-to-end and immediately enables icons / richer items later.

### Phase 2 — `Slider`, then `ColorControl`
- Swap `Slider`'s `<input type="range">` for Base UI `Slider` (better keyboard + track styling, and a path to two-thumb ranges if needed for in/out points). Keep the paired numeric `<input>` as-is.
- For `ColorControl`, keep the native `<input type="color">` for now (it works); optionally later wrap a Base UI `Popover` around a richer swatch picker.

### Phase 3 — New components the panel doesn't have yet
- **Tabs:** replace the hand-rolled `tabBtn()` switcher with Base UI `Tabs` (keep `tabBtn()`'s styles as the `className`).
- **Drawer / Dialog:** build a left/right Drawer from Base UI `Dialog` for things like a settings or media panel; build modals (confirm-destructive, export options) from `Dialog`/`Alert Dialog`.
- **Tooltip + Popover:** add tooltips to icon buttons; move `EasingPicker` / advanced controls into a `Popover` to de-clutter dense rows.
- **Combobox:** for searchable lists (e.g. font/blend-mode selection as those grow), use Base UI `Combobox` — the capability the old native `<select>` and Radix both lacked.

### Phase 4 — Consolidate buttons
- Wrap `primaryBtn()` / `secondaryBtn()` / `ghostBtn()` into a single Base UI-friendly `<Button variant size>` component (the user asked for "good size buttons") that still returns your token styles. Optional, cosmetic — do it last.

### Keeping it incremental
- One control per PR. The wrapper-with-same-signature approach means `panel.tsx` and `controls.tsx`'s public API stay stable while internals change underneath — you can ship Base UI'd controls and inline-styled controls side by side indefinitely. No big-bang rewrite, and `theme.ts` stays the single source of styling truth throughout.

---

## Links

| Library | Homepage | Component catalog / docs |
|---|---|---|
| Radix UI Primitives | https://www.radix-ui.com/primitives | https://www.radix-ui.com/primitives/docs/overview/introduction |
| shadcn/ui | https://ui.shadcn.com/ | https://ui.shadcn.com/docs/components |
| **Base UI** | https://base-ui.com/ | https://base-ui.com/react/overview/quick-start (components in the left nav) |
| Ark UI | https://ark-ui.com/ | https://ark-ui.com/docs/components/accordion (components in left nav) |
| Mantine | https://mantine.dev/ | https://mantine.dev/core/package/ |
| Park UI | https://park-ui.com/ | https://park-ui.com/docs/components |

### Sources consulted (2026)
- Base UI 1.0 release — https://www.infoq.com/news/2026/02/baseui-v1-accessible/ , https://github.com/mui/base-ui , https://www.npmjs.com/package/@base-ui/react
- Radix Combobox gap / WorkOS slowdown — https://github.com/radix-ui/primitives/issues/1342 , https://www.pkgpulse.com/guides/shadcn-ui-vs-base-ui-vs-radix-components-2026
- Ark UI — https://ark-ui.com/ , https://github.com/chakra-ui/ark , https://www.npmjs.com/package/@ark-ui/react
- Mantine 9 / React 19.2 / CSS Modules — https://mantine.dev/changelog/9-0-0/ , https://mantine.dev/styles/css-modules/
- Park UI / Panda CSS — https://park-ui.com/docs/introduction , https://github.com/cschroeter/park-ui
- Headless landscape — https://www.greatfrontend.com/blog/top-headless-ui-libraries-for-react-in-2026 , https://blog.logrocket.com/headless-ui-alternatives/
