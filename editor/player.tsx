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
}> = React.memo(({ playerRef, durationInFrames }) => {
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
});
Transport.displayName = "Transport";

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
