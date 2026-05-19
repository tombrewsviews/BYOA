# Per-beat opacity & blend mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-beat `opacity` (0–1) and `blendMode` (16 CSS `mix-blend-mode` values) to KineticType so beats can fade and composite against beats on other tracks, videos, images, and the background.

**Architecture:** Two optional Zod fields on `beatSchema` (defaulting to no-op values `1` and `"normal"`). Applied uniformly via the existing `Stage` wrapper in `src/kinetic/beats.tsx` — every beat kind routes through `Stage`, so one render-side change covers all 9 beat kinds. Two new rows in the panel's `look` section using existing `Slider` and `Dropdown` primitives.

**Tech Stack:** TypeScript, React, Zod, Remotion, Vite (Studio dev server). No test runner in the repo today — verification is visual in the Studio dev build.

**Spec:** `docs/superpowers/specs/2026-05-17-beat-opacity-blend-design.md`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/kinetic/schema.ts` | Modify | Add `opacity` and `blendMode` Zod fields to `beatSchema` with no-op defaults. |
| `src/kinetic/beats.tsx` | Modify | Apply `opacity` and `mixBlendMode` to the inner positioned div in `Stage` so every beat kind picks them up. |
| `editor/panel.tsx` | Modify | Add two rows (opacity slider, blend dropdown) in the beat `look` section. |
| `editor/panel.tsx` | Modify | Declare a `BLEND_MODES` constant alongside the existing `DIRECTIONS` constant. |

No new files. No Rust changes. No migration code.

---

## Task 1: Add `opacity` and `blendMode` to `beatSchema`

**Files:**
- Modify: `src/kinetic/schema.ts` (extend the `--- look ---` section of `beatSchema`, around lines 299–330)

- [ ] **Step 1: Add the two new fields to `beatSchema`**

In `src/kinetic/schema.ts`, find the `--- look (tweakable) ---` comment block (around line 299). Right after the existing `shadowColor` field (around line 329) and before the `// --- morph-only ---` comment, add:

```ts
  /**
   * Beat opacity, 0..1. Multiplied with any animation-driven opacity
   * (e.g. exit fades), so user-set opacity caps the peak. Default 1
   * (no change).
   */
  opacity: z
    .number()
    .min(0)
    .max(1)
    .default(1)
    .describe("Beat opacity (0=invisible, 1=fully visible)"),
  /**
   * CSS `mix-blend-mode` applied to this beat. Lets the beat composite
   * against beats on lower tracks, videos, images, and the background.
   * Default "normal" (no change).
   */
  blendMode: z
    .enum([
      "normal",
      "multiply",
      "screen",
      "overlay",
      "darken",
      "lighten",
      "color-dodge",
      "color-burn",
      "hard-light",
      "soft-light",
      "difference",
      "exclusion",
      "hue",
      "saturation",
      "color",
      "luminosity",
    ])
    .default("normal")
    .describe("CSS mix-blend-mode applied to this beat"),
```

- [ ] **Step 2: Verify TypeScript still compiles**

Run: `npx tsc --noEmit`

Expected: no errors. The new fields are optional from a `story.json` standpoint (Zod fills defaults at parse time) and required on the inferred `Beat` type — which is fine because we only use them in code we control.

- [ ] **Step 3: Verify existing story.json still parses**

Run the Studio dev server (or just a one-shot parse) and confirm the existing `story.json` at the repo root loads without Zod errors:

```bash
node -e "const {storySchema} = require('./src/kinetic/schema.ts'); const fs = require('fs'); console.log(storySchema.safeParse(JSON.parse(fs.readFileSync('story.json','utf8'))).success);"
```

If the project uses ESM-only TS imports and that one-liner fails, instead launch `npm run tauri:dev` and confirm the editor opens the existing story without a parse error in the console. Either path works.

Expected: parses successfully; new fields are filled with their defaults (`opacity: 1`, `blendMode: "normal"`).

- [ ] **Step 4: Commit**

```bash
git add src/kinetic/schema.ts
git commit -m "feat(schema): add per-beat opacity and blendMode fields

Defaults to no-op values (1 and \"normal\") so existing story.json files
render bit-identically. Surfaced in the upcoming render and panel changes."
```

---

## Task 2: Apply `opacity` and `mixBlendMode` in `Stage`

**Files:**
- Modify: `src/kinetic/beats.tsx` (lines 66–97, the `Stage` component)

- [ ] **Step 1: Update the `Stage` inner div's style object**

In `src/kinetic/beats.tsx`, the `Stage` component currently looks like this (lines ~66–97):

```tsx
const Stage: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
  beat?: Beat;
}> = ({ children, style, beat }) => {
  const x = beat?.positionX ?? 0.5;
  const y = beat?.positionY ?? 0.5;
  const rot = beat?.rotation ?? 0;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          transform: `translate(-50%, -50%) rotate(${rot}deg)`,
        }}
      >
        {children}
      </div>
    </div>
  );
};
```

Modify the **inner** div's style (NOT the outer one — the outer one is what callers extend via the `style` prop, which already passes `transform` and `opacity` from animations). The result should be:

```tsx
const Stage: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
  beat?: Beat;
}> = ({ children, style, beat }) => {
  const x = beat?.positionX ?? 0.5;
  const y = beat?.positionY ?? 0.5;
  const rot = beat?.rotation ?? 0;
  const opacity = beat?.opacity ?? 1;
  const blendMode = beat?.blendMode ?? "normal";
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          // translate first to center on the anchor, then rotate around
          // the anchor point. The order matters — rotate after translate
          // would orbit the element around the canvas origin.
          transform: `translate(-50%, -50%) rotate(${rot}deg)`,
          // Beat-level opacity and blend mode. Opacity here MULTIPLIES with
          // any animation-driven opacity that callers pass through `style`
          // on the outer div (e.g. exit fades), giving the expected behavior:
          // user-set opacity caps the peak, animations still play.
          opacity,
          mixBlendMode: blendMode,
        }}
      >
        {children}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Verify TypeScript still compiles**

Run: `npx tsc --noEmit`

Expected: no errors. `mixBlendMode` is typed on `React.CSSProperties` and our union of 16 strings is assignable to it.

- [ ] **Step 3: Visual sanity check — defaults are no-op**

Launch `npm run tauri:dev` and open any existing project. With every beat at default values (`opacity: 1`, `blendMode: "normal"`), the canvas must render **bit-identically** to before this change. Compare side-by-side with `git stash` if unsure.

Expected: no visible difference.

- [ ] **Step 4: Visual check — non-default values do something**

Pick a beat in the existing `story.json` (e.g. the first one). Edit `story.json` directly to add `"opacity": 0.4` and `"blendMode": "screen"` to that beat object. Reload the Studio.

Expected: the beat appears at 40% opacity and visibly screens (lightens) against whatever sits beneath it. Then revert the `story.json` edit so the repo stays clean.

- [ ] **Step 5: Cross-track blending check (the risky one)**

This is the test that decides whether the spec's "approach A" works or whether we need the fallback. Pick two beats that overlap in time on different tracks (or create such an arrangement in the active project). Set the top-track beat to `blendMode: "multiply"` in `story.json`. Reload.

Expected: the top beat visibly multiplies against the bottom beat — you should see colors darken where they overlap. If they do NOT blend (the top beat looks unchanged), the spec's fallback kicks in: instead of applying `mixBlendMode` to the inner div in `Stage`, lift it to a wrapper around each `<Sequence>` in `src/kinetic/KineticStory.tsx`. Revert the `Stage` change and apply the wrapper instead before continuing.

After verifying (one path or the other), revert any `story.json` edits made for testing.

- [ ] **Step 6: Commit**

```bash
git add src/kinetic/beats.tsx
git commit -m "feat(render): honor beat.opacity and beat.blendMode in Stage

Applied on the inner positioned div so beat-level opacity multiplies with
animation-driven opacity (exit fades) and blend mode composites against
lower tracks, videos, images, and the background. All 9 beat kinds route
through Stage, so this single change covers them all."
```

If the cross-track fallback was needed, instead commit the `KineticStory.tsx` change with a message like `feat(render): apply beat opacity/blendMode at Sequence wrapper for cross-track compositing`.

---

## Task 3: Add `BLEND_MODES` constant in `panel.tsx`

**Files:**
- Modify: `editor/panel.tsx` (alongside the existing `DIRECTIONS` constant at line 28)

- [ ] **Step 1: Declare the constant**

In `editor/panel.tsx`, find the existing `DIRECTIONS` constant:

```ts
const DIRECTIONS = ["up", "down", "left", "right", "scale", "vertical-roll"] as const;
```

Immediately below it, add:

```ts
const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;
```

- [ ] **Step 2: Verify TypeScript still compiles**

Run: `npx tsc --noEmit`

Expected: no errors (constant is unused at this point — that's fine; Task 4 uses it).

- [ ] **Step 3: Commit**

This task's commit is bundled with Task 4 (one logical change — adding the UI rows pulls the constant in). Skip a standalone commit here and proceed directly to Task 4. (If you prefer atomic commits, commit now with message `chore(panel): add BLEND_MODES constant` — either is fine, but the bundled commit reads cleaner in `git log`.)

---

## Task 4: Add opacity + blend rows to the panel's `look` section

**Files:**
- Modify: `editor/panel.tsx` (insert after the existing `glow` row in the beat `look` section, around line 419)

- [ ] **Step 1: Locate the insertion point**

In `editor/panel.tsx`, find the existing `glow` row for **beats** (NOT the story-level glow at line 249 — we want the beat-level one at around line 411–419):

```tsx
<Row label="glow">
  <Slider
    value={beat.glow}
    min={0}
    max={60}
    step={2}
    onChange={(v) => onChange({ glow: v })}
  />
</Row>
<Row label="color">
  <ColorControl
    value={beat.color ?? fallbackTextColor}
    onChange={(v) => onChange({ color: v })}
  />
</Row>
```

We will insert two new rows BETWEEN the `glow` row and the `color` row — opacity first, then blend.

- [ ] **Step 2: Insert the opacity and blend rows**

After the `glow` `</Row>` and before the `color` `<Row label="color">`, insert:

```tsx
<Row label="opacity">
  <Slider
    value={beat.opacity}
    min={0}
    max={1}
    step={0.01}
    onChange={(v) => onChange({ opacity: v })}
  />
</Row>
<Row label="blend">
  <Dropdown
    value={beat.blendMode}
    options={BLEND_MODES}
    onChange={(v) => onChange({ blendMode: v as Beat["blendMode"] })}
  />
</Row>
```

This mirrors the surrounding `Slider` and `Dropdown` usage patterns exactly (see the `enter direction` row at line 356 for the Dropdown precedent).

- [ ] **Step 3: Verify TypeScript still compiles**

Run: `npx tsc --noEmit`

Expected: no errors. `BLEND_MODES` from Task 3 is now referenced; the `Beat["blendMode"]` cast picks up the union type from the schema added in Task 1.

- [ ] **Step 4: Visual check — slider works**

Run `npm run tauri:dev`. Select a beat. Find the new `opacity` row in the panel under `glow`. Drag the slider from 1 to 0.

Expected: the selected beat smoothly fades to invisible in the preview.

- [ ] **Step 5: Visual check — dropdown works**

Same beat. Find the new `blend` row. Change the dropdown from `normal` to `multiply`, then `screen`, then `difference`.

Expected: the beat's compositing visibly changes for each choice. `difference` should look distinctly inverted/bright; `multiply` should darken; `screen` should lighten.

- [ ] **Step 6: Visual check — values round-trip through save/reload**

Set a beat to `opacity: 0.5` and `blendMode: "overlay"` via the panel. Save (whatever the Studio's save flow is — typically auto-save on change). Quit and relaunch the dev server.

Expected: the beat reopens with `opacity: 0.5` and `blendMode: "overlay"` applied — both the panel controls and the rendered output reflect the saved values.

- [ ] **Step 7: Commit**

```bash
git add editor/panel.tsx
git commit -m "feat(panel): expose opacity slider and blend-mode dropdown per beat

Two new rows in the beat 'look' section, inserted between glow and color.
Opacity is a 0..1 slider; blend is a dropdown of all 16 CSS mix-blend-mode
values backed by the new BLEND_MODES constant."
```

---

## Task 5: Documentation + final sanity sweep

**Files:**
- (potentially) Modify: `CLAUDE.md` if there's a relevant doc note to add
- No new files

- [ ] **Step 1: Decide if CLAUDE.md needs an update**

Open `CLAUDE.md`. If it documents the beat schema or panel structure, add a one-liner under the appropriate section noting that beats now have `opacity` and `blendMode`. If it does NOT mention either (it's primarily gotchas / build notes today), skip — the schema doc-comments are the source of truth and we don't add docs for the sake of docs.

- [ ] **Step 2: Run the full TypeScript check one more time**

Run: `npx tsc --noEmit`

Expected: clean, no errors anywhere in the project.

- [ ] **Step 3: Render an export and confirm blends survive**

Render a short MP4 of a project that uses a non-default blend mode on at least one beat. Confirm the exported video shows the same blend you see in the Studio preview.

Expected: exported MP4 matches the live preview. (Remotion's headless Chromium and the Studio webview both implement `mix-blend-mode` the same way; this step exists to confirm there's no surprise like a missing CSS property in the bundle config.)

- [ ] **Step 4: Final commit (only if CLAUDE.md was changed in Step 1)**

```bash
git add CLAUDE.md
git commit -m "docs: note per-beat opacity and blendMode in CLAUDE.md"
```

If no doc change was needed, skip this commit — the feature is done.

---

## Verification summary

After all tasks:

- [ ] `npx tsc --noEmit` passes
- [ ] Existing `story.json` renders identically when both fields are at their defaults
- [ ] Setting `opacity: 0.5` on a beat halves its peak opacity in the Studio preview
- [ ] Setting `blendMode: "multiply"` on a top-track beat visibly multiplies against a lower-track beat below it
- [ ] All 16 blend modes appear in the panel dropdown and each produces a visibly different result on a suitable test composition
- [ ] An MP4 export reproduces the blends seen in the Studio preview
