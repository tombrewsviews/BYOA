# Kinetic Studio batch: typography controls, MP4 export, UI polish + design-system research

**Date:** 2026-05-21
**Status:** Approved-pending-review

This spec covers a batch of seven related-but-independent tasks against the
Kinetic Studio editor. They are grouped here because they ship together, but
each is implemented and committed atomically.

## Tasks at a glance

| # | Task | Type | Backend? |
|---|------|------|----------|
| 1 | Typography controls (font family + wght/wdth/slnt) in panel **and** via agent | Feature | No (schema + render already support it) |
| 2 | Bundle 4 more open-source variable fonts | Feature | No (static files) |
| 3 | Export composition as MP4 | Feature | **Yes** (new Rust command) |
| 4 | Project-view header path → click opens Finder folder | Tweak | No (`project_reveal` exists) |
| 5 | Remove white scrollbar from terminal view | Tweak | No |
| 6 | Remove "Claude Code /path" line from top of chat view | Tweak | No |
| 7 | Chat toggle label → "Chat · Claude Code" (current agent name) | Tweak | No |
| 8 | Research & recommend design systems / component libraries | Research doc | No |

---

## Task 1 — Typography controls

**Key finding:** the rendering pipeline already fully supports per-beat
`fontFamily` and animated `axes` (`wght` / `wdth` / `slnt`). See
`src/kinetic/beats.tsx` (`fontVariationSettings`, `fontFamilyCss`) and
`src/kinetic/glyphs.ts` (`FONT_REGISTRY`, `FONT_AXIS_BOUNDS`). The schema
(`src/kinetic/schema.ts`) defines `beat.fontFamily`, `beat.axes`, and
`story.fontFamily`. **None of these are exposed in the properties panel.**

So Task 1 is purely a panel-UI task. The agent prompt path already works:
Claude owns the sequence and edits `story.json` directly, so it can already
set font family/axes. We will (a) make the panel surface them and (b) make
sure the schema descriptions are clear enough for the agent to use them well
(they already are).

### Panel changes (`editor/panel.tsx`)

**Per-beat (`BeatEditor`), new "Typography" section:**
- `font` — Dropdown over the font-family enum (overrides story default).
  Default shows the story font; an explicit pick sets `beat.fontFamily`.
- `weight` — Slider bound to `wght`. Stored as `axes.wght = [v, v]`
  (static) by default. An "animate" toggle reveals a second slider for the
  end value (`axes.wght = [start, end]`).
- `width` — Slider bound to `wdth`, same static/animate pattern.
- `slant` — Slider bound to `slnt`, same pattern.

Each axis slider's min/max comes from `FONT_AXIS_BOUNDS[family]`. When the
selected font does not vary an axis (e.g. width on InterVF), the slider is
disabled and shows the fixed value — no silent no-ops.

**Story-level (`StoryEditor`), in the Palette section:**
- `font` — Dropdown setting `story.fontFamily` (the default for all beats).

### New shared control

`controls.tsx` already has `Slider` and `Dropdown`. The axis "static vs
animate" pattern is small enough to live inline in `panel.tsx` as a local
`AxisControl` helper rather than a new exported control — it is panel-specific
(knows about the `[start, end]` tuple convention), so it stays in `panel.tsx`.

### Clamping

Reuse the existing clamp logic conceptually: when the user switches a beat to
a font that does not support the current axis value, the value is clamped to
that font's bounds on the next edit. The renderer already clamps at paint
time (`beats.tsx` `clamp(...)`), so a stale stored value never renders wrong;
the panel clamp just keeps the slider honest.

---

## Task 2 — Bundle four more variable fonts

Add Fraunces, Bricolage Grotesque, Instrument (Serif + Sans), and Archivo
(+ Archivo Expanded), all SIL OFL.

### Steps
1. Download each family's **variable** `.ttf` into `public/fonts/`.
   - Fraunces: `Fraunces.ttf` (opsz, wght, soft, wonk axes)
   - Bricolage Grotesque: `BricolageGrotesque.ttf` (opsz, wght, wdth)
   - Instrument Sans: `InstrumentSans.ttf` (wght, wdth) — Instrument Serif is
     not variable (single weight), so we ship Instrument **Sans** as the
     variable family and note Serif is static if added later.
   - Archivo: `Archivo.ttf` (wght, wdth — full 62–125 width range)
2. Extend `fontFamilySchema` enum in `schema.ts` with the new keys.
3. Add `FONT_REGISTRY` entries (file + cssFamily) and `FONT_AXIS_BOUNDS`
   entries (real per-family axis ranges) in `glyphs.ts`.
4. The `@font-face` block in `KineticStory.tsx` iterates `FONT_REGISTRY`
   automatically — no change needed there.

### Risk
`opentype.js` parses each font for the morph beat's first-letter outline. A
font whose default instance parses fine (all of the above do) is safe. We
verify each parses by loading it in the running app at least once.

---

## Task 3 — Export composition as MP4

**Approach:** new Rust command shells out to the Remotion CLI, mirroring the
`download_youtube` streaming pattern in `video.rs`.

### Backend (`src-tauri/src/video.rs` + register in `lib.rs`)

New command `export_video(state, app) -> Result<String, String>`:
- Resolves the active project path (same `active_path` helper).
- Spawns `npx remotion render` (or the project-local
  `node_modules/.bin/remotion`) targeting the kinetic composition, pointing
  `--props` at the project's `story.json` and writing the MP4 into the
  project folder (e.g. `<project>/export.mp4`, uniquified like
  `unique_assets_path`).
- Returns a job id immediately; streams progress on
  `video://export-progress`, completion on `video://export-done` (with the
  output path), errors on `video://export-error` — same shape as yt-dlp.
- The render must run from the **app's** project root (where `remotion.config.ts`
  and the composition live), not the user's project folder, but read the
  user project's `story.json` as input props and write the MP4 to the user
  project folder. Concretely: `cwd` = app install/repo dir; `--props` =
  absolute path to user `story.json`; `--output` = user-project MP4 path.

### Composition wiring

Remotion renders a registered composition (see `src/Root.tsx`). We pass the
user's `story.json` as input props so the render matches what the editor
shows. Confirm `Root.tsx`'s composition id and that it accepts the story as
props (it already uses `calculateMetadata` + `storyDurationInFrames`).

### Frontend (`KineticApp.tsx` editor header)

- An **Export** button next to the project path in the editor header.
- On click: invoke `export_video`, set a "rendering…" state, listen for
  progress/done/error.
- Progress shows inline in the header (percentage or last line) — reuse the
  existing error banner styling for a transient status line; no new modal.
- On done: call `project_reveal` on the output path's folder (reuse existing
  command) so the finished MP4 is shown in Finder.
- On error: surface via the existing `setError` banner.

### Non-goals (v1)
- No format/quality/codec picker (modal deferred).
- No in-app playback of the exported file.
- No cancellation button (yt-dlp flow also has none today; can follow).

---

## Task 4 — Header path opens Finder folder

`editor/canvases/kinetic/KineticApp.tsx` editor header (~line 567-577) renders
`project.path` as a plain `<span>`. Make it a button/clickable element that
calls `invoke("project_reveal", { path: project.path })`. The Rust command
already exists (`projects.rs:252`, runs `open <path>`). Style: keep the
monospace dim look, add hover underline + pointer cursor + `title="Reveal in
Finder"`. Browser mode (path = "(browser mode)") renders non-clickable.

---

## Task 5 — Remove white terminal scrollbar

The xterm viewport renders a bright native scrollbar (visible white bar in
the screenshot). Add scoped CSS to hide/dark-style it. Two-pronged:
- WebKit: `[data-terminal-root] .xterm-viewport::-webkit-scrollbar { width: 0 }`
  (or a thin dark thumb).
- Firefox/other: `scrollbar-width: none` on `.xterm-viewport`.

Where to put it: a small `<style>` injected by the Terminal component, or a
shared CSS string. Given the app styles inline elsewhere, inject a scoped
`<style>` tag once in `terminal.tsx`. The terminal still scrolls via
wheel/keys; we only hide the visual bar. Verify scrolling still works after.

---

## Task 6 — Remove "Claude Code /path" line from chat view

`editor/agent-chat/SessionToolbar.tsx` renders `agentLabel` + `cwd` + a
Clear button. Per the request, remove this top line from the chat view. The
agent name moves to the Chat toggle label (Task 7), and the project path is
already shown in the editor header. Options considered:
- **Chosen:** drop the `cwd` span and the `agentLabel` span from the
  toolbar, keeping only the "Clear" button (right-aligned). This empties the
  toolbar's left side; we keep the toolbar bar for the Clear action but it no
  longer shows the redundant agent/path line.
- If removing the whole bar reads cleaner once the labels are gone, collapse
  it and move "Clear" elsewhere — decide visually during implementation.

The empty-state hint inside the chat body ("Message Claude Code to get
started…") still names the agent, so identity isn't lost.

---

## Task 7 — Chat toggle label shows current agent

`KineticApp.tsx` has Terminal/Chat toggle buttons (~line 727-756). The Chat
button label becomes `Chat · <agentLabel>` (e.g. "Chat · Claude Code"),
using the existing `agentLabelFor(defaultAgentId)` helper that already
resolves "claude" → "Claude Code". When no agent is detected it falls back
to "Claude Code" (matching the Chat component's own default).

The label must stay compact in a 360px-wide column; if it overflows, keep
"Chat" as the button text and show the agent name as a smaller suffix.

---

## Task 8 — Design-system research doc

Deliverable: `docs/design-systems-recommendation.md`. Research current React
component libraries that provide the full kit the user wants (dropdowns,
sliders, drawers, well-sized buttons, and more), evaluated against this app's
real constraints:
- Tauri webview (Chromium) — modern CSS is fine.
- Today the UI is **inline-styled, no Tailwind, no CSS framework** (see
  `controls.tsx`, `panel.tsx`, `platform/theme.ts` token object).
- Dark, dense, pro-tool aesthetic.
- React 19.

Compare (at least): Radix UI / shadcn-ui, Base UI (MUI's headless), Ark UI
(Chakra's headless), Mantine, Park UI. For each: components offered, styling
model, headless vs styled, bundle/footprint, theming fit, and migration cost
from inline styles. End with a recommendation and a rough adoption path.
No code migration in this task — research and recommendation only.

---

## Implementation order

1. UI tweaks (4, 5, 6, 7) — fast, independent, low risk. One commit each or
   grouped.
2. Typography panel + story font (1).
3. Bundle fonts (2).
4. MP4 export (3) — backend + frontend.
5. Research doc (8) — can run in parallel via a sub-agent.

## Testing

- Unit/where present: the repo uses Vitest. Add/extend tests where there is
  existing coverage (agent-chat has tests; panel does not). Typography axis
  clamping logic, if extracted to a pure helper, gets a unit test.
- Manual: run `npm run tauri:dev`, verify each tweak visually, render an
  export end-to-end, switch fonts and scrub.
- `npm run test` must pass.
