/**
 * The INTERACTIVE host app. This is a normal React app (Vite) that embeds
 * the Remotion <Player>. The Player renders the SAME HelloVideo component
 * the CLI renders — but here the props are wired to live UI controls.
 *
 * BEST PRACTICES APPLIED (from remotion.dev/docs/player/best-practices):
 *
 *  1. inputProps is wrapped in useMemo — without this, every keystroke
 *     creates a new object, re-rendering the whole Player tree needlessly.
 *
 *  2. The <Player> lives in its own <VideoStage> component, separate from
 *     the controls. High-frequency state (the playhead) is read via a ref
 *     inside the controls, so typing in the text box doesn't fight the
 *     playback loop.
 *
 *  3. play()/pause() are triggered from real onClick events and we pass
 *     the playerRef around rather than lifting frame state up.
 *
 *  4. We use `controls` for the built-in control bar, but ALSO show how to
 *     drive playback programmatically via playerRef — that combination is
 *     what "interactive video" means: the video reacts to your app, and
 *     your app reacts to the video.
 */
import React, { useMemo, useRef, useState, useCallback } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { HelloVideo, type HelloVideoProps } from "../src/HelloVideo";

const ACCENT_PRESETS = ["#38bdf8", "#f472b6", "#facc15", "#4ade80"];

export const App: React.FC = () => {
  // These bits of state drive the video's props. They change rarely
  // (on user input), so keeping them in the parent is fine.
  const [title, setTitle] = useState("Made with Remotion");
  const [subtitle, setSubtitle] = useState("Edit me — the video updates live");
  const [bgColor, setBgColor] = useState("#0f172a");
  const [accentColor, setAccentColor] = useState("#38bdf8");

  const playerRef = useRef<PlayerRef>(null);

  // BEST PRACTICE #1: memoize inputProps. Recomputed only when a dep changes.
  const inputProps: HelloVideoProps = useMemo(
    () => ({ title, subtitle, bgColor, accentColor }),
    [title, subtitle, bgColor, accentColor],
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#020617",
        color: "#e2e8f0",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "40px 20px",
        gap: 28,
      }}
    >
      <header style={{ textAlign: "center" }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>Interactive Remotion Player</h1>
        <p style={{ margin: "6px 0 0", color: "#64748b" }}>
          The controls below feed live props into the video. Same component
          renders to MP4 via the CLI.
        </p>
      </header>

      {/* BEST PRACTICE #2: Player isolated in its own component. */}
      <VideoStage inputProps={inputProps} playerRef={playerRef} />

      <Controls
        playerRef={playerRef}
        title={title}
        setTitle={setTitle}
        subtitle={subtitle}
        setSubtitle={setSubtitle}
        bgColor={bgColor}
        setBgColor={setBgColor}
        accentColor={accentColor}
        setAccentColor={setAccentColor}
      />
    </div>
  );
};

// ----------------------------------------------------------------------------

const VideoStage: React.FC<{
  inputProps: HelloVideoProps;
  playerRef: React.RefObject<PlayerRef | null>;
}> = ({ inputProps, playerRef }) => {
  return (
    <div
      style={{
        width: 800,
        maxWidth: "100%",
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        border: "1px solid #1e293b",
      }}
    >
      <Player
        ref={playerRef}
        component={HelloVideo}
        inputProps={inputProps}
        durationInFrames={120}
        fps={30}
        compositionWidth={1280}
        compositionHeight={720}
        style={{ width: "100%" }}
        controls
        // loop keeps the demo lively; this is low-frequency state so it's
        // fine to set it inline here.
        loop
      />
    </div>
  );
};

// ----------------------------------------------------------------------------

type ControlsProps = {
  playerRef: React.RefObject<PlayerRef | null>;
  title: string;
  setTitle: (v: string) => void;
  subtitle: string;
  setSubtitle: (v: string) => void;
  bgColor: string;
  setBgColor: (v: string) => void;
  accentColor: string;
  setAccentColor: (v: string) => void;
};

const Controls: React.FC<ControlsProps> = ({
  playerRef,
  title,
  setTitle,
  subtitle,
  setSubtitle,
  bgColor,
  setBgColor,
  accentColor,
  setAccentColor,
}) => {
  // BEST PRACTICE #3: pass the real browser event into play()/pause().
  // This keeps the call inside the user-gesture context (avoids autoplay
  // blocking) and is the documented pattern.
  const handlePlay = useCallback(
    (e: React.MouseEvent) => {
      playerRef.current?.play(e);
    },
    [playerRef],
  );

  const handlePause = useCallback(() => {
    playerRef.current?.pause();
  }, [playerRef]);

  const jumpToEnd = useCallback(() => {
    // seekTo is a frame number — programmatic control of the video timeline.
    playerRef.current?.seekTo(119);
  }, [playerRef]);

  return (
    <div
      style={{
        width: 800,
        maxWidth: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        background: "#0f172a",
        padding: 24,
        borderRadius: 16,
        border: "1px solid #1e293b",
      }}
    >
      {/* Programmatic playback controls — proves the app drives the video. */}
      <div style={{ display: "flex", gap: 10 }}>
        <Btn onClick={handlePlay}>▶ Play</Btn>
        <Btn onClick={handlePause}>⏸ Pause</Btn>
        <Btn onClick={jumpToEnd}>⏭ Jump to end</Btn>
      </div>

      <Field label="Title">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={inputStyle}
        />
      </Field>

      <Field label="Subtitle">
        <input
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          style={inputStyle}
        />
      </Field>

      <Field label="Background">
        <input
          type="color"
          value={bgColor}
          onChange={(e) => setBgColor(e.target.value)}
          style={{ ...inputStyle, padding: 2, width: 60, height: 38 }}
        />
      </Field>

      <Field label="Accent">
        <div style={{ display: "flex", gap: 8 }}>
          {ACCENT_PRESETS.map((c) => (
            <button
              key={c}
              onClick={() => setAccentColor(c)}
              aria-label={`accent ${c}`}
              style={{
                width: 38,
                height: 38,
                borderRadius: 8,
                background: c,
                border:
                  accentColor === c
                    ? "3px solid white"
                    : "3px solid transparent",
                cursor: "pointer",
              }}
            />
          ))}
        </div>
      </Field>
    </div>
  );
};

// --- tiny presentational helpers --------------------------------------------

const inputStyle: React.CSSProperties = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 8,
  color: "white",
  padding: "8px 12px",
  fontSize: 15,
  flex: 1,
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <label style={{ display: "flex", alignItems: "center", gap: 14 }}>
    <span style={{ width: 100, color: "#94a3b8", fontSize: 14 }}>{label}</span>
    {children}
  </label>
);

const Btn: React.FC<{
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}> = ({ onClick, children }) => (
  <button
    onClick={onClick}
    style={{
      background: "#1e293b",
      border: "1px solid #334155",
      borderRadius: 8,
      color: "white",
      padding: "8px 16px",
      fontSize: 14,
      cursor: "pointer",
    }}
  >
    {children}
  </button>
);
