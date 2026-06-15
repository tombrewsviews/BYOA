import React from "react";
import type { CanvasInspectorProps } from "../../canvas";
import type { PulseProject } from "../../../src/pulse/schema";

/**
 * Minimal stem list for the vertical slice: per-stem classified role,
 * label, and a volume slider. Volume scales the stem's VISUAL amplitude
 * (and, once the per-stem audio graph lands, its audio gain). The full
 * mixer + effect-stack + binding editor is the follow-up plan.
 */
export const Inspector: React.FC<CanvasInspectorProps<PulseProject>> = ({ doc, onChange }) => (
  <div style={{ padding: 12, fontSize: 12, color: "#aaa", overflow: "auto", height: "100%" }}>
    <div style={{ fontWeight: 600, color: "#ddd", marginBottom: 8 }}>Stems</div>
    {doc.stems.length === 0 && <div>No stems imported yet.</div>}
    {doc.stems.map((s, i) => (
      <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ width: 64, color: "#7a9", fontVariant: "small-caps" }}>{s.role}</span>
        <span style={{ flex: 1, color: "#ccc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {s.label}
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={s.volume}
          onChange={(e) => {
            const v = Number(e.target.value);
            onChange((prev) => ({
              ...prev,
              stems: prev.stems.map((x, j) => (j === i ? { ...x, volume: v } : x)),
            }));
          }}
        />
      </div>
    ))}
  </div>
);
