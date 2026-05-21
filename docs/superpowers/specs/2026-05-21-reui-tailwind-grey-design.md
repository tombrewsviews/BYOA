# Adopt ReUI + Tailwind v4, grey scheme, consistent icons — Phase 1

**Date:** 2026-05-21
**Status:** Approved-pending-review

## Goal

Restyle the Kinetic Studio UI toward a neutral dark-grey aesthetic using
ReUI components (Base UI flavor) on a new Tailwind v4 foundation, with a
single icon library (lucide-react) replacing the current emoji/unicode glyphs.

This is **Phase 1 of a multi-phase migration**. This phase stands up the whole
foundation and proves it end-to-end by migrating ONE surface — the properties
panel — to ReUI. The rest of the app turns grey this pass (via tokens) but
keeps its existing inline-styled components until later phases.

## Decisions (locked)

- **Component library:** ReUI (shadcn-style copy-paste registry), **Base UI**
  flavor of each component.
- **Styling foundation:** Tailwind CSS v4 + shadcn-style CSS-variable tokens.
- **Icons:** `lucide-react`.
- **Palette:** neutral dark grey (Tailwind neutral/zinc dark scale), single
  restrained grey-white accent. Applied globally this pass.
- **Phase 1 migration target:** the properties panel (`editor/panel.tsx` +
  `editor/controls.tsx`) — Dropdown, Slider, Select, color, the typography
  controls.

## Why this shape

ReUI hard-requires Tailwind; there is no Tailwind-free path. The app today has
zero Tailwind and ~14 files styled via the `editor/platform/theme.ts` token
object + inline styles. Rather than a risky big-bang rewrite, Phase 1 builds
the foundation and migrates the single highest-value, self-contained surface
(the panel) so the entire pipeline — Tailwind build, token theming, Base UI
primitives, ReUI components, icons — is verified before sweeping the rest.

Crucially, the app's CHROME accent is already grey-white (`#fafafa`); the
purple/pink is story *content* color, untouched. So "grey" mostly means
shifting the slightly-blue darks to true neutral and formalizing tokens.

---

## Architecture

### Tailwind v4 in the editor Vite build

- Add `tailwindcss` v4 + `@tailwindcss/vite` plugin to `vite.editor.config.ts`
  (Tailwind v4 uses a Vite plugin, not a PostCSS config).
- Create `editor/index.css` as the Tailwind entry: `@import "tailwindcss";`
  plus the `@theme`/`:root` CSS-variable token block (grey scheme, light+dark)
  and `tw-animate-css` for component animations.
- Import `./index.css` at the top of `editor/main.tsx`.
- The Tauri app loads `editor/dist`; Tailwind's Vite plugin emits the compiled
  CSS into that build automatically. The webview is Chromium-only, so Tailwind
  v4's modern-CSS output is safe.

### Token system — one source, two consumers

The grey palette is defined ONCE as CSS variables (shadcn names:
`--background`, `--foreground`, `--card`, `--popover`, `--primary`,
`--border`, `--input`, `--ring`, `--muted`, `--muted-foreground`,
`--accent`, plus ReUI's `--success/--warning/--info/--destructive`). Then:

- **ReUI/Tailwind components** read the CSS variables directly (via Tailwind
  utility classes like `bg-background`, `text-foreground`).
- **Existing inline-styled components** keep reading `editor/platform/theme.ts`.
  We update `theme.ts`'s hex values to the SAME grey scheme so both consumers
  match. `theme.ts` stays the source for inline styles; the CSS variables are
  the source for Tailwind. They are kept in sync by hand (documented), with
  the grey hex values as the shared truth. This is a deliberate, temporary
  duplication for the migration window — later phases delete inline styles as
  components move to ReUI, and the CSS variables become the sole source.

### ReUI registry setup

- Add a `components.json` (shadcn config) with the ReUI registry namespace
  (`"@reui": "https://reui.io/r/{style}/{name}.json"`) and Base UI style.
- ReUI components are pulled via the shadcn CLI as **owned source** into
  `editor/components/ui/`. We commit them. No `reui` npm dependency.
- Required runtime deps the components import: `@base-ui-components/react`
  (Base UI), `lucide-react`, `class-variance-authority`, `clsx`,
  `tailwind-merge`, `tw-animate-css`. Add a `editor/lib/utils.ts` with the
  standard `cn()` helper.

### Icons

- Add `lucide-react`. Create `editor/icons.ts` re-exporting the specific icons
  used (so the rest of the app imports from one place and swapping later is a
  one-file change).
- Phase 1 replaces emoji/unicode in the PANEL and the immediately-adjacent
  chrome the panel work touches. A full icon sweep of every file
  (timeline ↑/↓, transport ▶/⏸, header ←, export ⏳, StarterCard ×) is
  enumerated as a follow-up checklist but only the panel-region icons are
  required to land this phase. (We will, however, replace the editor header's
  Export/Projects and the panel's controls icons since they're in scope.)

---

## Components in Phase 1

Migrate the properties panel controls to ReUI (Base UI flavor):

| Current (`controls.tsx`) | ReUI replacement |
|--------------------------|------------------|
| `Dropdown` (native `<select>`) | ReUI **Select** |
| `Slider` (native range + number) | ReUI **Slider** (keep the numeric readout) |
| `ColorControl` (native color + hex) | Keep native color input, restyle hex field with ReUI **Input** |
| `TextInput` | ReUI **Input** |
| `Row` scaffold | Keep (layout only), retoned to grey |
| `EasingPicker` | Keep (bespoke SVG curves); retone to grey |

The panel's typography controls (font Select, weight/width/slant sliders,
animate toggle → ReUI **Switch** or **Checkbox**, static-weight Select) use the
migrated controls. Behavior is unchanged — same props, same `onChange`
contract — only the rendering swaps. This keeps `panel.tsx`'s logic and the
`typography-axes.ts` helpers untouched.

### Boundaries

- `editor/components/ui/*` — owned ReUI component source (Select, Slider, Input,
  Switch, etc.). One file per component, the ReUI convention.
- `editor/lib/utils.ts` — `cn()` only.
- `editor/icons.ts` — curated lucide re-exports.
- `editor/index.css` — Tailwind entry + token variables.
- `editor/controls.tsx` — rewritten to wrap ReUI components but keep the SAME
  exported API (`Row`, `Slider`, `Dropdown`, `ColorControl`, `TextInput`,
  `EasingPicker`) so `panel.tsx` and any other importer is unaffected.

This last point is the key isolation move: by preserving `controls.tsx`'s
public API, the migration is invisible to `panel.tsx`. Consumers don't change.

---

## Grey palette (neutral dark)

Expressed as both CSS variables (for Tailwind/ReUI) and `theme.ts` hex (for
inline). Target values (dark mode is the default; a light block is defined for
completeness but the app runs dark):

```
--background:        #0a0a0a   (was #08080c)   bg.canvas
--card / surface:    #121212   (was #0a0a10)   bg.surface
--popover/raised:    #18181a   (was #0f0f18)   bg.raised
hover:               #1e1e20   (was #14141e)
--secondary/selected:#242427   (was #1a1a24)   bg.selected
--border:            #2a2a2c   (was #232330)   border.line
border.strong:       #3a3a3d   (was #2e2e3c)
--foreground:        #fafafa   (unchanged)     text.primary
--muted-foreground:  #9a9a9d   (was #8b8b9a)   text.muted
dim:                 #6e6e72   text.dim
--primary/accent:    #fafafa   (unchanged grey-white)
--ring:              rgba(250,250,250,0.22)
--destructive:       #f87171 / bg #2a1414
```

All blue/purple tint removed from chrome (e.g. `#232330` → `#2a2a2c`). Story
content colors (textColor, accentColor, etc. in the kinetic schema) are NOT
touched — those are user data, not chrome.

---

## Error handling

- Tailwind/ReUI is additive; if a ReUI component fails to import, the build
  fails loudly at compile time (caught before runtime). The existing
  `RootErrorBoundary` in `main.tsx` still wraps the app.
- Behavior contracts are preserved (same `onChange` signatures), so panel logic
  can't silently break — only visuals change.

## Testing

- **Build:** `npm run build:editor` must succeed (proves Tailwind v4 plugin +
  ReUI components + Base UI compile in this Vite setup).
- **Typecheck:** `npx tsc --noEmit` clean.
- **Unit:** existing `typography-axes` tests still pass (logic untouched). The
  panel has no component tests today; we don't add jsdom tests for ReUI
  components in Phase 1 (Base UI portals + Tailwind classes are awkward under
  jsdom and low-value) — we rely on build + manual verification instead.
- **Manual:** run `npm run tauri:dev`; verify the panel renders with ReUI
  Select/Slider/Input/Switch, the grey scheme applies app-wide, icons render
  (no emoji in the panel region), and every panel control still edits the
  story (font switch, axis sliders, color, easing, all beat params).
- **Render unaffected:** the composition (`src/`) is not touched, so MP4
  export and the preview are unchanged; a quick still-render confirms no
  regression.

## Non-goals (this phase)

- Migrating timeline, transport, projects view, chat, library, FirstRun,
  StarterCard, Library, PromptModeBar, App shell to ReUI (later phases).
- A full icon sweep of every unicode glyph (only panel-region this phase).
- Light-mode theme switching UI (palette defined, but the app stays dark).
- Removing `theme.ts` (it remains the inline-style source during migration).

## Follow-up phases (recorded, not built now)

- Phase 2: header + transport + timeline → ReUI + full icon sweep.
- Phase 3: projects view, chat, library, FirstRun.
- Phase 4: retire inline styles where fully migrated; CSS variables become the
  single token source; delete the `theme.ts` ↔ CSS-var duplication.
