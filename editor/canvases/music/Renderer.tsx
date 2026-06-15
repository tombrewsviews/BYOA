import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PulseProject } from "../../../src/pulse/schema";
import { Stage } from "../../../src/pulse/Stage";
import type { Analysis } from "../../../src/pulse/analysis";
import type { AudioGraph } from "../../../src/pulse/audioGraph";
import { computeGains } from "../../../src/pulse/audioGraph";

/**
 * The bench preview in the MAIN window. Always renders Deck A — the
 * working deck you author and the agent edits. Sizes the WebGL canvas to
 * its container so it fills the bench column.
 */
export const Renderer: React.FC<{
  doc: PulseProject;
  analysis: Analysis | null;
  engine: AudioGraph | null;
  previewDeck?: "A" | "B";
  mediaUrlFor?: (effect: PulseProject["decks"]["A"]["effects"][number]) => string | null | undefined;
}> = ({ doc, analysis, engine, previewDeck = "A", mediaUrlFor }) => {
  const stemVolumes = useMemo(() => computeGains(doc.stems), [doc.stems]);
  const getTime = () => engine?.currentTime() ?? 0;
  const deck = doc.decks[previewDeck];
  const hasStems = doc.stems.length > 0;

  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: 360 });
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setSize({ w: Math.round(r.width), h: Math.round(r.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", background: "#000" }}>
      <div ref={hostRef} style={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
        {hasStems ? (
          <Stage
            deck={deck}
            analysis={analysis}
            stemVolumes={stemVolumes}
            getTime={getTime}
            width={size.w}
            height={size.h}
            mediaUrlFor={mediaUrlFor}
          />
        ) : (
          <div style={{ color: "#555", fontSize: 13, textAlign: "center", lineHeight: 1.6 }}>
            <div style={{ fontSize: 15, color: "#888", marginBottom: 6 }}>Bench (Deck A)</div>
            Click <b style={{ color: "#9ad" }}>Import stems folder…</b> on the left to load a song,
            <br />
            add effects under each stem on the right, then <b>Send Bench → Preview</b>.
          </div>
        )}
      </div>
    </div>
  );
};
