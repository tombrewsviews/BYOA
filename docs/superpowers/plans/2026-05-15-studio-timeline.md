# Studio Timeline + Selection-Driven Properties + Terminal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold `app/` into `editor/` and turn the editor into a four-pane studio (terminal · preview · timeline · properties) with selection-driven property editing, full transport/keyboard controls, a live timeline playhead, and an embedded PTY-backed terminal that can run `claude`.

**Architecture:** A CSS-Grid shell (`editor/App.tsx`) owns three pieces of state — `story`, `selection`, `savedJson` — and a `playerRef`. The Timeline subscribes to the player's `frameupdate` event for its own playhead (so high-frequency frame updates don't cascade into Panel/Player). Selection is a tagged union (`{ kind: "story" } | { kind: "beat"; index }`); the Panel renders one of two bodies based on it. Player transport buttons + window-level keyboard shortcuts drive `playerRef` directly. The terminal is `xterm.js` in the browser talking over WebSocket to a `node-pty` shell spawned by a Vite plugin in `vite.editor.config.ts`.

**Tech Stack:** React 19, TypeScript, Vite 6, `@remotion/player`, `xterm` + `xterm-addon-fit` + `xterm-addon-web-links`, `node-pty`, `ws`.

**Spec:** `docs/superpowers/specs/2026-05-15-studio-timeline-design.md`

**Repo note:** This repo is currently NOT a git repository (`.gitignore` exists but no `.git`). All "commit" steps assume git has been initialised first (Task 0). If git init is refused by the user, skip the commit steps and continue — the plan still works.

---

## File map

```
editor/
  App.tsx          MODIFY — shell: grid layout, state (story/selection),
                   keyboard shortcuts, save handler
  panel.tsx        MODIFY — selection-driven body; remove all-beats list
  player.tsx       CREATE — <PlayerStage> + <Transport>
  timeline.tsx     CREATE — Story track + Beats track + live playhead
  terminal.tsx     CREATE — xterm client, WebSocket to /__terminal
  controls.tsx     UNCHANGED
  main.tsx         UNCHANGED
  index.html       UNCHANGED

vite.editor.config.ts
                   MODIFY — add terminalPlugin: WebSocket /__terminal → node-pty

package.json       MODIFY — add deps, remove "player"/"build:player" scripts
README.md          MODIFY — drop player run line, document studio layout
.gitignore         MODIFY — add docs/superpowers if user wants it ignored (no)

app/               DELETE
vite.config.ts     DELETE (the player one at root)
index.html         DELETE (the player entry at root)
```

---

## Task 0: Initialise git (if not already) and snapshot baseline

**Files:**
- Create: `.git/` (via `git init`)
- No code files modified

- [ ] **Step 1: Confirm repo state**

Run: `git rev-parse --is-inside-work-tree 2>/dev/null || echo "not a git repo"`
Expected: prints `not a git repo` (or `true` if already initialised — then skip to Step 4)

- [ ] **Step 2: Ask the user before initialising git**

Ask:
> "This repo isn't a git repository yet. The plan's commit steps assume git. OK to `git init` and stage the current state as the baseline commit, or should we skip commits entirely?"

If the user says skip: mark all "Step: Commit" steps in this plan as skipped, and continue without git.

If the user says yes: proceed.

- [ ] **Step 3: Initialise and make a baseline commit**

Run:
```bash
git init
git add -A
git commit -m "chore: baseline before studio refactor"
```
Expected: a commit is created. Do NOT include `.env` — verify `.gitignore` already excludes it (line in `.gitignore`).

- [ ] **Step 4: Verify clean tree**

Run: `git status`
Expected: `nothing to commit, working tree clean`

---

## Task 1: Add a `Selection` type and lift it into App.tsx (no UI change yet)

This task introduces the selection state, plumbs it through the existing Panel as a prop (still rendering everything for now), and adds a clamp `useEffect`. No visual change — we just want the state to exist and the panel to accept the new prop. Splitting this from Task 2 keeps each commit small.

**Files:**
- Modify: `editor/App.tsx` — add `Selection` type, `useState`, clamp effect, pass to Panel
- Modify: `editor/panel.tsx` — accept `selection` prop (unused for now)

- [ ] **Step 1: Add the `Selection` type and state in App.tsx**

In `editor/App.tsx`, just after the `FPS` constant (line 30), add:

```tsx
export type Selection =
  | { kind: "story" }
  | { kind: "beat"; index: number };
```

Inside `App`, after `const playerRef = useRef<PlayerRef>(null);` (line 36), add:

```tsx
const [selection, setSelection] = useState<Selection>({ kind: "story" });
```

- [ ] **Step 2: Add the clamp effect**

In `editor/App.tsx`, immediately after the existing `useEffect` that loads `story.json`, add:

```tsx
useEffect(() => {
  if (!story) return;
  if (selection.kind === "beat" && selection.index >= story.beats.length) {
    setSelection({ kind: "story" });
  }
}, [story, selection]);
```

- [ ] **Step 3: Pass selection to the Panel**

In `editor/App.tsx`, update the `<Panel>` JSX (around line 114) to:

```tsx
<Panel
  story={story}
  selection={selection}
  onSelect={setSelection}
  onChange={setStory}
  dirty={dirty}
  onSave={handleSave}
/>
```

- [ ] **Step 4: Update Panel props (no body change yet)**

In `editor/panel.tsx`, update the import block (line 14):

```tsx
import React from "react";
import type { Story, Beat } from "../src/kinetic/schema";
import type { Selection } from "./App";
import type { EasingName } from "../src/typography/easings";
```

Update the `Panel` component's props (line 103):

```tsx
export const Panel: React.FC<{
  story: Story;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onChange: (story: Story) => void;
  dirty: boolean;
  onSave: () => void;
}> = ({ story, selection, onSelect, onChange, dirty, onSave }) => {
```

The body still renders everything as before — we'll fix that in Task 3. `selection` and `onSelect` are unused this commit; that's fine.

- [ ] **Step 5: Verify the studio still runs unchanged**

Run: `npm run editor`
Expected: editor opens, shows the existing all-beats panel, player works. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add editor/App.tsx editor/panel.tsx
git commit -m "feat(editor): introduce Selection state, plumb to Panel (no UI change)"
```

---

## Task 2: Extract `<PlayerStage>` and add `<Transport>` (player.tsx)

Move the existing `PlayerStage` from `App.tsx` into its own file, and add the four transport buttons ported from `app/App.tsx`.

**Files:**
- Create: `editor/player.tsx`
- Modify: `editor/App.tsx` — import from new file, render `<Transport>` above stage

- [ ] **Step 1: Create `editor/player.tsx`**

Create the file with:

```tsx
/**
 * The studio's preview pane: the <Player> stage plus a transport toolbar.
 *
 * Best practices applied (matches the original app/App.tsx):
 *  - PlayerStage is isolated from forms/sliders so playhead updates don't
 *    re-render the rest of the studio.
 *  - Transport buttons call play()/pause()/seekTo() through playerRef and
 *    pass the real MouseEvent into play(e) to stay in user-gesture context.
 */
import React, { useCallback } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { KineticStory } from "../src/kinetic/KineticStory";
import type { Story } from "../src/kinetic/schema";

export const PlayerStage: React.FC<{
  inputProps: Story;
  durationInFrames: number;
  fps: number;
  playerRef: React.RefObject<PlayerRef | null>;
}> = React.memo(({ inputProps, durationInFrames, fps, playerRef }) => (
  <div
    style={{
      height: "62vh",
      aspectRatio: "9 / 16",
      borderRadius: 14,
      overflow: "hidden",
      boxShadow: "0 24px 70px rgba(0,0,0,0.6)",
      border: "1px solid #232330",
    }}
  >
    <Player
      ref={playerRef}
      component={KineticStory}
      inputProps={inputProps}
      durationInFrames={durationInFrames}
      compositionWidth={1080}
      compositionHeight={1920}
      fps={fps}
      style={{ width: "100%", height: "100%" }}
      controls
      loop
      autoPlay
    />
  </div>
));
PlayerStage.displayName = "PlayerStage";

export const Transport: React.FC<{
  playerRef: React.RefObject<PlayerRef | null>;
  durationInFrames: number;
}> = ({ playerRef, durationInFrames }) => {
  const onPlay = useCallback(
    (e: React.MouseEvent) => playerRef.current?.play(e),
    [playerRef],
  );
  const onPause = useCallback(() => playerRef.current?.pause(), [playerRef]);
  const onStart = useCallback(() => playerRef.current?.seekTo(0), [playerRef]);
  const onEnd = useCallback(
    () => playerRef.current?.seekTo(Math.max(0, durationInFrames - 1)),
    [playerRef, durationInFrames],
  );

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        padding: "6px 8px",
        background: "#0e0e14",
        border: "1px solid #232330",
        borderRadius: 8,
      }}
    >
      <TBtn onClick={onStart} label="⏮ Start" />
      <TBtn onClick={onPlay} label="▶ Play" />
      <TBtn onClick={onPause} label="⏸ Pause" />
      <TBtn onClick={onEnd} label="⏭ End" />
    </div>
  );
};

const TBtn: React.FC<{
  onClick: (e: React.MouseEvent) => void;
  label: string;
}> = ({ onClick, label }) => (
  <button
    onClick={onClick}
    style={{
      background: "#1c1c26",
      border: "1px solid #2e2e3c",
      borderRadius: 6,
      color: "#e4e4ee",
      fontSize: 12,
      padding: "5px 10px",
      cursor: "pointer",
    }}
  >
    {label}
  </button>
);
```

- [ ] **Step 2: Remove the old `PlayerStage` from App.tsx and import from player.tsx**

In `editor/App.tsx`:

Remove lines 124–153 (the local `PlayerStage` component definition).

Update the import block — replace the `Player`/`PlayerRef` import with:

```tsx
import { Player, type PlayerRef } from "@remotion/player"; // keep — playerRef typing only
import { PlayerStage, Transport } from "./player";
```

(Note: `Player` import is still needed in App.tsx ONLY if you reference the type elsewhere. Since we only need `PlayerRef`, simplify to:)

```tsx
import { type PlayerRef } from "@remotion/player";
import { PlayerStage, Transport } from "./player";
```

Also remove the now-unused `KineticStory` import in App.tsx.

- [ ] **Step 3: Render Transport above PlayerStage in App.tsx**

Replace the preview-side `<div>` block (currently lines 87–111) with:

```tsx
<div
  style={{
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
    minWidth: 0,
  }}
>
  <Transport
    playerRef={playerRef}
    durationInFrames={durationInFrames}
  />
  <PlayerStage
    inputProps={story}
    durationInFrames={durationInFrames}
    fps={FPS}
    playerRef={playerRef}
  />
  <div style={{ fontSize: 11, color: "#4b4b5a" }}>
    {story.beats.length} beats ·{" "}
    {(durationInFrames / FPS).toFixed(1)}s · 1080×1920
  </div>
</div>
```

- [ ] **Step 4: Verify the studio runs with Transport visible**

Run: `npm run editor`
Expected: four buttons (Start / Play / Pause / End) appear above the player. Click each — Play/Pause toggles playback; Start jumps to 0; End jumps to the last frame.

- [ ] **Step 5: Commit**

```bash
git add editor/player.tsx editor/App.tsx
git commit -m "feat(editor): extract PlayerStage and add Transport toolbar"
```

---

## Task 3: Make the Panel selection-driven

Split the Panel body into a Story view and a single-beat view based on `selection`. Remove the all-beats list and the `<Card>` scaffold.

**Files:**
- Modify: `editor/panel.tsx`

- [ ] **Step 1: Replace the Panel body**

Open `editor/panel.tsx`. Replace the entire return statement of `Panel` (lines 119–404) with:

```tsx
  return (
    <div
      style={{
        background: "#0e0e14",
        borderLeft: "1px solid #232330",
        height: "100%",
        overflowY: "auto",
        padding: 16,
        boxSizing: "border-box",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {/* header + save */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: "#e4e4ee" }}>
          {selection.kind === "story"
            ? "Story"
            : `${selection.index + 1}. ${story.beats[selection.index]?.text ?? ""}`}
        </span>
        <button
          onClick={onSave}
          disabled={!dirty}
          style={{
            fontSize: 11,
            padding: "5px 12px",
            borderRadius: 6,
            border: "none",
            cursor: dirty ? "pointer" : "default",
            background: dirty ? "#7c5cff" : "#232330",
            color: dirty ? "white" : "#6b6b80",
            fontWeight: 600,
          }}
        >
          {dirty ? "Save to story.json" : "Saved"}
        </button>
      </div>

      {selection.kind === "story" ? (
        <StoryProps story={story} onChange={onChange} />
      ) : (
        <BeatProps
          beat={story.beats[selection.index]}
          index={selection.index}
          fallbackTextColor={story.textColor}
          onChange={(patch) => patchBeat(selection.index, patch)}
        />
      )}

      <div
        style={{
          fontSize: 10,
          color: "#4b4b5a",
          lineHeight: 1.5,
          marginTop: 16,
        }}
      >
        This panel tweaks parameters only. To change the sequence — add or
        remove beats, edit words, generate new shapes — reprompt Claude
        Code (open the terminal pane).
      </div>
    </div>
  );
};
```

Remove the `<Card>` component (currently lines 55–99) — it's no longer used.

- [ ] **Step 2: Add the `StoryProps` and `BeatProps` subcomponents**

Append the following to `editor/panel.tsx` (after the `Panel` export):

```tsx
const StoryProps: React.FC<{
  story: Story;
  onChange: (story: Story) => void;
}> = ({ story, onChange }) => {
  const patchStory = (patch: Partial<Story>) => onChange({ ...story, ...patch });

  return (
    <>
      <Section title="Palette & background">
        <Row label="bg">
          <ColorControl
            value={story.bgColor}
            onChange={(v) => patchStory({ bgColor: v })}
          />
        </Row>
        <Row label="bg end">
          <ColorControl
            value={story.bgColor2}
            onChange={(v) => patchStory({ bgColor2: v })}
          />
        </Row>
        <Row label="text">
          <ColorControl
            value={story.textColor}
            onChange={(v) => patchStory({ textColor: v })}
          />
        </Row>
        <Row label="accent">
          <ColorControl
            value={story.accentColor}
            onChange={(v) => patchStory({ accentColor: v })}
          />
        </Row>
        <Row label="accent 2">
          <ColorControl
            value={story.accent2Color}
            onChange={(v) => patchStory({ accent2Color: v })}
          />
        </Row>
        <Row label="font size">
          <Slider
            value={story.fontSize}
            min={40}
            max={400}
            step={5}
            onChange={(v) => patchStory({ fontSize: v })}
          />
        </Row>
        <Row label="glow">
          <Slider
            value={story.glowIntensity}
            min={0}
            max={2}
            step={0.1}
            onChange={(v) => patchStory({ glowIntensity: v })}
          />
        </Row>
      </Section>

      <Section title="Background">
        <Row label="type">
          <Dropdown
            value={story.background.kind}
            options={BG_KINDS}
            onChange={(v) =>
              patchStory({
                background: {
                  ...story.background,
                  kind: v as Story["background"]["kind"],
                },
              })
            }
          />
        </Row>
        {story.background.kind === "shader" && (
          <Row label="style">
            <Dropdown
              value={story.background.shaderStyle}
              options={SHADER_STYLES}
              onChange={(v) =>
                patchStory({
                  background: {
                    ...story.background,
                    shaderStyle: v as Story["background"]["shaderStyle"],
                  },
                })
              }
            />
          </Row>
        )}
        {(story.background.kind === "image" ||
          story.background.kind === "video") && (
          <Row label="src">
            <input
              value={story.background.src ?? ""}
              placeholder="path under public/ or URL"
              onChange={(e) =>
                patchStory({
                  background: { ...story.background, src: e.target.value },
                })
              }
              style={{
                flex: 1,
                background: "#1c1c26",
                border: "1px solid #2e2e3c",
                borderRadius: 5,
                color: "#e4e4ee",
                fontSize: 11,
                padding: "3px 6px",
              }}
            />
          </Row>
        )}
        <Row label="motion">
          <Slider
            value={story.background.motion}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) =>
              patchStory({
                background: { ...story.background, motion: v },
              })
            }
          />
        </Row>
      </Section>
    </>
  );
};

const BeatProps: React.FC<{
  beat: Beat | undefined;
  index: number;
  fallbackTextColor: string;
  onChange: (patch: Partial<Beat>) => void;
}> = ({ beat, fallbackTextColor, onChange }) => {
  if (!beat) {
    return (
      <div style={{ fontSize: 11, color: "#8b8b9a", padding: "10px 0" }}>
        Selected beat no longer exists.
      </div>
    );
  }
  return (
    <Section title={`${beat.kind} beat`}>
      <Row label="kind">
        <Dropdown
          value={beat.kind}
          options={KINDS}
          onChange={(v) => onChange({ kind: v as Beat["kind"] })}
        />
      </Row>
      <Row label="duration">
        <Slider
          value={beat.durationInSeconds}
          min={0.3}
          max={10}
          step={0.1}
          onChange={(v) => onChange({ durationInSeconds: v })}
        />
      </Row>
      <Row label="easing">
        <EasingPicker
          value={beat.easing as EasingName}
          onChange={(v) => onChange({ easing: v })}
        />
      </Row>
      {beat.kind !== "generativeFill" && (
        <Row label="direction">
          <Dropdown
            value={beat.direction}
            options={DIRECTIONS}
            onChange={(v) =>
              onChange({ direction: v as Beat["direction"] })
            }
          />
        </Row>
      )}
      <Row label="dynamics">
        <Slider
          value={beat.dynamics}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => onChange({ dynamics: v })}
        />
      </Row>
      <Row label="stagger">
        <Slider
          value={beat.staggerSeconds}
          min={0}
          max={0.2}
          step={0.005}
          onChange={(v) => onChange({ staggerSeconds: v })}
        />
      </Row>
      <Row label="anim in">
        <Slider
          value={beat.animateInPortion}
          min={0.1}
          max={0.9}
          step={0.05}
          onChange={(v) => onChange({ animateInPortion: v })}
        />
      </Row>
      <Row label="scale">
        <Slider
          value={beat.scale}
          min={0.3}
          max={2.5}
          step={0.05}
          onChange={(v) => onChange({ scale: v })}
        />
      </Row>
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
      {beat.kind === "morph" && (
        <div
          style={{
            fontSize: 10,
            color: "#6b6b80",
            marginTop: 4,
            fontStyle: "italic",
          }}
        >
          shape: {beat.shape ? "provider-generated" : "default circle"} —
          reprompt Claude Code to change
        </div>
      )}
    </Section>
  );
};
```

- [ ] **Step 3: Remove the now-unused width on the panel wrapper**

The wrapping `<div>`'s `width: 320` is now defined by the grid in App.tsx (Task 5). The Step 1 replacement already dropped `width: 320` and changed `height: "100vh"` to `height: "100%"`. Confirm those are gone — re-read `panel.tsx` if needed.

- [ ] **Step 4: Verify the panel renders only the Story section**

Run: `npm run editor`
Expected: the right panel shows ONLY the Palette & background + Background sections (because the initial selection is `{ kind: "story" }`). Cards-per-beat list is gone. No console errors.

If you want to spot-check the beat path: open the React DevTools (or just temporarily change the initial selection in App.tsx to `{ kind: "beat", index: 0 }`), reload, confirm the panel shows beat 0's controls, revert.

- [ ] **Step 5: Commit**

```bash
git add editor/panel.tsx
git commit -m "feat(editor): make properties panel selection-driven"
```

---

## Task 4: Create `<Timeline>` (timeline.tsx)

Create the timeline component with a Story track, a Beats track, click-to-select-and-seek, an empty-area scrub, and a live playhead indicator. Not wired into App.tsx yet — done in Task 5.

**Files:**
- Create: `editor/timeline.tsx`

- [ ] **Step 1: Create `editor/timeline.tsx`**

Create the file with:

```tsx
/**
 * The studio timeline.
 *
 * Two horizontal tracks: a single Story row and a row of Beat clips whose
 * widths are proportional to durationInSeconds. Clicking a clip selects it
 * AND seeks the player to that clip's start frame. The playhead is local
 * state subscribed to playerRef's frameupdate event, so the rest of the
 * studio doesn't re-render at 30fps.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerRef } from "@remotion/player";
import type { Story } from "../src/kinetic/schema";
import type { Selection } from "./App";

type TimelineProps = {
  story: Story;
  selection: Selection;
  onSelect: (s: Selection) => void;
  playerRef: React.RefObject<PlayerRef | null>;
  durationInFrames: number;
  fps: number;
};

export const Timeline: React.FC<TimelineProps> = React.memo(
  ({ story, selection, onSelect, playerRef, durationInFrames, fps }) => {
    const totalSeconds =
      story.beats.reduce((s, b) => s + b.durationInSeconds, 0) || 1;

    // Precompute each beat's start frame for seek-on-select.
    const beatStartFrames = React.useMemo(() => {
      let acc = 0;
      return story.beats.map((b) => {
        const f = Math.round(acc * fps);
        acc += b.durationInSeconds;
        return f;
      });
    }, [story.beats, fps]);

    // Live playhead — local state, subscribed via frameupdate.
    const [currentFrame, setCurrentFrame] = useState(0);
    useEffect(() => {
      const player = playerRef.current;
      if (!player) return;
      const handler = (e: { detail: { frame: number } }) =>
        setCurrentFrame(e.detail.frame);
      // PlayerRef has a typed addEventListener for "frameupdate".
      player.addEventListener("frameupdate", handler as never);
      return () => {
        player.removeEventListener("frameupdate", handler as never);
      };
    }, [playerRef]);

    const clamp = (f: number) =>
      Math.max(0, Math.min(durationInFrames - 1, f));

    const seekAndPlay = useCallback(
      (e: React.MouseEvent, frame: number) => {
        const p = playerRef.current;
        if (!p) return;
        p.seekTo(clamp(frame));
        p.play(e);
      },
      [playerRef, durationInFrames],
    );

    const beatsTrackRef = useRef<HTMLDivElement>(null);

    const onBeatsTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
      // Only react if the click landed on the track itself, not a child clip.
      if (e.target !== e.currentTarget) return;
      const rect = beatsTrackRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ratio = (e.clientX - rect.left) / rect.width;
      const frame = Math.round(ratio * (durationInFrames - 1));
      // empty-area scrub: seek but DO NOT change selection
      playerRef.current?.seekTo(clamp(frame));
    };

    return (
      <div
        style={{
          background: "#0a0a10",
          borderTop: "1px solid #232330",
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          position: "relative",
        }}
      >
        {/* Story track */}
        <button
          onClick={(e) => {
            onSelect({ kind: "story" });
            seekAndPlay(e, 0);
          }}
          aria-pressed={selection.kind === "story"}
          style={{
            display: "block",
            width: "100%",
            height: 22,
            borderRadius: 6,
            cursor: "pointer",
            textAlign: "left",
            padding: "0 8px",
            fontSize: 10,
            letterSpacing: 0.5,
            textTransform: "uppercase",
            color: selection.kind === "story" ? "white" : "#8b8b9a",
            background:
              selection.kind === "story" ? "#7c5cff" : "#14141c",
            border:
              selection.kind === "story"
                ? "1px solid #9d83ff"
                : "1px solid #232330",
          }}
        >
          Story
        </button>

        {/* Beats track */}
        <div
          ref={beatsTrackRef}
          onClick={onBeatsTrackClick}
          style={{
            display: "flex",
            gap: 2,
            height: 36,
            position: "relative",
            cursor: "crosshair",
          }}
        >
          {story.beats.map((beat, i) => {
            const widthPct =
              (beat.durationInSeconds / totalSeconds) * 100;
            const isSelected =
              selection.kind === "beat" && selection.index === i;
            return (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect({ kind: "beat", index: i });
                  seekAndPlay(e, beatStartFrames[i]);
                }}
                aria-pressed={isSelected}
                style={{
                  flex: `0 0 ${widthPct}%`,
                  minWidth: 0,
                  height: "100%",
                  borderRadius: 6,
                  border: isSelected
                    ? "1px solid #9d83ff"
                    : "1px solid #2e2e3c",
                  background: isSelected ? "#7c5cff" : "#1c1c26",
                  color: isSelected ? "white" : "#e4e4ee",
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "0 8px",
                  textAlign: "left",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
                title={`${beat.text} (${beat.kind}, ${beat.durationInSeconds}s)`}
              >
                {beat.text}
              </button>
            );
          })}

          {/* Playhead */}
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${
                ((currentFrame) / Math.max(1, durationInFrames - 1)) * 100
              }%`,
              width: 2,
              background: "#facc15",
              pointerEvents: "none",
              boxShadow: "0 0 8px rgba(250,204,21,0.6)",
            }}
          />
        </div>
      </div>
    );
  },
);
Timeline.displayName = "Timeline";
```

- [ ] **Step 2: Type-check the new file**

Run: `npx tsc --noEmit`
Expected: no errors. If `addEventListener("frameupdate", ...)` complains about the event type, the `as never` cast keeps us moving; PlayerRef's types vary across `@remotion/player` versions. If a clean type is available, replace `as never` with the proper one (`CallbackListener<"frameupdate">` in recent versions).

- [ ] **Step 3: Commit**

```bash
git add editor/timeline.tsx
git commit -m "feat(editor): add Timeline component (not yet mounted)"
```

---

## Task 5: Switch App.tsx to the four-pane grid and mount Timeline

Replace the current flex layout with a CSS grid that places Terminal (left, full-height — empty placeholder for now), Preview (top-center), Timeline (bottom-center), Properties (right, full-height). Add the keyboard-shortcut effect.

**Files:**
- Modify: `editor/App.tsx`

- [ ] **Step 1: Add imports**

In `editor/App.tsx`, update imports to include:

```tsx
import { Timeline } from "./timeline";
```

- [ ] **Step 2: Add keyboard shortcuts effect**

Inside `App`, after the clamp `useEffect` from Task 1, add:

```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (
      t &&
      (t.matches("input, textarea, [contenteditable='true']") ||
        t.closest("[data-terminal-root]"))
    ) {
      return;
    }
    const p = playerRef.current;
    if (!p) return;
    const clamp = (f: number) =>
      Math.max(0, Math.min(durationInFrames - 1, f));
    if (e.code === "Space") {
      e.preventDefault();
      if (p.isPlaying()) p.pause();
      else
        p.play(
          // @ts-expect-error play() expects a SyntheticEvent | undefined
          // — passing the raw KeyboardEvent works at runtime; keep it
          // simple instead of synthesising an event.
          e,
        );
    } else if (e.code === "ArrowLeft") {
      e.preventDefault();
      p.seekTo(clamp(p.getCurrentFrame() - FPS));
    } else if (e.code === "ArrowRight") {
      e.preventDefault();
      p.seekTo(clamp(p.getCurrentFrame() + FPS));
    } else if (e.code === "Home") {
      e.preventDefault();
      p.seekTo(0);
    } else if (e.code === "End") {
      e.preventDefault();
      p.seekTo(clamp(durationInFrames - 1));
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [durationInFrames]);
```

- [ ] **Step 3: Replace the shell JSX with the grid**

Replace the final `return (...)` of `App` (currently the flex `<div>` at lines 84–122) with:

```tsx
return (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "360px 1fr 320px",
      gridTemplateRows: "1fr auto",
      width: "100vw",
      height: "100vh",
      background: "#08080c",
      color: "#e4e4ee",
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}
  >
    {/* TERMINAL: left column, full height. Placeholder until Task 7. */}
    <div
      data-terminal-root
      style={{
        gridColumn: "1",
        gridRow: "1 / span 2",
        background: "#0a0a10",
        borderRight: "1px solid #232330",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#4b4b5a",
        fontSize: 12,
      }}
    >
      terminal (coming next task)
    </div>

    {/* PREVIEW: center-top */}
    <div
      style={{
        gridColumn: "2",
        gridRow: "1",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        gap: 12,
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <Transport
        playerRef={playerRef}
        durationInFrames={durationInFrames}
      />
      <PlayerStage
        inputProps={story}
        durationInFrames={durationInFrames}
        fps={FPS}
        playerRef={playerRef}
      />
      <div style={{ fontSize: 11, color: "#4b4b5a" }}>
        {story.beats.length} beats ·{" "}
        {(durationInFrames / FPS).toFixed(1)}s · 1080×1920
      </div>
    </div>

    {/* TIMELINE: center-bottom */}
    <div style={{ gridColumn: "2", gridRow: "2", minWidth: 0 }}>
      <Timeline
        story={story}
        selection={selection}
        onSelect={setSelection}
        playerRef={playerRef}
        durationInFrames={durationInFrames}
        fps={FPS}
      />
    </div>

    {/* PROPERTIES: right column, full height */}
    <div style={{ gridColumn: "3", gridRow: "1 / span 2", minWidth: 0 }}>
      <Panel
        story={story}
        selection={selection}
        onSelect={setSelection}
        onChange={setStory}
        dirty={dirty}
        onSave={handleSave}
      />
    </div>
  </div>
);
```

- [ ] **Step 4: Verify the studio**

Run: `npm run editor`
Expected:
- Four panes laid out as in the spec mockup.
- Click each beat clip → properties show that beat's controls; player seeks and plays.
- Click the Story track → properties show palette/background; player seeks to 0.
- Drag a slider while playing → animation reflects the new value.
- Space toggles play/pause; ←/→ jump 1s; Home/End jump to ends; typing in a text input does NOT trigger transport.
- Live yellow playhead line moves across the Beats track during playback.

- [ ] **Step 5: Commit**

```bash
git add editor/App.tsx
git commit -m "feat(editor): four-pane grid layout with timeline and keyboard shortcuts"
```

---

## Task 6: Delete the standalone player app

The studio now does everything `app/` did. Remove the old player app and its scripts.

**Files:**
- Delete: `app/`, `index.html` (root), `vite.config.ts` (root)
- Modify: `package.json` — remove `"player"` and `"build:player"` scripts

- [ ] **Step 1: Confirm nothing else imports from `app/`**

Run: `grep -rn "from \"\.\.\?/app/" "/Users/parandykt/Remotion Tests" --include="*.ts" --include="*.tsx" 2>/dev/null`
Expected: no results.

Also check root entry references:
Run: `grep -rn "app/main\|app/App" "/Users/parandykt/Remotion Tests" --include="*.ts" --include="*.tsx" --include="*.html" 2>/dev/null`
Expected: only references inside `app/` itself (which we're deleting).

If any external file imports from `app/`, stop and investigate before deleting.

- [ ] **Step 2: Delete the files**

Run:
```bash
rm -r "/Users/parandykt/Remotion Tests/app"
rm "/Users/parandykt/Remotion Tests/index.html"
rm "/Users/parandykt/Remotion Tests/vite.config.ts"
```

- [ ] **Step 3: Update `package.json`**

In `/Users/parandykt/Remotion Tests/package.json`, remove these two lines from `scripts`:

```json
"player": "vite",
"build:player": "vite build",
```

Result: `scripts` keeps `dev`, `studio`, `render`, `editor`, `build:editor`, `kinetic`.

- [ ] **Step 4: Verify nothing broke**

Run all of these — each should succeed (or, for `studio`/`render`, start without crashing):

```bash
npm run editor       # studio opens, kinetic story loads
# Ctrl-C to stop
npm run studio       # Remotion Studio opens at :3000
# Ctrl-C
npx remotion render KineticStory out/_smoketest.mp4 --frames=0-10
# expect: writes a tiny mp4 without errors
rm -f out/_smoketest.mp4
```

- [ ] **Step 5: Commit**

```bash
git add -A   # captures deletions plus package.json
git commit -m "chore: remove standalone player app (folded into studio)"
```

---

## Task 7: Embedded terminal — backend (Vite plugin + node-pty + ws)

Install dependencies and add the WebSocket-PTY bridge to `vite.editor.config.ts`. No frontend yet.

**Files:**
- Modify: `package.json` — add deps
- Modify: `vite.editor.config.ts` — add `terminalPlugin`

- [ ] **Step 1: Install backend deps**

Run:
```bash
npm install --save-dev node-pty ws
npm install --save-dev @types/ws
```

Expected: installs succeed. `node-pty` may run a native build; on macOS this should complete using prebuilt binaries. If the build fails, run `npm rebuild node-pty` and try again.

- [ ] **Step 2: Add `terminalPlugin` to `vite.editor.config.ts`**

Open `vite.editor.config.ts` and add at the top of the imports:

```ts
import { WebSocketServer, type WebSocket } from "ws";
```

Just below the existing `storyJsonPlugin` definition, add:

```ts
// --- dev-server plugin: PTY bridge over WebSocket ---------------------------
const terminalPlugin = (): Plugin => ({
  name: "kinetic-terminal",
  configureServer(server) {
    let pty: typeof import("node-pty") | null = null;
    try {
      pty = require("node-pty");
    } catch (e) {
      console.warn(
        "[terminal] node-pty unavailable:",
        (e as Error).message,
      );
    }

    const wss = new WebSocketServer({ noServer: true });

    server.httpServer?.on("upgrade", (req, socket, head) => {
      if (req.url !== "/__terminal") return;
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    });

    wss.on("connection", (ws: WebSocket) => {
      if (!pty) {
        ws.send(
          "[terminal unavailable — try: npm rebuild node-pty]\r\n",
        );
        ws.close();
        return;
      }
      const shell = process.env.SHELL || "/bin/zsh";
      let child;
      try {
        child = pty.spawn(shell, ["-l"], {
          name: "xterm-256color",
          cols: 100,
          rows: 30,
          cwd: PROJECT_ROOT,
          env: process.env as { [k: string]: string },
        });
      } catch (e) {
        ws.send(`[failed to spawn shell: ${(e as Error).message}]\r\n`);
        ws.close();
        return;
      }

      child.onData((data) => {
        try {
          ws.send(data);
        } catch {
          // ignore — likely closed
        }
      });

      ws.on("message", (raw) => {
        const str = raw.toString();
        if (str.startsWith("{")) {
          try {
            const msg = JSON.parse(str);
            if (msg.kind === "resize" && typeof msg.cols === "number") {
              child.resize(msg.cols, msg.rows);
              return;
            }
          } catch {
            // fall through and write the literal string
          }
        }
        child.write(str);
      });

      ws.on("close", () => {
        try {
          child.kill();
        } catch {
          // ignore
        }
      });
    });
  },
});
```

Update the `plugins` array in `defineConfig` to include the new plugin:

```ts
plugins: [react(), storyJsonPlugin(), terminalPlugin()],
```

- [ ] **Step 3: Sanity-check the WS endpoint**

Run: `npm run editor` (in one terminal)
Then in another:

```bash
node -e "const WebSocket = require('ws'); const ws = new WebSocket('ws://127.0.0.1:5174/__terminal'); ws.on('open', () => { console.log('connected'); ws.send('echo hello\\r'); }); ws.on('message', m => process.stdout.write(m.toString())); setTimeout(() => process.exit(0), 1500);"
```

Expected: prints `connected`, then the shell prompt, then `echo hello` followed by `hello`. If you don't have `ws` installed globally, run from inside the project: `node -r ./node_modules/ws ...` or simply skip this sanity check and verify visually in Task 8.

Stop the editor with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json vite.editor.config.ts
git commit -m "feat(editor): add PTY-over-WebSocket backend for embedded terminal"
```

---

## Task 8: Embedded terminal — frontend (xterm)

Install xterm packages and create `editor/terminal.tsx`. Wire it into the left pane of `App.tsx`.

**Files:**
- Modify: `package.json` — add deps
- Create: `editor/terminal.tsx`
- Modify: `editor/App.tsx` — replace terminal placeholder with `<Terminal />`

- [ ] **Step 1: Install xterm deps**

Run:
```bash
npm install xterm xterm-addon-fit xterm-addon-web-links
```

Expected: installs succeed.

- [ ] **Step 2: Create `editor/terminal.tsx`**

```tsx
/**
 * Embedded terminal. xterm.js in the browser <-> node-pty in the Vite
 * dev-server plugin, bridged by a WebSocket on /__terminal.
 *
 * Spawns a plain shell. Type `claude` to start the Claude Code CLI; its
 * OAuth login URL is clickable (web-links addon).
 */
import React, { useEffect, useRef } from "react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import "xterm/css/xterm.css";

export const Terminal: React.FC = () => {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const term = new XTerm({
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 12,
      theme: {
        background: "#0a0a10",
        foreground: "#e4e4ee",
        cursor: "#facc15",
        selectionBackground: "#7c5cff66",
      },
      cursorBlink: true,
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(hostRef.current);
    fit.fit();

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${window.location.host}/__terminal`,
    );

    ws.onopen = () => {
      const send = () => {
        try {
          ws.send(
            JSON.stringify({
              kind: "resize",
              cols: term.cols,
              rows: term.rows,
            }),
          );
        } catch {
          // ignore
        }
      };
      send();
      term.onResize(send);
    };
    ws.onmessage = (ev) => {
      // ev.data is string or Blob
      if (typeof ev.data === "string") term.write(ev.data);
      else (ev.data as Blob).text().then((s) => term.write(s));
    };
    ws.onclose = () =>
      term.writeln("\r\n[terminal disconnected — reload to reconnect]");
    ws.onerror = () => {
      // onclose will fire after; nothing extra needed.
    };

    const disp = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    const onWinResize = () => {
      fit.fit();
    };
    window.addEventListener("resize", onWinResize);

    return () => {
      window.removeEventListener("resize", onWinResize);
      disp.dispose();
      try {
        ws.close();
      } catch {
        // ignore
      }
      term.dispose();
    };
  }, []);

  return (
    <div
      data-terminal-root
      ref={hostRef}
      style={{
        width: "100%",
        height: "100%",
        background: "#0a0a10",
        padding: 6,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    />
  );
};
```

- [ ] **Step 3: Mount the terminal in App.tsx**

In `editor/App.tsx`, add to imports:

```tsx
import { Terminal } from "./terminal";
```

Replace the placeholder terminal `<div>` (the block with `data-terminal-root` and `"terminal (coming next task)"` from Task 5 Step 3) with:

```tsx
<div
  style={{
    gridColumn: "1",
    gridRow: "1 / span 2",
    background: "#0a0a10",
    borderRight: "1px solid #232330",
    overflow: "hidden",
  }}
>
  <Terminal />
</div>
```

Note: the `data-terminal-root` attribute now lives on the `<div>` inside `terminal.tsx`, so the keyboard-shortcut guard from Task 5 still works.

- [ ] **Step 4: Verify**

Run: `npm run editor`

Confirm:
- Left pane shows a working shell prompt in the project directory (run `pwd` to verify cwd).
- Type `ls` — directory contents appear.
- Type `claude` — if installed, the CLI starts; if not logged in, the login URL appears and is clickable (opens browser).
- Resize the window: the terminal reflows without breaking.
- With focus inside the terminal, hit Space — typing happens in the terminal, NOT play/pause. Click outside the terminal and hit Space — play/pause toggles.
- Click a beat — Properties panel + player seek still work.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json editor/terminal.tsx editor/App.tsx
git commit -m "feat(editor): embed xterm terminal in left pane"
```

---

## Task 9: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Edit the run table**

In `README.md`, find the block:

```
npm run studio      # Remotion Studio — visual editor at localhost:3000
npm run player      # Interactive Player app at localhost:5173
npm run render      # Render HelloVideo -> out/hello.mp4
```

Replace with:

```
npm run studio      # Remotion Studio — visual editor at localhost:3000
npm run editor      # Kinetic story studio (preview + timeline + props + terminal) at localhost:5174
npm run render      # Render HelloVideo -> out/hello.mp4
```

- [ ] **Step 2: Update the file map**

Find the `src/HelloVideo.tsx ...` block at the top. Remove the line:

```
app/App.tsx          Interactive host app — embeds <Player>, wires props to live UI controls.
app/main.tsx         Vite entry for the host app.
```

And add (under `editor/`):

```
editor/App.tsx       Studio shell — four-pane grid, state, keyboard shortcuts.
editor/player.tsx    <PlayerStage> + <Transport> (play/pause/seek).
editor/timeline.tsx  Story track + Beats track + live playhead.
editor/terminal.tsx  Embedded xterm; talks to a node-pty PTY over WS.
editor/panel.tsx     Selection-driven properties panel.
```

- [ ] **Step 3: Add a "Studio layout" section**

Insert after the "The mental model" section:

```markdown
## The studio (`npm run editor`)

A four-pane editor at `localhost:5174`:

```
┌─────────────┬──────────────────────┬──────────────┐
│  TERMINAL   │       PREVIEW        │  PROPERTIES  │
│             ├──────────────────────┤              │
│  (xterm +   │      TIMELINE        │ (selection-  │
│   node-pty) │                      │  driven)     │
└─────────────┴──────────────────────┴──────────────┘
```

- **Timeline**: each beat is a clip whose width is proportional to its
  duration. Click a clip to select it AND seek the player to its start.
  A yellow playhead line shows the current frame.
- **Properties**: shows props for the selected element only — either the
  Story (palette, background, font, glow) or one beat (kind, easing,
  dynamics, etc.). Drag a slider while playback is running to see changes
  animate in real time.
- **Terminal**: a real PTY in the project directory. Type `claude` to
  drive script-level changes from inside the studio. Login URLs are
  clickable.

### Keyboard shortcuts

| Key      | Action                       |
|----------|------------------------------|
| Space    | Toggle play / pause          |
| ← / →    | Seek ±1 second               |
| Home     | Jump to first frame          |
| End      | Jump to last frame           |

Shortcuts are disabled while typing in input fields or the terminal.

### Native module note

`node-pty` is a native module. On macOS it installs prebuilt binaries. If
the terminal pane shows `[terminal unavailable ...]`, run:

```bash
npm rebuild node-pty
```
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document four-pane studio layout and keyboard shortcuts"
```

---

## Task 10: Final smoke + scope check

- [ ] **Step 1: Full smoke test**

Run: `npm run editor`

Walk through:
1. Story selection on load (initial state): Properties shows palette.
2. Click each beat: selection + seek + properties update.
3. Drag `dynamics` on a beat while playing: motion changes immediately.
4. Press Space outside any input: pauses/plays.
5. ←/→ from preview pane: seeks 1s.
6. Terminal: `pwd` → project root; `claude` → CLI starts (if installed).
7. Save: edit a slider, click `Save to story.json`, reload — value persists.

- [ ] **Step 2: Verify other entry points still work**

```bash
npm run studio   # Remotion Studio loads; Ctrl-C
npx remotion render KineticStory out/_smoke.mp4 --frames=0-10
rm out/_smoke.mp4
```

- [ ] **Step 3: Scope check**

Re-read `docs/superpowers/specs/2026-05-15-studio-timeline-design.md`. For each "Verification" item (1–8), confirm the smoke test covered it. Note any uncovered items as a follow-up.

- [ ] **Step 4: Final commit (if any pending changes)**

```bash
git status
# If clean, you're done. Otherwise:
git add -A && git commit -m "chore: studio refactor verified"
```

---

## Self-review notes

**Spec coverage:**
- Layout (4-pane grid) → Task 5
- File reshuffle → Tasks 2, 3, 4, 6, 8
- Selection state + clamp → Task 1
- Selection-driven Panel → Task 3
- PlayerStage + Transport → Task 2
- Timeline (Story + Beats + playhead + click-to-seek + empty scrub) → Task 4
- Keyboard shortcuts (with guards) → Task 5 Step 2
- Terminal backend (PTY + WS) → Task 7
- Terminal frontend (xterm) → Task 8
- README → Task 9
- `app/` deletion → Task 6
- Smoke verification → Task 10

**Type consistency:** `Selection` is defined once in `App.tsx` and imported by `panel.tsx` and `timeline.tsx`. Beat/Story types are imported from `src/kinetic/schema`. `PlayerRef` is imported from `@remotion/player` in App, player, timeline.

**Placeholder scan:** No "TBD", no "handle edge cases" without specifics, no "similar to Task N". Every code step has the literal code to write.

**Open follow-ups (not in scope):**
- Drag-to-resize on the left terminal column.
- Beat duration text inside clip when wide enough.
- Tests — the repo has none today.
