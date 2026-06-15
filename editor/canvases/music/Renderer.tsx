import React, { useMemo } from "react";
import type { PulseProject } from "../../../src/pulse/schema";
import { Stage } from "../../../src/pulse/Stage";
import type { Analysis } from "../../../src/pulse/analysis";
import type { AudioGraph } from "../../../src/pulse/audioGraph";
import { computeGains } from "../../../src/pulse/audioGraph";
import { Button } from "@/components/ui/button";

/**
 * The bench preview in the MAIN window. Always renders Deck A — the
 * working deck you author and the agent edits. (The separate Preview
 * window renders Deck B.) Driven by the shared audio clock; a small
 * transport sits under the canvas.
 */
export const Renderer: React.FC<{
  doc: PulseProject;
  analysis: Analysis | null;
  engine: AudioGraph | null;
  /** Which deck the bench shows. Defaults to "A" (the working deck). */
  previewDeck?: "A" | "B";
  width?: number;
  height?: number;
}> = ({ doc, analysis, engine, previewDeck = "A", width = 960, height = 540 }) => {
  const stemVolumes = useMemo(() => computeGains(doc.stems), [doc.stems]);
  const getTime = () => engine?.currentTime() ?? 0;

  const deck = doc.decks[previewDeck];
  const hasStems = doc.stems.length > 0;

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#000" }}>
      <div style={{ flex: 1, minHeight: 0, display: "grid", placeItems: "center" }}>
        {hasStems ? (
          <Stage
            deck={deck}
            analysis={analysis}
            stemVolumes={stemVolumes}
            getTime={getTime}
            width={width}
            height={height}
          />
        ) : (
          <div style={{ color: "#555", fontSize: 13, textAlign: "center", lineHeight: 1.6 }}>
            <div style={{ fontSize: 15, color: "#888", marginBottom: 6 }}>Bench (Deck A)</div>
            Click <b style={{ color: "#9ad" }}>Import stems folder…</b> on the left to load a song.
            <br />
            Add effects in the <b>Effects</b> tab, then <b>Send Bench → Preview</b>.
          </div>
        )}
      </div>
      <Transport engine={engine} />
    </div>
  );
};

const Transport: React.FC<{ engine: AudioGraph | null }> = ({ engine }) => {
  const [, force] = React.useReducer((n) => n + 1, 0);
  // Repaint the scrubber a few times a second while playing.
  React.useEffect(() => {
    const id = window.setInterval(force, 200);
    return () => window.clearInterval(id);
  }, []);
  if (!engine) return <div style={{ height: 36, borderTop: "1px solid #222" }} />;
  const dur = engine.duration();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 6, borderTop: "1px solid #222", color: "#aaa", fontSize: 12 }}>
      <Button onClick={() => (engine.isPlaying() ? engine.pause() : engine.play())} variant="secondary" size="sm">
        {engine.isPlaying() ? "Pause" : "Play"}
      </Button>
      <input
        type="range"
        min={0}
        max={Math.max(0.01, dur)}
        step={0.01}
        value={engine.currentTime()}
        onChange={(e) => engine.seek(Number(e.target.value))}
        style={{ flex: 1 }}
      />
      <span style={{ width: 80, textAlign: "right" }}>
        {engine.currentTime().toFixed(1)} / {dur.toFixed(1)}s
      </span>
    </div>
  );
};
