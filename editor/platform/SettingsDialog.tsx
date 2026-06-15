import React, { useEffect, useState } from "react";
import { isTauri } from "../runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Global wrapper-app settings. v1 has a single setting: the free-text
 * "agent starting command" run in the terminal when a canvas app launches.
 * When set, it overrides the built-in agent launcher (so any agent in any
 * mode works, e.g. `claude --dangerously-skip-permissions`). Persisted via
 * the Rust settings store (~/.kinetic-studio/settings.json); takes effect
 * on the next terminal/app launch.
 */
export const SettingsDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [command, setCommand] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!isTauri()) return;
      const { invoke } = await import("@tauri-apps/api/core");
      const s = await invoke<{ agentStartingCommand?: string | null }>("get_settings").catch(() => null);
      if (s?.agentStartingCommand) setCommand(s.agentStartingCommand);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      const trimmed = command.trim();
      await invoke("set_agent_starting_command", { command: trimmed === "" ? null : trimmed }).catch(() => {});
    }
    setSaving(false);
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-lg border border-border bg-card p-5 text-foreground shadow-xl"
        style={{ width: 520, maxWidth: "90vw" }}
      >
        <div className="mb-1 text-base font-semibold">Settings</div>
        <div className="mb-4 text-sm text-muted-foreground">
          Applied the next time a terminal starts.
        </div>

        <label className="mb-1.5 block text-sm font-medium">Agent starting command</label>
        <Input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="e.g. claude --dangerously-skip-permissions"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
        />
        <div className="mt-1.5 text-xs text-muted-foreground">
          Runs verbatim in the terminal on launch. Overrides the built-in agent launcher.
          Leave empty to use the default.
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
};
