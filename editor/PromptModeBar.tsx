/**
 * Prompt-mode selector — sits above the terminal/library tab strip.
 *
 * Tells the agent how the user wants new prompts integrated into the
 * existing story:
 *   - replace : wipe and rewrite.
 *   - append  : add new beats after the existing ones (default).
 *   - insert  : insert at the current playhead. (Placeholder for now —
 *               agent treats it like append until the playhead is
 *               exposed in the story file.)
 *
 * Persists per-project under `.kinetic-studio/prompt-mode`. The skill
 * reads that file on every agent turn.
 */
import React, { useEffect, useState } from "react";
import { isTauri } from "./runtime";

export type PromptMode = "replace" | "append" | "insert";
const MODES: PromptMode[] = ["replace", "append", "insert"];
const LABELS: Record<PromptMode, string> = {
  replace: "Replace",
  append: "Append",
  insert: "Insert",
};

export const PromptModeBar: React.FC = () => {
  const [mode, setModeLocal] = useState<PromptMode>("append");
  const [busy, setBusy] = useState(false);

  // Load current mode from disk on mount.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const v = await invoke<string>("get_prompt_mode");
        if (!cancelled && (v === "replace" || v === "append" || v === "insert")) {
          setModeLocal(v);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = async (next: PromptMode) => {
    if (next === mode || busy) return;
    setBusy(true);
    setModeLocal(next); // optimistic
    if (isTauri()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_prompt_mode", { mode: next });
      } catch {
        // revert on error — silent for now, not critical
      }
    }
    setBusy(false);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 6px",
        background: "#08080c",
        borderBottom: "1px solid #232330",
        fontSize: 10,
        color: "#6b6b80",
        flex: "0 0 auto",
      }}
      title="How agent prompts modify the story. Default: append at end."
    >
      <span style={{ flex: "0 0 auto", textTransform: "uppercase", letterSpacing: 0.5 }}>
        Prompt
      </span>
      {MODES.map((m) => (
        <button
          key={m}
          onClick={() => void choose(m)}
          aria-pressed={mode === m}
          style={{
            padding: "2px 8px",
            fontSize: 10,
            borderRadius: 4,
            border: "1px solid",
            borderColor: mode === m ? "#7c5cff" : "#2e2e3c",
            background: mode === m ? "#7c5cff" : "transparent",
            color: mode === m ? "white" : "#8b8b9a",
            cursor: "pointer",
          }}
        >
          {LABELS[m]}
        </button>
      ))}
    </div>
  );
};
