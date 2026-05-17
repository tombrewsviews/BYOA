# Per-beat opacity & blend mode

Date: 2026-05-17
Status: design approved, ready for plan

## Goal

Let users set per-beat `opacity` (0–1) and `blendMode` (the full set of 16 CSS `mix-blend-mode` values) in the Studio panel, so beats can fade and composite against beats on lower tracks, against background images/videos, and against the gradient/shader background.

## Scope

In scope:

- Per-beat opacity and blend mode.
- All 16 CSS `mix-blend-mode` values: `normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`, `hue`, `saturation`, `color`, `luminosity`.
- Applies uniformly to all 9 beat kinds (reveal, morph, generativeFill, tile, oscillate, cinema, shape, imageClip, videoClip).
- Surfaced in the existing `look` section of `editor/panel.tsx`.

Out of scope:

- Track-level blend modes (compositing whole groups of beats as one layer).
- Background-element blend modes (blending the gradient/shader against beats).
- Animated/keyframed opacity or blend mode over the course of a beat.
- New beat-grouping primitives.

## Design

### 1. Schema (`src/kinetic/schema.ts`)

Add two optional fields to `beatSchema` inside the `--- look ---` section, alongside `glow` and `shadowLayers`:

```ts
opacity: z
  .number()
  .min(0)
  .max(1)
  .default(1)
  .describe("Beat opacity (0=invisible, 1=fully visible)"),

blendMode: z
  .enum([
    "normal", "multiply", "screen", "overlay",
    "darken", "lighten", "color-dodge", "color-burn",
    "hard-light", "soft-light", "difference", "exclusion",
    "hue", "saturation", "color", "luminosity",
  ])
  .default("normal")
  .describe("CSS mix-blend-mode applied to this beat"),
```

Both default to no-op values so every existing `story.json` renders bit-identically.

### 2. Render application (`src/kinetic/beats.tsx`)

Modify the `Stage` component's inner positioned div (currently at lines ~83–92). Add two style properties:

```tsx
<div
  style={{
    position: "absolute",
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    transform: `translate(-50%, -50%) rotate(${rot}deg)`,
    opacity: beat?.opacity ?? 1,
    mixBlendMode: beat?.blendMode ?? "normal",
  }}
>
```

Rationale for choosing the **inner** div (not the outer Stage div):

- Several beat renderers (`reveal`, `generativeFill`, `tile`, etc.) already pass `style={{ transform: exit.transform, opacity: opacity * exit.opacity }}` to Stage's outer div. Putting our opacity there would collide.
- The inner div is currently untouched by callers, so it's safe to own.
- Final opacity becomes `(exit.opacity from animation) × (beat.opacity from user)` — exit fades still play, but user-set opacity caps the peak. This matches expected behavior from After Effects / Figma.
- Blend mode lives on the same element as opacity so it always sees post-opacity pixels.

### 3. Cross-track blending guarantee

For two beats on different tracks to blend, neither can sit inside an isolated stacking context above the other.

Today in `KineticStory.tsx`, beats are rendered inside Remotion `<Sequence>` components, which produce plain absolutely-positioned divs with no `isolation: isolate` and no `transform` on the Sequence wrapper itself. So a beat on track 2 with `blendMode: "multiply"` will multiply against the beat on track 0 underneath it AND against the background.

**Fallback if cross-track blending does not visually work in practice:** move opacity and `mixBlendMode` up to a wrapper around each `<Sequence>` in `KineticStory.tsx`. This is approach C from the brainstorming session, kept on standby.

### 4. Panel UI (`editor/panel.tsx`)

Add two rows in the existing **look** section, right after the `glow` row (~line 411). Pattern matches surrounding rows:

```tsx
<Row label="opacity">
  <NumberSlider
    value={beat.opacity}
    min={0}
    max={1}
    step={0.01}
    onChange={(v) => onChange({ opacity: v })}
  />
</Row>
<Row label="blend">
  <Select
    value={beat.blendMode}
    options={[
      "normal", "multiply", "screen", "overlay",
      "darken", "lighten", "color-dodge", "color-burn",
      "hard-light", "soft-light", "difference", "exclusion",
      "hue", "saturation", "color", "luminosity",
    ]}
    onChange={(v) => onChange({ blendMode: v })}
  />
</Row>
```

Use whatever number-slider and select primitives `panel.tsx` already uses; do not introduce new components. If `panel.tsx` falls back to Zod-schema-driven control generation for some beat kinds, those will also auto-surface the fields, which is fine — the explicit Row entries above just guarantee placement next to other look controls.

Order: `opacity` first, then `blend`. Opacity is the more common knob.

## Back-compat

- No migration needed. Zod's `.default()` fills missing fields at parse time.
- Existing `story.json` in the repo: unchanged. Defaults make new fields no-ops.
- No `normalizeBeat` change.

## Render-path notes (Remotion)

- `mix-blend-mode` is pure CSS, no Remotion-specific concerns.
- Works in Chromium (Studio webview and headless render).
- Frame-rendering for MP4 export uses headless Chromium, so exports include blends correctly.
- Known Chromium quirk: `mix-blend-mode: difference` with `position: fixed` ancestors can be inconsistent. None of the wrappers here use `position: fixed`, so we are clear.

## Testing

1. Load existing `story.json` → render is visually identical to before (defaults are no-ops).
2. Set `opacity: 0.5` on one beat → beat is half-faded throughout its time window.
3. Combine `opacity: 0.5` with an exit fade → final opacity multiplies (peak 0.5, ends near 0).
4. Two beats on different tracks overlapping in time; top beat set to `blendMode: "multiply"` → visibly multiplies against lower beat. **This is the cross-track test. If it fails, switch to approach C (wrap each `<Sequence>` in `KineticStory.tsx`).**
5. Blend a text beat over a `videoClip` beat underneath → text blends with moving video frames during export.
6. Render an MP4 export with blend modes set → exported video matches Studio preview (no headless-vs-live divergence).

## Edge cases

- `opacity: 0` → beat is invisible but still occupies its time slot. Intentional, matches Figma/AE.
- `blendMode: "multiply"` over solid black → invisible. Expected; user fixes by changing background or blend.
- Drag-to-reposition: opacity/blend live on the same inner div as transform, but the drag handler reads `positionX/Y` from beat state, not from DOM measurement. No interaction.

## Files touched

- `src/kinetic/schema.ts` — add two fields (~25 lines including doc comments).
- `src/kinetic/beats.tsx` — two new style properties on `Stage`'s inner div.
- `editor/panel.tsx` — two new Row entries in the look section.

No Rust changes. No new components. No migration code.
