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

  const spawn = useMemo(
    () => adapter?.spawnArgs({ cwd, skipPermissions }) ?? null,
    [adapter, cwd, skipPermissions],
  );
  const storeRef = useRef(createChatStore());
  const store = storeRef.current;
  const userClosedRef = useRef(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [userBubbles, setUserBubbles] = useState<{ id: number; text: string }[]>(
    [],
  );
  const state = useSyncExternalStore(
    store.subscribe,
    () => store.getState(),
    () => store.getState(),
  );
  const running = state.turns.at(-1)?.status === "streaming";

  // Mount: spawn agent.
  useEffect(() => {
    if (!adapter || !spawn) return;

    let unlistenData: UnlistenFn | null = null;
    let unlistenStderr: UnlistenFn | null = null;
    let unlistenClosed: UnlistenFn | null = null;
    let openedId: string | null = null;
    let aborted = false;

    void (async () => {
      try {
        const id = await invoke<string>("agent_chat_open", {
          spawn,
        });
        if (aborted) {
          void invoke("agent_chat_close", { id });
          return;
        }
        openedId = id;
        setSessionId(id);

        [unlistenData, unlistenStderr, unlistenClosed] = await Promise.all([
          listen<string>(`agent-chat://${id}/data`, (e) => {
            const bytes = new TextEncoder().encode(e.payload);
            adapter.parseChunk(bytes, (ev) => store.applyEvent(ev));
          }),
          listen<string>(`agent-chat://${id}/stderr`, (e) => {
            // stderr is informational — the agent's CLI noise. Don't parse
            // as JSON. Surface as a recoverable error so the UI can show it.
            store.applyEvent({
              kind: "error",
              message: `stderr: ${e.payload.trim()}`,
              recoverable: true,
            });
          }),
          listen<null>(`agent-chat://${id}/closed`, () => {
            if (userClosedRef.current) return; // user-initiated; expected.
            store.applyEvent({
              kind: "error",
              message: "agent process exited",
              recoverable: false,
            });
          }),
        ]);
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
  }, [adapter, spawn, store]);

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
    userClosedRef.current = true;
    void invoke("agent_chat_close", { id: sessionId });
    setSessionId(null);
  }, [sessionId]);

  if (!adapter || !spawn) {
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
        sessionAlive={state.sessionAlive && sessionId !== null}
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
        {state.sessionError ? (
          <div
            style={{
              fontSize: 13,
              padding: 12,
              borderRadius: 8,
              background: "#2a1517",
              border: "1px solid #5a2a30",
              color: "#fda4af",
              fontFamily:
                "system-ui, -apple-system, Helvetica Neue, sans-serif",
              marginBottom: 12,
            }}
          >
            {state.sessionError}
          </div>
        ) : null}
        {/*
          TODO: userBubbles are indexed by turn position, which assumes
          every turn is initiated by a user message. If the agent ever
          emits agent-initiated turns (proactive messages, continuation
          chains), the alignment will drift. Replace with turnId-keyed
          lookup when that case lands.
        */}
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
