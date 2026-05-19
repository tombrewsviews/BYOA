import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentAdapter, AgentId } from "./adapters/types";
import { getAdapter } from "./adapters/registry";
import { createChatStore } from "./ChatStore";
import { Message } from "./Message";
import { UserMessage } from "./UserMessage";
import { ToolCard } from "./ToolCard";
import { PermissionDialog } from "./PermissionDialog";
import { Composer } from "./Composer";
import { SessionToolbar } from "./SessionToolbar";

interface Props {
  agentId: AgentId;
  agentLabel: string;
  cwd: string;
  skipPermissions: boolean;
  onSwitchToTerminal: () => void;
}

export const Chat: React.FC<Props> = ({
  agentId,
  agentLabel,
  cwd,
  skipPermissions,
  onSwitchToTerminal,
}) => {
  const adapter: AgentAdapter | null = useMemo(
    () => getAdapter(agentId),
    [agentId],
  );
  const storeRef = useRef(createChatStore());
  const store = storeRef.current;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [userBubbles, setUserBubbles] = useState<{ id: number; text: string }[]>(
    [],
  );
  const [running, setRunning] = useState(false);

  const state = useSyncExternalStore(
    store.subscribe,
    () => store.getState(),
    () => store.getState(),
  );

  // Mount: spawn agent.
  useEffect(() => {
    if (!adapter) return;
    const spawn = adapter.spawnArgs({ cwd, skipPermissions });
    if (!spawn) return;

    let unlistenData: UnlistenFn | null = null;
    let unlistenStderr: UnlistenFn | null = null;
    let unlistenClosed: UnlistenFn | null = null;
    let openedId: string | null = null;
    let aborted = false;

    void (async () => {
      try {
        const id = await invoke<string>("agent_chat_open", {
          spawn: { ...spawn, cwd },
        });
        if (aborted) {
          void invoke("agent_chat_close", { id });
          return;
        }
        openedId = id;
        setSessionId(id);

        unlistenData = await listen<string>(
          `agent-chat://${id}/data`,
          (e) => {
            const bytes = new TextEncoder().encode(e.payload);
            adapter.parseChunk(bytes, (ev) => store.applyEvent(ev));
          },
        );
        unlistenStderr = await listen<string>(
          `agent-chat://${id}/stderr`,
          (e) => {
            // stderr is informational — the agent's CLI noise. Don't parse
            // as JSON. Surface as a recoverable error so the UI can show it.
            store.applyEvent({
              kind: "error",
              message: `stderr: ${e.payload.trim()}`,
              recoverable: true,
            });
          },
        );
        unlistenClosed = await listen<null>(`agent-chat://${id}/closed`, () => {
          store.applyEvent({
            kind: "error",
            message: "agent process exited",
            recoverable: false,
          });
        });
      } catch (e) {
        store.applyEvent({
          kind: "error",
          message: `agent_chat_open failed: ${(e as Error).message ?? e}`,
          recoverable: false,
        });
      }
    })();

    return () => {
      aborted = true;
      unlistenData?.();
      unlistenStderr?.();
      unlistenClosed?.();
      if (openedId) void invoke("agent_chat_close", { id: openedId });
    };
  }, [adapter, cwd, skipPermissions, store]);

  // Track running state based on turn status.
  useEffect(() => {
    const last = state.turns[state.turns.length - 1];
    setRunning(!!last && last.status === "streaming");
  }, [state.turns]);

  const send = useCallback(
    (text: string, attachments: string[]) => {
      if (!adapter || !sessionId) return;
      const bytes = adapter.encodeUserInput(text, attachments);
      setUserBubbles((b) => [...b, { id: Date.now(), text }]);
      void invoke("agent_chat_write", {
        id: sessionId,
        data: Array.from(bytes),
      });
    },
    [adapter, sessionId],
  );

  const stop = useCallback(() => {
    if (!sessionId) return;
    // Send Ctrl-C (0x03). Adapter-agnostic best effort.
    void invoke("agent_chat_write", { id: sessionId, data: [0x03] });
  }, [sessionId]);

  const decide = useCallback(
    (promptId: string, decision: "allow" | "allow-always" | "deny") => {
      if (!adapter || !sessionId) return;
      const bytes = adapter.encodePermissionDecision(promptId, decision);
      if (bytes) {
        void invoke("agent_chat_write", {
          id: sessionId,
          data: Array.from(bytes),
        });
      }
      store.applyEvent({ kind: "permission-decided", promptId, decision });
    },
    [adapter, sessionId, store],
  );

  const endSession = useCallback(() => {
    if (!sessionId) return;
    void invoke("agent_chat_close", { id: sessionId });
    setSessionId(null);
  }, [sessionId]);

  if (!adapter || !adapter.spawnArgs({ cwd, skipPermissions })) {
    return (
      <div
        style={{
          padding: 16,
          fontFamily: "system-ui, -apple-system, Helvetica Neue, sans-serif",
          color: "#cdcdd8",
        }}
      >
        Chat view is not yet supported for {agentLabel}. Use Terminal view.
        <div style={{ marginTop: 12 }}>
          <button
            onClick={onSwitchToTerminal}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid #3a3a48",
              background: "transparent",
              color: "#e4e4ee",
              cursor: "pointer",
            }}
          >
            Switch to Terminal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#0a0a10",
      }}
    >
      <SessionToolbar
        agentLabel={agentLabel}
        cwd={cwd}
        sessionAlive={state.sessionAlive}
        onSwitchToTerminal={onSwitchToTerminal}
        onEndSession={endSession}
      />
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "10px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {state.turns.map((t, idx) => {
          const userBubble = userBubbles[idx];
          return (
            <React.Fragment key={t.turnId}>
              {userBubble ? <UserMessage text={userBubble.text} /> : null}
              {t.toolCalls.map((c) => (
                <ToolCard key={c.callId} call={c} />
              ))}
              {t.assistantText ? (
                <Message
                  text={t.assistantText}
                  streaming={t.status === "streaming"}
                />
              ) : null}
              {t.errorMessage ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "#ef4444",
                    fontFamily:
                      "system-ui, -apple-system, Helvetica Neue, sans-serif",
                  }}
                >
                  {t.errorMessage}
                </div>
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
      {state.pendingPermission ? (
        <PermissionDialog
          pending={state.pendingPermission}
          onDecide={decide}
        />
      ) : null}
      <Composer
        disabled={!sessionId || running}
        onSubmit={send}
        onStop={stop}
        running={running}
      />
    </div>
  );
};
