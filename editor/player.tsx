/**
 * The studio's preview pane: the <Player> stage + a transparent drag
 * overlay that owns the click model, plus a transport toolbar.
 *
 * Why a custom click model:
 *   - Remotion <Player>'s built-in `controls` prop adds click-to-pause and
 *     click-to-scrub on the timeline, which conflicts with the editor's
 *     intent: clicks on the stage should let the user DRAG the currently-
 *     selected word to reposition it. So we drop `controls` and overlay
 *     our own pointer handler.
 *   - Double-click toggles play/pause. Right-click clears the selection.
 *   - Dragging the stage updates the selected beat's positionX/Y (0..1
 *     normalized) and the composition re-renders on each frame because
 *     inputProps is the same `story` reference the parent stores.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Player, type PlayerRef, type CallbackListener } from "@remotion/player";
import { KineticStory } from "../src/kinetic/KineticStory";
import { resolveBeatTimes, type Beat, type Story } from "../src/kinetic/schema";
import type { Selection } from "./selection";
import { color } from "./platform/theme";
import { Button } from "@/components/ui/button";
import { Play, Pause } from "./icons";

type PlayerStageProps = {
  inputProps: Story;
  durationInFrames: number;
  fps: number;
  playerRef: React.RefObject<PlayerRef | null>;
  selection: Selection;
  onChange: (s: Story) => void;
  loop: boolean;
};

export const PlayerStage: React.FC<PlayerStageProps> = React.memo(
  ({ inputProps, durationInFrames, fps, playerRef, selection, onChange, loop }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    // Pointer-down on the stage: if a beat is selected AND the playhead
    // is inside that beat's time window, begin a position-drag. Otherwise
    // ignore (user can use the Transport / Timeline for playback control).
    const onPointerDown = useCallback(
      (e: React.PointerEvent) => {
        if (e.button !== 0) return; // left-click only
        if (selection.kind !== "beat") return;
        // Canvas drag operates on the FIRST selected beat (the one the
        // panel is also editing). Multi-beat position drag would feel
        // weird in a preview anyway.
        const i = selection.indices[0];
        const beat = inputProps.beats[i];
        if (!beat) return;

        // Only allow drag when the selected beat is actually visible at
        // the current frame — otherwise the user is fiddling with a
        // not-on-screen layer which is confusing.
        const player = playerRef.current;
        const frame = player?.getCurrentFrame() ?? 0;
        const resolved = resolveBeatTimes(inputProps)[i];
        const startFrame = resolved.startSeconds * fps;
        const endFrame = resolved.endSeconds * fps;
        if (frame < startFrame || frame > endFrame) return;

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        e.preventDefault();

        const baselineX = beat.positionX;
        const baselineY = beat.positionY;
        const startCX = e.clientX;
        const startCY = e.clientY;

        // rAF-coalesce pointermove → one setStory per frame max.
        let rafId = 0;
        let pendingDx = 0;
        let pendingDy = 0;
        const flush = () => {
          rafId = 0;
          const nx = Math.max(-0.5, Math.min(1.5, baselineX + pendingDx));
          const ny = Math.max(-0.5, Math.min(1.5, baselineY + pendingDy));
          const nextBeats = inputProps.beats.map((b, k) =>
            k === i ? { ...b, positionX: nx, positionY: ny } : b,
          );
          onChange({ ...inputProps, beats: nextBeats });
        };

        const onMove = (ev: PointerEvent) => {
          pendingDx = (ev.clientX - startCX) / rect.width;
          pendingDy = (ev.clientY - startCY) / rect.height;
          if (rafId === 0) rafId = requestAnimationFrame(flush);
        };
        const onUp = () => {
          if (rafId !== 0) cancelAnimationFrame(rafId);
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      },
      [selection, inputProps, onChange, playerRef, fps],
    );

    // Inline text editor state — set when the user double-clicks the
    // canvas while a beat is selected. The editor floats over the word.
    const [editingBeatIndex, setEditingBeatIndex] = useState<number | null>(
      null,
    );

    const onDoubleClick = useCallback(
      (e: React.MouseEvent) => {
        // If a beat is selected → open inline text editor for it.
        // Otherwise fall back to play/pause toggle (the old behavior).
        if (selection.kind === "beat") {
          e.preventDefault();
          setEditingBeatIndex(selection.indices[0]);
          return;
        }
        const p = playerRef.current;
        if (!p) return;
        if (p.isPlaying()) p.pause();
        else p.play(e);
      },
      [playerRef, selection],
    );

    // Pause playback whenever an inline edit is in progress so the word
    // doesn't move around while the user types.
    useEffect(() => {
      if (editingBeatIndex == null) return;
      const p = playerRef.current;
      p?.pause();
    }, [editingBeatIndex, playerRef]);

    return (
      <div
        ref={containerRef}
        className="relative aspect-[9/16] overflow-hidden rounded-xl border border-border shadow-2xl"
        style={{ height: "62vh" }}
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
          loop={loop}
          // autoPlay intentionally OFF. The Player at 30fps fires frameupdate
          // events that re-render the Timeline (playhead) every tick, which
          // adds up across the whole editor surface. User starts playback
          // via the Transport ▶ button or by double-clicking the canvas.
        />
        {/* Pointer-event overlay. Cover the player so its internal click
            handlers (which we don't want — they pause on click) don't
            fire. We get drag-to-position; double-click toggles play. */}
        <div
          onPointerDown={onPointerDown}
          onDoubleClick={onDoubleClick}
          style={{
            position: "absolute",
            inset: 0,
            cursor:
              selection.kind === "beat" ? "grab" : "default",
            // Don't capture events when we're not interacting — let
            // composition content underneath stay interactive in the
            // future if needed.
          }}
        />
        {/* Selected-beat indicators always target the FIRST selected
            beat — multi-select shows position/rotation handles for
            only that one to avoid a cluttered canvas. */}
        {selection.kind === "beat" && inputProps.beats[selection.indices[0]] && (
          <PositionIndicator
            x={inputProps.beats[selection.indices[0]].positionX}
            y={inputProps.beats[selection.indices[0]].positionY}
          />
        )}
        {selection.kind === "beat" && inputProps.beats[selection.indices[0]] && (
          <RotationHandle
            beat={inputProps.beats[selection.indices[0]]}
            beatIndex={selection.indices[0]}
            containerRef={containerRef}
            inputProps={inputProps}
            onChange={onChange}
          />
        )}
        {/* Inline text editor — appears over the word on double-click. */}
        {editingBeatIndex != null && inputProps.beats[editingBeatIndex] && (
          <InlineTextEditor
            beat={inputProps.beats[editingBeatIndex]}
            onCommit={(newText) => {
              const next = inputProps.beats.map((b, k) =>
                k === editingBeatIndex ? { ...b, text: newText } : b,
              );
              onChange({ ...inputProps, beats: next });
              setEditingBeatIndex(null);
            }}
            onCancel={() => setEditingBeatIndex(null)}
          />
        )}
      </div>
    );
  },
);
PlayerStage.displayName = "PlayerStage";

/**
 * Floating text editor that overlays the current beat's word on the canvas.
 * Auto-focuses on mount, selects all so the user can type-to-replace.
 * Enter commits, Esc cancels, blur commits.
 */
const InlineTextEditor: React.FC<{
  beat: { text: string; positionX: number; positionY: number };
  onCommit: (newText: string) => void;
  onCancel: () => void;
}> = ({ beat, onCommit, onCancel }) => {
  const [value, setValue] = useState(beat.text);
  const inputRef = React.useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => onCommit(value)}
      style={{
        position: "absolute",
        left: `${beat.positionX * 100}%`,
        top: `${beat.positionY * 100}%`,
        transform: "translate(-50%, -50%)",
        background: "rgba(8,8,12,0.92)",
        border: "1.5px solid #facc15",
        borderRadius: 6,
        color: color.text.primary,
        fontSize: 24,
        fontWeight: 600,
        padding: "8px 14px",
        outline: "none",
        textAlign: "center",
        // shadow + backdrop so it stands out over whatever is rendering
        boxShadow: "0 6px 24px rgba(0,0,0,0.6)",
        zIndex: 5,
        minWidth: 120,
      }}
    />
  );
};

/**
 * Rotation handle. Sits 36px above the beat's anchor point at rest (in
 * the rotated frame, so it always points "up" relative to the beat).
 * Pointerdown begins a drag: each frame we compute the angle from the
 * anchor to the pointer, subtract 90° (so dragging up = 0°) and write
 * the delta to `beat.rotation`. rAF-coalesced like the position drag.
 *
 * The handle uses the canvas's coordinate space (0..1 normalized), so
 * it works regardless of the preview's actual pixel size.
 */
const RotationHandle: React.FC<{
  beat: Beat;
  beatIndex: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  inputProps: Story;
  onChange: (s: Story) => void;
}> = ({ beat, beatIndex, containerRef, inputProps, onChange }) => {
  const rot = beat.rotation ?? 0;
  const HANDLE_OFFSET_PX = 36;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ax = rect.left + beat.positionX * rect.width;
    const ay = rect.top + beat.positionY * rect.height;

    let rafId = 0;
    let pendingDeg = rot;
    const flush = () => {
      rafId = 0;
      const nextBeats = inputProps.beats.map((b, k) =>
        k === beatIndex ? { ...b, rotation: pendingDeg } : b,
      );
      onChange({ ...inputProps, beats: nextBeats });
    };
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - ax;
      const dy = ev.clientY - ay;
      // atan2 returns -π..π where 0 = +x axis. Subtract π/2 so dragging
      // straight UP (negative y) lands at 0°. Convert to degrees and
      // clamp into the schema's -180..180 range.
      const raw = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      const wrapped = ((raw + 180) % 360 + 360) % 360 - 180;
      pendingDeg = Math.round(wrapped);
      if (rafId === 0) rafId = requestAnimationFrame(flush);
    };
    const onUp = () => {
      if (rafId !== 0) cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      style={{
        position: "absolute",
        left: `${beat.positionX * 100}%`,
        top: `${beat.positionY * 100}%`,
        // First translate to center on the anchor; rotate by the beat's
        // current rotation so the stick always points outward in the
        // beat's local frame; then translate "up" by the offset distance.
        transform: `translate(-50%, -50%) rotate(${rot}deg) translateY(-${HANDLE_OFFSET_PX}px)`,
        transformOrigin: "center",
        pointerEvents: "none",
        zIndex: 6,
      }}
    >
      {/* connecting line back to the anchor */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          width: 1.5,
          height: HANDLE_OFFSET_PX,
          background: "rgba(250,204,21,0.5)",
          transform: "translateX(-50%)",
          pointerEvents: "none",
        }}
      />
      <div
        onPointerDown={onPointerDown}
        title={`Rotate (${rot}°)`}
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "#facc15",
          border: `2px solid ${color.bg.surface}`,
          cursor: "grab",
          boxShadow: "0 0 6px rgba(250,204,21,0.7)",
          pointerEvents: "auto",
        }}
      />
    </div>
  );
};

const PositionIndicator: React.FC<{ x: number; y: number }> = ({ x, y }) => (
  <div
    style={{
      position: "absolute",
      left: `${x * 100}%`,
      top: `${y * 100}%`,
      transform: "translate(-50%, -50%)",
      width: 24,
      height: 24,
      border: "1.5px solid #facc15",
      borderRadius: "50%",
      pointerEvents: "none",
      boxShadow: "0 0 8px rgba(250,204,21,0.4)",
      // dotted center
      backgroundImage:
        "radial-gradient(circle, #facc15 1.5px, transparent 1.5px)",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
    }}
  />
);

export const Transport: React.FC<{
  playerRef: React.RefObject<PlayerRef | null>;
  loop: boolean;
  onLoopChange: (next: boolean) => void;
}> = React.memo(({ playerRef, loop, onLoopChange }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onPlay: CallbackListener<"play"> = () => setIsPlaying(true);
    const onPause: CallbackListener<"pause"> = () => setIsPlaying(false);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    setIsPlaying(player.isPlaying());
    return () => {
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
    };
  }, [playerRef]);

  const toggle = useCallback(
    (e: React.MouseEvent) => {
      const p = playerRef.current;
      if (!p) return;
      if (p.isPlaying()) p.pause();
      else p.play(e);
    },
    [playerRef],
  );
  const onStart = useCallback(() => playerRef.current?.seekTo(0), [playerRef]);

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2 py-1.5">
      <Button variant="ghost" size="sm" onClick={onStart} title="Jump to start">
        Start
      </Button>
      <Button
        variant={isPlaying ? "secondary" : "ghost"}
        size="sm"
        onClick={toggle}
        aria-pressed={isPlaying}
        title="Play / pause (⌥Space)"
      >
        {isPlaying ? <Pause /> : <Play />}
        {isPlaying ? "Pause" : "Play"}
      </Button>
      {/* Loop toggle: pressed-state = looping. Click to flip. */}
      <Button
        variant={loop ? "secondary" : "ghost"}
        size="sm"
        onClick={() => onLoopChange(!loop)}
        aria-pressed={loop}
        title={loop ? "Looping" : "Play once"}
      >
        {loop ? "Loop" : "Once"}
      </Button>
    </div>
  );
});
Transport.displayName = "Transport";
