/**
 * The kinetic story editor — app shell.
 *
 * Layout: <Player> live preview on the left, the design-properties Panel
 * on the right. Loads story.json, holds it in state, feeds it to the
 * Player as memoized inputProps, and POSTs it back to story.json on save
 * (via the dev-server plugin in vite.config.ts).
 *
 * Player best practices applied (remotion.dev/docs/player/best-practices):
 *  - inputProps is useMemo'd so panel edits don't thrash the Player tree
 *  - the <Player> is isolated in its own component from the panel
 *  - playback is driven via playerRef
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { KineticStory } from "../src/kinetic/KineticStory";
import {
  storySchema,
  storyDurationInFrames,
  type Story,
} from "../src/kinetic/schema";
import { Panel } from "./panel";

const FPS = 30;

export type Selection =
  | { kind: "story" }
  | { kind: "beat"; index: number };

export const App: React.FC = () => {
  const [story, setStory] = useState<Story | null>(null);
  const [savedJson, setSavedJson] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const playerRef = useRef<PlayerRef>(null);
  const [selection, setSelection] = useState<Selection>({ kind: "story" });

  // load story.json on mount (served by Vite from the project root)
  useEffect(() => {
    fetch("/story.json")
      .then((r) => r.json())
      .then((raw) => {
        const parsed = storySchema.parse(raw);
        setStory(parsed);
        setSavedJson(JSON.stringify(parsed));
      })
      .catch((e) => setError(`Failed to load story.json: ${e.message}`));
  }, []);

  useEffect(() => {
    if (!story) return;
    if (selection.kind === "beat" && selection.index >= story.beats.length) {
      setSelection({ kind: "story" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story]);

  const durationInFrames = useMemo(
    () => (story ? storyDurationInFrames(story, FPS) : 1),
    [story],
  );

  const dirty = useMemo(
    () => (story ? JSON.stringify(story) !== savedJson : false),
    [story, savedJson],
  );

  const handleSave = useCallback(async () => {
    if (!story) return;
    try {
      const res = await fetch("/__save-story", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(story, null, 2),
      });
      if (!res.ok) throw new Error(await res.text());
      setSavedJson(JSON.stringify(story));
    } catch (e) {
      setError(`Save failed: ${(e as Error).message}`);
    }
  }, [story]);

  if (error) {
    return (
      <div style={{ ...fill, color: "#ff8b8b", padding: 40 }}>{error}</div>
    );
  }
  if (!story) {
    return <div style={{ ...fill, color: "#6b6b80", padding: 40 }}>Loading…</div>;
  }

  return (
    <div style={{ display: "flex", ...fill, background: "#08080c" }}>
      {/* preview side */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
          gap: 16,
          minWidth: 0,
        }}
      >
        {/* story is guaranteed non-null here (guarded above). It IS the
            Player's inputProps — already stable React state, so no extra
            useMemo needed; the Player only re-renders when it changes. */}
        <PlayerStage
          inputProps={story}
          durationInFrames={durationInFrames}
          playerRef={playerRef}
        />
        <div style={{ fontSize: 11, color: "#4b4b5a" }}>
          {story.beats.length} beats ·{" "}
          {(durationInFrames / FPS).toFixed(1)}s · 1080×1920
        </div>
      </div>

      {/* properties panel */}
      <Panel
        story={story}
        selection={selection}
        onSelect={setSelection}
        onChange={setStory}
        dirty={dirty}
        onSave={handleSave}
      />
    </div>
  );
};

const PlayerStage: React.FC<{
  inputProps: Story;
  durationInFrames: number;
  playerRef: React.RefObject<PlayerRef | null>;
}> = ({ inputProps, durationInFrames, playerRef }) => (
  <div
    style={{
      height: "78vh",
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
      fps={FPS}
      style={{ width: "100%", height: "100%" }}
      controls
      loop
      autoPlay
    />
  </div>
);

const fill: React.CSSProperties = {
  width: "100vw",
  height: "100vh",
  margin: 0,
};
