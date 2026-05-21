/**
 * Prompt-mode selector — a compact dropdown that sits at the end of the
 * Terminal/Chat toggle row.
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

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
    <Select value={mode} onValueChange={(v) => void choose(v as PromptMode)}>
      <SelectTrigger
        size="sm"
        title="How agent prompts modify the story. Default: append at end."
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MODES.map((m) => (
          <SelectItem key={m} value={m}>
            {LABELS[m]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
