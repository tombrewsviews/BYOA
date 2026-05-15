/**
 * The studio timeline.
 *
 * Two horizontal tracks: a single Story row and a row of Beat clips whose
 * widths are proportional to durationInSeconds. Clicking a clip selects it
 * AND seeks the player to that clip's start frame. The playhead is local
 * state subscribed to playerRef's frameupdate event, so the rest of the
 * studio doesn't re-render at 30fps.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CallbackListener, PlayerRef } from "@remotion/player";
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
    const beatStartFrames = useMemo(() => {
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
      const handler: CallbackListener<"frameupdate"> = (e) =>
        setCurrentFrame(e.detail.frame);
      player.addEventListener("frameupdate", handler);
      return () => {
        player.removeEventListener("frameupdate", handler);
      };
    }, [playerRef]);

    const seekAndPlay = useCallback(
      (e: React.MouseEvent, frame: number) => {
        const p = playerRef.current;
        if (!p) return;
        p.seekTo(Math.max(0, Math.min(durationInFrames - 1, frame)));
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
      playerRef.current?.seekTo(
        Math.max(0, Math.min(durationInFrames - 1, frame)),
      );
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
                (currentFrame / Math.max(1, durationInFrames - 1)) * 100
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
