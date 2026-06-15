import React from "react";
import type { CanvasInspectorProps } from "../../canvas";
import type { PulseProject } from "../../../src/pulse/schema";
import { StemRack } from "./StemRack";

/**
 * Pulse bench inspector — a single Reason-style stacked rack: one deck per
 * stem, each with its audio level and (expanded) the effects driven by it.
 * No more Stems/Effects tabs; it's one list.
 */
export const Inspector: React.FC<CanvasInspectorProps<PulseProject>> = ({ doc, onChange }) => {
  const update = onChange as (next: PulseProject | ((p: PulseProject) => PulseProject)) => void;
  return (
    <div style={{ height: "100%", overflow: "auto" }}>
      {doc.stems.length === 0 ? (
        <div style={{ padding: 16, color: "#777", fontSize: 12, lineHeight: 1.6 }}>
          No stems imported yet. Click <b style={{ color: "#9ad" }}>Import stems folder…</b> to load a song,
          then each stem appears here as a deck with its own audio level and effects.
        </div>
      ) : (
        <StemRack project={doc} onChange={update} />
      )}
    </div>
  );
};
