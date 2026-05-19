# Shell restyle — design spec

Date: 2026-05-20
Status: draft

## Goal

Apply a unified visual style across the KineticType shell (platform titlebar, The Square, Kinetic editor chrome) modeled on the reference design in `design/`. Replace the current big-card marketplace grid with an App Store-style list and a click-to-open detail drawer. Do not change any layout that works — only restyle, plus the one structural change to the Square (sidebar + list + drawer in place of the centered card grid).

## Non-goals

- No change to the Kinetic editor's grid (terminal / preview / timeline / panel) — only its borders, buttons, and colors.
- No change to terminal internals (xterm theming is its own world).
- No change to Remotion player canvas contents or beat block visuals (those are domain content).
- No real GitHub fetch. The install flow is mocked via `setTimeout`; persistence is `localStorage`.
- No typography change beyond what tokens encode (no monospace font — the reference's mono look is approximated with weight, letter-spacing, and `font-variant-numeric: tabular-nums`).

## Decisions (locked from brainstorming)

1. **Restyle scope**: sans-only restyle across the whole shell — no monospace font swap.
2. **Drawer behavior**: hidden by default; opens on icon or row body click; closes on `×`, Esc, or clicking the active row again. Open/Install button on the row does not open the drawer.
3. **Accent**: grayscale + **white** (no purple, no blue dot).
4. **Button system**: three variants — primary (white on dark), secondary (transparent + hairline border), ghost (no border).
5. **Sidebar data**: static + derived from manifest fields. Adds `releasedAt`, `sizeBytes`, `category` to `AppManifest`. Optional `skills` and `runtime`.
6. **Install flow**: mocked progress; full state machine with `localStorage` persistence.
7. **Search vs. sidebar**: search overrides the active sidebar filter (typing pulls the user out of the section into a global search result).
8. **Drawer + filter coherence**: if the selected app is filtered out of the visible list, the drawer closes.

## Theme tokens — `editor/platform/theme.ts` (new)

Pure data + a few style helpers. No React imports.

### Color tokens

```
bg.canvas    = #08080c
bg.surface   = #0a0a10
bg.raised    = #0f0f18
bg.hover     = #14141e
bg.selected  = #1a1a24

border.faint = #1a1a24
border.line  = #232330
border.strong= #2e2e3c
border.hover = #3a3a4a

text.primary    = #fafafa
text.secondary  = #e4e4ee
text.muted      = #8b8b9a
text.dim        = #6b6b80
text.faint      = #5a5a6e

accent.fg       = #fafafa
accent.bg       = #08080c
accent.dot      = #fafafa
accent.focus    = rgba(250,250,250,0.18)

danger.bg       = #3a1414
danger.border   = #5a2020
danger.text     = #ffb4b4
```

### Scales

- Spacing: `2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40`.
- Radii: `sm=4, md=6, lg=8, xl=10, pill=999`.
- Type sizes: `10, 11, 12, 13, 14, 18, 36`.
- Font family: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` (unchanged).

### Button helpers

Three exported functions returning `React.CSSProperties`:

```
primaryBtn({ size?: 'sm'|'md' = 'md' })
  bg #fafafa, color #08080c, font 13, weight 700, padding 10/14, radius 6
  hover: subtle inset shadow rgba(0,0,0,0.04)

secondaryBtn({ active?: boolean })
  bg transparent, border 1px #2e2e3c, color #e4e4ee, font 11, weight 600,
  padding 6/12, radius 6, hover border #3a3a4a
  active: bg #1c1c26, color #fafafa

ghostBtn
  bg transparent, border 0, color #8b8b9a, font 11, padding 6/8
  hover bg #14141e, color #e4e4ee
```

Plus a `tabBtn(active: boolean)` for the editor's terminal/secondary tab switcher (already a one-off pattern that doesn't fit the three variants).

## Install lifecycle — `editor/platform/install.ts` (new)

### State

```ts
type InstallState = 'not-installed' | 'installing' | 'installed' | 'failed';

type InstallRecord = {
  state: InstallState;
  progress: number;       // 0..1, meaningful during 'installing'
  installedAt: string | null;
  error: string | null;
};
```

Persisted at `localStorage['platform.install.<appId>']` as JSON. In-memory store mirrors localStorage and notifies subscribers on change.

### Special case: bundled apps

If `findApp(id).Root` is truthy in the manifest (the app's code ships with the binary — kinetic today), `getInstallState(id)` always returns `{ state: 'installed', progress: 1, installedAt: <build time>, error: null }` regardless of localStorage. The user cannot uninstall a bundled app from the UI.

### Public API

```ts
getInstallState(appId: string): InstallRecord
useInstallState(appId: string): InstallRecord     // React hook, subscribes
startInstall(appId: string): void                  // idempotent; no-op if installed/installing
cancelInstall(appId: string): void                 // installing -> not-installed
uninstall(appId: string): void                     // installed (non-bundled) -> not-installed
```

`startInstall` walks progress 0 → 1 over ~2000ms in ~40ms ticks, then sets state to `installed` and `installedAt` to `new Date().toISOString()`. On any thrown error during the walk, sets `failed` with the error message. (Errors are not expected from the mock, but the path exists for parity with a real fetch.)

### Button label matrix

```
status         lifecycle        label                       click
---------------------------------------------------------------------
available      installed        Open                        mount Root
available      not-installed    Install · {size}            startInstall
available      installing       Installing… {pct}%          cancelInstall
available      failed           Retry install               startInstall
coming-soon    —                Coming soon (disabled)      —
```

`{size}` formats `sizeBytes` as KB / MB / GB with one decimal (e.g. `4.1 MB`).

## Square — three-column layout

Replaces `editor/platform/Square.tsx`.

### Layout

- Sidebar (220px, fixed) | List (flex) | Drawer (360px, conditionally rendered when `selectedAppId !== null`).
- All three columns are inside the existing platform title bar wrapper from `editor/App.tsx`.

### Sidebar — `editor/platform/Sidebar.tsx` (new)

```
[ Search… (32px tall) ]

BROWSE
  • Featured
    New this week
    Most prompted
    Coming soon

CATEGORIES
    Video & Motion
    Audio
    3D & Render
    Writing
    Data
    Devtools

INSTALLED
    Kinetic Studio
```

- Section header: `10/uppercase/text.dim/letter-spacing 0.5`, top margin 20px (first section has none).
- Row: button-like div, `padding 6/12, font 13, color text.secondary`. Active row: `color text.primary`, weight 600, leading `•` in `accent.dot`. Inactive rows have a 6px leading space so labels line up.
- Search: full-width `bg.raised` input, hairline `border.line`, radius `md`, height 32, placeholder `text.dim`. On focus, border → `border.hover`.

### Filter state

```ts
type Filter =
  | { kind: 'browse'; key: 'featured' | 'new' | 'most' | 'soon' }
  | { kind: 'category'; name: string }
  | { kind: 'installed'; appId: string };
```

Default: `{ kind: 'browse', key: 'featured' }`.

### Filter semantics

- `browse.featured` → all apps (any status).
- `browse.new` → apps with `releasedAt` within last 7 days.
- `browse.most` → all apps, sorted by `tokens` desc.
- `browse.soon` → `status === 'coming-soon'`.
- `category.{name}` → apps whose `category` matches.
- `installed.{appId}` → single-app filter. Used by the "Installed" sidebar entries — clicking jumps the list to that one app AND opens the drawer.

### Search override

When `searchValue.trim() !== ''`, the active sidebar filter is ignored. Results are computed against ALL apps via name/blurb/tag match. Sidebar visually shows the previously active row, but the list rendering uses the search predicate only. Clearing the search box restores the filter.

### Sort

Top of the center pane shows `{n} results · sort: {sortLabel} {direction}`. The direction glyph is a tiny ghost-styled button (`↓` / `↑`). Sort options for v1: `featured` (manifest order), `new` (releasedAt desc), `tokens` (desc). `most` filter forces `tokens` sort. Sort state is in-memory; resets on reload.

### Center pane

- 60px header: filter display name at `36/800/-1`, sub-line at `12/text.muted`. Single `0 32px` horizontal padding column with `maxWidth: 920` so the rows don't stretch beyond reading width on wide windows.
- List: vertical stack, gap 8. Each row is `<AppRow>`.

### App row — `editor/platform/AppRow.tsx` (new)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [■]   Kinetic Studio                                       [   Open   ] │
│       Agent-native kinetic typography · altramanera · v0.1.0            │
└─────────────────────────────────────────────────────────────────────────┘
```

- Container: `bg.raised`, hairline `border.line`, radius `lg`, padding 12/14, full width.
- Icon (44×44): square with `background: hsl({hue}, 70%, 38%)`, radius `lg`. First letter of `name` centered, 18/800 white at 60% opacity. Click → opens drawer.
- Title block (flex 1, click → opens drawer): name `14/700/text.primary`, sub-line `12/text.muted` showing `{blurb} · {creator} · v{version}`.
- Button (right): `<InstallButton app={app}>` — uses `useInstallState`. Stops click propagation so it does NOT open the drawer.
- Hover: container border → `border.hover`.
- Selected (this app is in the drawer): container `bg.selected`, border stays `border.line`.

### App drawer — `editor/platform/AppDrawer.tsx` (new)

- 360px wide, `bg.surface`, left border `border.line`. Takes layout space when open (the list flexes to fit), does not overlay.
- Header row: `App` label (10/uppercase/text.dim), `×` ghost button on the right.
- App identity block: 32×32 colored icon + name (`14/700/text.primary`) + `app.{id}.v{version}` (`11/text.dim/letter-spacing 0.2/tabular-nums`). Favorite star (small) on the right.
- Collapsible sections (chevron `^` toggles, all start expanded):
  - **Identity**: Name, Author, Version.
  - **Bundle**: Tokens, Files, Lines, Size.
  - **Skills** (only if `manifest.skills` set): one row per skill, value `on` / `off`.
  - **Runtime** (only if `manifest.runtime` set): Model, Context, Effort.
- Footer: full-width primary button driven by `useInstallState(app.id)`. Label/behavior per the button matrix above.
- Section state: in-memory, resets on reload.
- Key/value row: label `12/text.muted` left, value `12/text.primary/tabular-nums` right.

### Selected app behavior

- `selectedAppId: string | null`. Default `null`.
- Click icon or row body → set `selectedAppId = app.id`.
- Click `×`, Esc, or the currently-selected row → set `selectedAppId = null`.
- Click a different row → `selectedAppId` swaps; drawer contents change in place.
- After filter or search changes, if `selectedAppId` is set and that app is not in the filtered list → `selectedAppId = null` (drawer closes).

## Manifest additions — `editor/platform/apps.ts`

Fields added to `AppManifest`:

```ts
releasedAt: string;        // ISO date
sizeBytes: number;
category:
  | 'video-motion'
  | 'audio'
  | '3d-render'
  | 'writing'
  | 'data'
  | 'devtools';
skills?: { name: string; on: boolean }[];
runtime?: { model: string; context: string; effort: string };
```

Existing entries get filled values:

- **kinetic**: `category: 'video-motion'`, `sizeBytes: 4_100_000`, `releasedAt: '2026-05-10'`, `skills: [{ name: '/gsd:update', on: true }, { name: '/beat:add', on: true }, { name: '/palette', on: true }, { name: '/export', on: true }]`, `runtime: { model: 'Opus 4.7', context: '1M', effort: 'xhigh' }`.
- **tonebench**: `category: 'audio'`, `sizeBytes: 2_900_000`, `releasedAt: '2026-04-22'`, no skills/runtime.
- **voxel**: `category: '3d-render'`, `sizeBytes: 5_400_000`, `releasedAt: '2026-04-30'`, no skills/runtime.

Categories drive the sidebar's "Categories" section: each category appears only if at least one app maps to it.

## Editor chrome restyle (Kinetic app)

No layout changes. Only restyling.

### `editor/canvases/kinetic/KineticApp.tsx`

- `TopBarBtn` deleted in favor of `secondaryBtn` from `theme.ts`.
- Top bar background, border, project-name color, path color → tokens.
- Tab buttons (terminal / secondary) → `tabBtn(active)` helper.
- `⌥C` chip → tokens (no shape change).
- Focus rings on the three zones (terminal, panel, timeline): color changes from `#7c5cff` to `accent.focus` (rgba white at 18% opacity).
- Error banner colors → `danger.*` tokens.
- Loading state colors → tokens.

### `editor/panel.tsx`

Colors, borders, buttons through tokens and variants. Property value cells get `font-variant-numeric: tabular-nums`. Number input focus border → `border.hover` (was purple).

### `editor/timeline.tsx`

Colors, borders, buttons through tokens. Time readout gets tabular-nums. Playhead color stays.

### `editor/player.tsx`

Transport buttons through the variant system; colors through tokens.

### `editor/canvases/kinetic/ProjectsView.tsx`

Project rows adopt the same shape as `AppRow` visually (not a shared component — different data). Restyle only.

### `editor/FirstRun.tsx`

Tokens + button variants. Cosmetic only.

### `editor/Library.tsx`

Tokens + button variants. Cosmetic only.

### `editor/UndoMenu.tsx`

Adopt `ghostBtn`.

### Out of scope

- `editor/terminal.tsx` (xterm theming).
- Remotion canvas content.
- Beat block visuals in the timeline (domain content).

## Files

### Added (5)

- `editor/platform/theme.ts`
- `editor/platform/install.ts`
- `editor/platform/Sidebar.tsx`
- `editor/platform/AppRow.tsx`
- `editor/platform/AppDrawer.tsx`

### Changed (10)

- `editor/platform/Square.tsx` — rewritten as thin orchestrator (~150 LOC, down from 565).
- `editor/platform/apps.ts` — manifest fields added.
- `editor/App.tsx` — titlebar tokens.
- `editor/canvases/kinetic/KineticApp.tsx` — chrome tokens + button variants.
- `editor/canvases/kinetic/ProjectsView.tsx` — list restyle.
- `editor/panel.tsx` — tokens + variants.
- `editor/timeline.tsx` — tokens + variants.
- `editor/player.tsx` — Transport variants.
- `editor/Library.tsx` — tokens + variants.
- `editor/FirstRun.tsx` — tokens + variants.
- `editor/UndoMenu.tsx` — ghost variant.

### Removed (within `Square.tsx`)

- `Card`, `Stars`, `StatRow`, `StatsPanel` (subsumed by new components).
- Favorites toolbar button (favorite moves into drawer).
- 16/9 colored hero band (replaced by 44×44 icon square).

## Acceptance

- The Square renders sidebar + list + (conditional) drawer.
- Default filter is `browse.featured`; default sort is `featured ↓`.
- Search box overrides any sidebar filter while non-empty.
- Clicking an app's icon or row body opens the drawer.
- Clicking the row's `Open` / `Install · …` button does NOT open the drawer.
- Clicking `Install` on a not-installed app: button label cycles `Install` → `Installing… {pct}%` → `Open` over ~2s, persisted in localStorage.
- Clicking `Open` on an installed available app mounts its `Root` via the existing `onOpen` callback.
- Drawer closes when its app is filtered out of the visible list.
- Kinetic top bar, panel, timeline, transport, projects view all use the new tokens; no purple anywhere.
- Focus rings on the three zones are low-opacity white instead of purple.
- All `<button>` instances across restyled files use one of the three variants (or the `tabBtn` helper for the one-off pattern).
