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
import { Button } from "@/components/ui/button";
import { ArrowRight } from "./icons";

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

const SHELL =
  "flex h-full w-full items-center justify-center bg-background p-10 text-muted-foreground";

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
      <div className={SHELL}>
        <div className="w-full max-w-[560px]">
          <div className="mb-1.5 text-2xl font-bold text-foreground">
            Pick your agent
          </div>
          <div className="mb-7 text-[13px] leading-relaxed text-muted-foreground">
            Kinetic Studio runs your chosen agent CLI in the terminal panel.
            Bring your own subscription — the studio doesn't broker tokens.
            Already logged in via the CLI? You're ready.
          </div>
          {error && (
            <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <div className="flex flex-col gap-2">
            {agents.map((a) => (
              <button
                key={a.id}
                disabled={!a.installed || busy}
                onClick={() => pickAgent(a.id as AgentId)}
                className="flex items-center gap-3 rounded-md border border-border bg-secondary px-3.5 py-3 text-left text-[13px] text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex-1">
                  <div className="font-semibold">{a.label}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {a.installed ? (
                      a.path
                    ) : (
                      <>
                        not on PATH — install with{" "}
                        <code className="rounded-sm bg-background px-1.5 py-px">
                          {a.installHint}
                        </code>
                      </>
                    )}
                  </div>
                </div>
                {a.installed && (
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-foreground">
                    USE <ArrowRight className="size-3" />
                  </div>
                )}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => pickAgent(null)}
            disabled={busy}
            className="mt-4"
          >
            Skip — just give me a plain shell
          </Button>
        </div>
      </div>
    );
  }

  // step === "permissions"
  const chosenLabel =
    agents.find((a) => a.id === chosen)?.label ?? (chosen ?? "agent");
  const flag = chosen ? SKIP_FLAG[chosen] : null;

  return (
    <div className={SHELL}>
      <div className="w-full max-w-[560px]">
        <div className="mb-1.5 text-2xl font-bold text-foreground">
          Permission mode
        </div>
        <div className="mb-7 text-[13px] leading-relaxed text-muted-foreground">
          {chosenLabel} will run inside the studio terminal with the
          project folder as its CWD. Do you want it to ask before every
          file edit / shell command, or just go?
        </div>
        {error && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <button
            disabled={busy}
            onClick={() => pickPermissions(true)}
            className="flex flex-col items-stretch gap-1.5 rounded-md border border-transparent bg-primary p-3.5 text-left text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <div className="flex justify-between">
              <span className="font-semibold">Skip permission prompts (recommended)</span>
              <span className="flex items-center gap-1 text-[11px] font-semibold">
                DEFAULT <ArrowRight className="size-3" />
              </span>
            </div>
            <div className="text-[11px] leading-relaxed text-primary-foreground/70">
              Launches with{" "}
              <code className="rounded-sm bg-background/20 px-1.5 py-px">
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
            className="flex flex-col items-stretch gap-1.5 rounded-md border border-border bg-secondary p-3.5 text-left text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            <div className="font-semibold">Supervised — keep prompts</div>
            <div className="text-[11px] leading-relaxed text-muted-foreground">
              The agent's normal permission flow stays on. Slower, safer.
              You can change this later.
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
