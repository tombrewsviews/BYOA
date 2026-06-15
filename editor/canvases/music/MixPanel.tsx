import React from "react";
import type { PulseProject, MixState } from "../../../src/pulse/schema";
import { Button } from "@/components/ui/button";

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
 * Preview panel (main window). The bench IS Deck A. This panel manages
 * the separate live Preview window (Deck B):
 *   - Open Preview Window  → spawns the fullscreen-capable Deck-B window.
 *   - Send Bench → Preview → copies the current Deck A into Deck B and
 *     transitions the preview window to it, using the chosen template /
 *     duration / curve.
 */
export const MixPanel: React.FC<{
  doc: PulseProject;
  onChange: (next: PulseProject | ((p: PulseProject) => PulseProject)) => void;
  onOpenPreview: () => void;
  onSendToPreview: () => void;
}> = ({ doc, onChange, onOpenPreview, onSendToPreview }) => {
  const set = (patch: Partial<MixState>) =>
    onChange((p) => ({ ...p, mix: { ...p.mix, ...patch } }));
  const transitioning = doc.mix.active === "transitioning";
  return (
    <div style={{ padding: 8, borderTop: "1px solid #222", fontSize: 12, color: "#bbb" }}>
      <div style={{ fontWeight: 600, color: "#ddd", marginBottom: 6 }}>Preview window</div>
      <Button onClick={onOpenPreview} variant="secondary" size="sm" className="mb-2 w-full">
        Open Preview Window ⤢
      </Button>
      <div style={{ color: "#888", marginBottom: 6 }}>Transition (how the new look appears)</div>
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
      <Button onClick={onSendToPreview} disabled={transitioning} variant="default" size="sm" className="w-full">
        {transitioning ? `Transitioning… ${(doc.mix.progress * 100) | 0}%` : "Send Bench → Preview"}
      </Button>
    </div>
  );
};
