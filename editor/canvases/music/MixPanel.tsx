import React from "react";
import type { PulseProject, MixState } from "../../../src/pulse/schema";

const TEMPLATES: MixState["template"][] = [
  "cut",
  "crossfade",
  "progressive",
  "seesaw",
  "fast",
  "slow",
  "morphParams",
];
const CURVES: MixState["curve"][] = ["linear", "ease", "exp", "seesaw", "step"];

/**
 * Mix panel: pick the transition template, duration, and curve, then
 * Release Deck B onto the live stage (Deck A). Release kicks off the
 * templated A→B transition animated in PulseApp.
 */
export const MixPanel: React.FC<{
  doc: PulseProject;
  onChange: (next: PulseProject | ((p: PulseProject) => PulseProject)) => void;
  onRelease: () => void;
}> = ({ doc, onChange, onRelease }) => {
  const set = (patch: Partial<MixState>) =>
    onChange((p) => ({ ...p, mix: { ...p.mix, ...patch } }));
  const transitioning = doc.mix.active === "transitioning";
  return (
    <div style={{ padding: 8, borderTop: "1px solid #222", fontSize: 12, color: "#bbb" }}>
      <div style={{ fontWeight: 600, color: "#ddd", marginBottom: 6 }}>Mix · live: {doc.mix.active}</div>
      <label style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        template
        <select value={doc.mix.template} onChange={(e) => set({ template: e.target.value as MixState["template"] })}>
          {TEMPLATES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        duration (s)
        <input
          style={{ width: 64 }}
          type="number"
          min={0.2}
          step={0.2}
          value={doc.mix.durationSec}
          onChange={(e) => set({ durationSec: Number(e.target.value) })}
        />
      </label>
      <label style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        curve
        <select value={doc.mix.curve} onChange={(e) => set({ curve: e.target.value as MixState["curve"] })}>
          {CURVES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <button onClick={onRelease} disabled={transitioning} style={{ width: "100%", padding: 8 }}>
        {transitioning ? `Transitioning… ${(doc.mix.progress * 100) | 0}%` : "Release Deck B → Stage"}
      </button>
    </div>
  );
};
