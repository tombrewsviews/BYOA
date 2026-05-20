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
import type { AgentAdapter, AgentId, PermissionMode } from "./adapters/types";
import { getAdapter } from "./adapters/registry";
import { createChatStore } from "./ChatStore";
import { Message } from "./Message";
import { UserMessage } from "./UserMessage";
import { ToolCard } from "./ToolCard";
import { QuestionCard } from "./QuestionCard";
import { Composer } from "./Composer";
import { SessionToolbar } from "./SessionToolbar";

interface Props {
  agentId: AgentId;
  agentLabel: string;
  cwd: string;
  onSwitchToTerminal: () => void;
}

/** Inline @path references into the prompt — claude reads files itself. */
const composePrompt = (text: string, attachments: string[]): string => {
  const refs = attachments.map((p) => `@${p}`).join(" ");
  return refs ? `${refs}\n\n${text}` : text;
};

const newSessionId = (): string => {
  try {
    return crypto.randomUUID();
  } catch {
    // Fallback for environments without crypto.randomUUID.
    return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

export const Chat: React.FC<Props> = ({
  agentId,
  agentLabel,
  cwd,
  onSwitchToTerminal,
}) => {
  const adapter: AgentAdapter | null = useMemo(
    () => getAdapter(agentId),
    [agentId],
  );

  const storeRef = useRef(createChatStore());
  const store = storeRef.current;

  // Conversation id, stable for the life of this Chat. Turn 1 establishes
  // it via --session-id; later turns --resume it.
  const sessionIdRef = useRef<string>(newSessionId());
  const isFirstTurnRef = useRef(true);
  // The currently-running turn's process id (from agent_chat_run_turn), or
  // null when idle. Used for the Stop button and to gate sending.
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const activeTurnIdRef = useRef<string | null>(null);
  // User message bubbles, in send order.
  const [userBubbles, setUserBubbles] = useState<{ id: number; text: string }[]>(
    [],
  );

  // Permission posture for the next turn, controlled by the dropdown.
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("full");
  const permissionModeRef = useRef<PermissionMode>(permissionMode);
  permissionModeRef.current = permissionMode;

  const state = useSyncExternalStore(
    store.subscribe,
    () => store.getState(),
    () => store.getState(),
  );

  const supported = adapter?.supportsChat === true;

  // Cleanup any in-flight turn when the component unmounts (view switch).
  useEffect(() => {
    return () => {
      const tid = activeTurnIdRef.current;
      if (tid) void invoke("agent_chat_cancel", { id: tid });
    };
  }, []);

  const send = useCallback(
    (text: string, attachments: string[]) => {
      if (!adapter || activeTurnIdRef.current) return;
      const spawn = adapter.turnSpawnArgs({
        cwd,
        permissionMode: permissionModeRef.current,
        prompt: composePrompt(text, attachments),
        sessionId: sessionIdRef.current,
        isFirstTurn: isFirstTurnRef.current,
      });
      if (!spawn) return;

      setUserBubbles((b) => [...b, { id: Date.now(), text }]);

      void (async () => {
        let unlistenData: UnlistenFn | null = null;
        let unlistenStderr: UnlistenFn | null = null;
        let unlistenClosed: UnlistenFn | null = null;

        const cleanup = () => {
          unlistenData?.();
          unlistenStderr?.();
          unlistenClosed?.();
        };

        try {
          const turnId = await invoke<string>("agent_chat_run_turn", {
            spawn,
          });
          setActiveTurnId(turnId);
          activeTurnIdRef.current = turnId;

          [unlistenData, unlistenStderr, unlistenClosed] = await Promise.all([
            listen<string>(`agent-chat://${turnId}/data`, (e) => {
              const bytes = new TextEncoder().encode(e.payload);
              adapter.parseChunk(bytes, (ev) => store.applyEvent(ev));
            }),
            listen<string>(`agent-chat://${turnId}/stderr`, (e) => {
              const msg = e.payload.trim();
              if (msg) {
                store.applyEvent({
                  kind: "error",
                  message: `stderr: ${msg}`,
                  recoverable: true,
                });
              }
            }),
            listen<null>(`agent-chat://${turnId}/closed`, () => {
              // Normal end of a turn — NOT an error. Mark this turn done.
              isFirstTurnRef.current = false;
              setActiveTurnId(null);
              activeTurnIdRef.current = null;
              cleanup();
            }),
          ]);
        } catch (e) {
          store.applyEvent({
            kind: "error",
            message: `failed to start turn: ${(e as Error).message ?? e}`,
            recoverable: false,
          });
          setActiveTurnId(null);
          activeTurnIdRef.current = null;
          cleanup();
        }
      })();
    },
    [adapter, cwd, store],
  );

  const stop = useCallback(() => {
    const tid = activeTurnIdRef.current;
    if (!tid) return;
    void invoke("agent_chat_cancel", { id: tid });
    setActiveTurnId(null);
    activeTurnIdRef.current = null;
  }, []);

  const endSession = useCallback(() => {
    stop();
    // Start a fresh conversation id; clear the transcript.
    sessionIdRef.current = newSessionId();
    isFirstTurnRef.current = true;
    setUserBubbles([]);
    store.reset();
  }, [stop, store]);

  const running = activeTurnId !== null;

  if (!supported) {
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
        sessionAlive={state.turns.length > 0 || running}
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
        {state.turns.length === 0 && userBubbles.length === 0 ? (
          <div
            style={{
              color: "#6a6a78",
              fontFamily:
                "system-ui, -apple-system, Helvetica Neue, sans-serif",
              fontSize: 14,
              padding: "24px 0",
            }}
          >
            Message {agentLabel} to get started. Your agent runs with your own
            subscription in this project.
          </div>
        ) : null}
        {/*
          TODO: userBubbles are indexed by turn position, which assumes
          every turn is initiated by a user message. If the agent ever
          emits agent-initiated turns, the alignment will drift. Replace
          with turnId-keyed lookup when that case lands.
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
        {/* Pending user bubble for an in-flight turn whose turn-start
            hasn't arrived yet (keeps the UI responsive on send). */}
        {userBubbles.length > state.turns.length ? (
          <UserMessage text={userBubbles[userBubbles.length - 1].text} />
        ) : null}
        {state.pendingQuestion && !running ? (
          <QuestionCard
            questions={state.pendingQuestion.questions}
            disabled={running}
            onAnswer={(answer) => send(answer, [])}
          />
        ) : null}
      </div>
      <Composer
        disabled={running}
        onSubmit={send}
        onStop={stop}
        running={running}
        permissionMode={permissionMode}
        onPermissionModeChange={setPermissionMode}
      />
    </div>
  );
};
