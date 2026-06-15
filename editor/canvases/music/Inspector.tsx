import React, { useState } from "react";
import type { CanvasInspectorProps } from "../../canvas";
import type { PulseProject } from "../../../src/pulse/schema";
import { EffectStack } from "./EffectStack";

type Tab = "stems" | "effects";

/**
 * Pulse bench inspector. The MAIN window is the working bench (Deck A),
 * so this edits Deck A only: a Stems mixer (volume = visual amplitude,
 * plus mute) and the Deck A effect stack + bindings. Deck B is the live
 * preview window and is authored by "sending" the bench to it — not
 * edited here.
 */
export const Inspector: React.FC<CanvasInspectorProps<PulseProject>> = ({ doc, onChange }) => {
  const [tab, setTab] = useState<Tab>("stems");
  const update = onChange as (next: PulseProject | ((p: PulseProject) => PulseProject)) => void;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", color: "#aaa" }}>
      <div style={{ display: "flex", flex: "none", borderBottom: "1px solid #222" }}>
        {(["stems", "effects"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: "8px 4px",
              background: tab === t ? "#181818" : "transparent",
              color: tab === t ? "#ddd" : "#888",
              border: 0,
              borderBottom: tab === t ? "2px solid #6a9" : "2px solid transparent",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {t === "stems" ? "Stems" : "Effects"}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 12, fontSize: 12 }}>
        {tab === "stems" ? (
          <>
            {doc.stems.length === 0 && <div>No stems imported yet.</div>}
            {doc.stems.map((s, i) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <input
                  type="checkbox"
                  title="mute"
                  checked={!s.muted}
                  onChange={(e) =>
                    update((p) => ({
                      ...p,
                      stems: p.stems.map((x, j) => (j === i ? { ...x, muted: !e.target.checked } : x)),
                    }))
                  }
                />
                <span style={{ width: 60, color: "#7a9", fontVariant: "small-caps" }}>{s.role}</span>
                <span
                  style={{ flex: 1, color: "#ccc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
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
                    update((p) => ({
                      ...p,
                      stems: p.stems.map((x, j) => (j === i ? { ...x, volume: v } : x)),
                    }));
                  }}
                />
              </div>
            ))}
          </>
        ) : (
          <EffectStack project={doc} deckKey="A" onChange={update} />
        )}
      </div>
    </div>
  );
};
