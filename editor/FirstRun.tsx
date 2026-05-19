/**
 * First-run onboarding. Two steps:
 *
 *   1. Pick the agent CLI (claude / codex / gemini / opencode, or
 *      "plain shell"). Agents not on $PATH are listed greyed-out with
 *      their install hint.
 *
 *   2. Pick a permission mode — "supervised" leaves the agent's own
 *      permission prompts on; "skip" passes the agent's skip-prompts
 *      flag (Claude: --dangerously-skip-permissions, Codex:
 *      --full-auto, Gemini: --yolo). Skipped entirely if the chosen
 *      agent is "plain shell" or has no skip flag.
 *
 * Choices are persisted via set_default_agent + set_skip_permissions.
 * The shell stores `onboarded: true` after step 1, so closing the
 * window mid-step-2 still won't show the picker again next launch —
 * the permission setting just stays at its default (false).
 */
import React, { useEffect, useState } from "react";

type AgentInfo = {
  id: string;
  label: string;
  binary: string;
  installHint: string;
  installed: boolean;
  path: string | null;
};

type AgentId = "claude" | "codex" | "gemini" | "opencode";

const SKIP_FLAG: Record<AgentId, string | null> = {
  claude: "--dangerously-skip-permissions",
  codex: "--full-auto",
  gemini: "--yolo",
  opencode: null,
};

const SHELL: React.CSSProperties = {
  width: "100%",
  height: "100%",
  background: "#08080c",
  color: "#e4e4ee",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 40,
  boxSizing: "border-box",
};

export const FirstRun: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [step, setStep] = useState<"agent" | "permissions">("agent");
  const [chosen, setChosen] = useState<AgentId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const list = await invoke<AgentInfo[]>("detect_agents");
        setAgents(list);
      } catch (e) {
        setError(`Agent detection failed: ${(e as Error).message}`);
      }
    })();
  }, []);

  const pickAgent = async (id: AgentId | null) => {
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_default_agent", { agent: id });
      // If there's no agent or no skip flag for this agent, we're done.
      if (!id || SKIP_FLAG[id] === null) {
        onDone();
        return;
      }
      setChosen(id);
      setStep("permissions");
      setBusy(false);
    } catch (e) {
      setError(`Failed to save: ${(e as Error).message}`);
      setBusy(false);
    }
  };

  const pickPermissions = async (skip: boolean) => {
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_skip_permissions", { skip });
      onDone();
    } catch (e) {
      setError(`Failed to save: ${(e as Error).message}`);
      setBusy(false);
    }
  };

  if (step === "agent") {
    return (
      <div style={SHELL}>
        <div style={{ maxWidth: 560, width: "100%" }}>
          <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>
            Pick your agent
          </div>
          <div style={{ fontSize: 13, color: "#8b8b9a", marginBottom: 28, lineHeight: 1.5 }}>
            Kinetic Studio runs your chosen agent CLI in the terminal panel.
            Bring your own subscription — the studio doesn't broker tokens.
            Already logged in via the CLI? You're ready.
          </div>
          {error && (
            <div
              style={{
                padding: "8px 12px",
                background: "#3a1414",
                border: "1px solid #5a2020",
                color: "#ffb4b4",
                fontSize: 12,
                borderRadius: 6,
                marginBottom: 16,
              }}
            >
              {error}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {agents.map((a) => (
              <button
                key={a.id}
                disabled={!a.installed || busy}
                onClick={() => pickAgent(a.id as AgentId)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  background: a.installed ? "#0f0f18" : "#0a0a10",
                  border: "1px solid",
                  borderColor: a.installed ? "#2e2e3c" : "#1a1a24",
                  borderRadius: 8,
                  color: a.installed ? "#fafafa" : "#5a5a6e",
                  fontSize: 13,
                  cursor: a.installed && !busy ? "pointer" : "not-allowed",
                  textAlign: "left",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{a.label}</div>
                  <div style={{ fontSize: 11, color: "#6b6b80", marginTop: 2 }}>
                    {a.installed ? (
                      a.path
                    ) : (
                      <>
                        not on PATH — install with{" "}
                        <code style={{ background: "#1a1a24", padding: "1px 5px", borderRadius: 3 }}>
                          {a.installHint}
                        </code>
                      </>
                    )}
                  </div>
                </div>
                {a.installed && (
                  <div style={{ fontSize: 11, color: "#7c5cff", fontWeight: 600 }}>USE →</div>
                )}
              </button>
            ))}
          </div>
          <button
            onClick={() => pickAgent(null)}
            disabled={busy}
            style={{
              marginTop: 16,
              background: "transparent",
              border: "1px solid #2e2e3c",
              borderRadius: 6,
              color: "#8b8b9a",
              fontSize: 12,
              padding: "8px 14px",
              cursor: busy ? "default" : "pointer",
            }}
          >
            Skip — just give me a plain shell
          </button>
        </div>
      </div>
    );
  }

  // step === "permissions"
  const chosenLabel =
    agents.find((a) => a.id === chosen)?.label ?? (chosen ?? "agent");
  const flag = chosen ? SKIP_FLAG[chosen] : null;

  return (
    <div style={SHELL}>
      <div style={{ maxWidth: 560, width: "100%" }}>
        <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>
          Permission mode
        </div>
        <div style={{ fontSize: 13, color: "#8b8b9a", marginBottom: 28, lineHeight: 1.5 }}>
          {chosenLabel} will run inside the studio terminal with the
          project folder as its CWD. Do you want it to ask before every
          file edit / shell command, or just go?
        </div>
        {error && (
          <div
            style={{
              padding: "8px 12px",
              background: "#3a1414",
              border: "1px solid #5a2020",
              color: "#ffb4b4",
              fontSize: 12,
              borderRadius: 6,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            disabled={busy}
            onClick={() => pickPermissions(true)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              gap: 6,
              padding: "14px 14px",
              background: "#0f0f18",
              border: "1px solid #7c5cff",
              borderRadius: 8,
              color: "#fafafa",
              fontSize: 13,
              cursor: busy ? "default" : "pointer",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 600 }}>Skip permission prompts (recommended)</span>
              <span style={{ fontSize: 11, color: "#7c5cff", fontWeight: 600 }}>DEFAULT →</span>
            </div>
            <div style={{ fontSize: 11, color: "#8b8b9a", lineHeight: 1.5 }}>
              Launches with{" "}
              <code style={{ background: "#1a1a24", padding: "1px 5px", borderRadius: 3 }}>
                {flag}
              </code>
              . The agent edits {`./story.json`} and runs commands without
              stopping to ask. The CWD is the project folder, so blast
              radius is bounded.
            </div>
          </button>
          <button
            disabled={busy}
            onClick={() => pickPermissions(false)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              gap: 6,
              padding: "14px 14px",
              background: "#0f0f18",
              border: "1px solid #2e2e3c",
              borderRadius: 8,
              color: "#fafafa",
              fontSize: 13,
              cursor: busy ? "default" : "pointer",
              textAlign: "left",
            }}
          >
            <div style={{ fontWeight: 600 }}>Supervised — keep prompts</div>
            <div style={{ fontSize: 11, color: "#8b8b9a", lineHeight: 1.5 }}>
              The agent's normal permission flow stays on. Slower, safer.
              You can change this later.
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
