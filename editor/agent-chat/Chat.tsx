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
import { ThinkingIndicator } from "./ThinkingIndicator";
import { Button } from "@/components/ui/button";
import { Eye } from "../icons";

/** Sentinel an agent returns in continuous/watch mode when it has nothing
 *  worth interrupting for. A watch turn whose entire text is this is dropped
 *  from the transcript so the chat stays quiet. Kept in sync with the
 *  brainstorm skill (SKILL.md) which instructs the agent to emit it. */
export const WATCH_SILENT_SENTINEL = "NOTHING_TO_ADD";

/** Imperative handle the watch loop uses to drive the agent. */
export interface ChatHandle {
  /** Send a watch-origin turn (no user bubble; rendered as an observation).
   *  No-op if a turn is already running. */
  sendWatch: (prompt: string) => void;
  /** True while a turn is in flight (the watch loop gates on this). */
  isRunning: () => boolean;
}

interface Props {
  agentId: AgentId;
  agentLabel: string;
  cwd: string;
  onSwitchToTerminal: () => void;
  /** Called once with an imperative handle so a parent watch controller can
   *  drive watch turns. Optional — only the Brainstorm app uses it. */
  onReady?: (handle: ChatHandle) => void;
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
  onReady,
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
  // User message bubbles, keyed by the turn index they precede. Watch-origin
  // turns have no entry. Keyed (not array-appended) because watch turns
  // interleave with user turns, so a turn's index in state.turns no longer
  // equals its position among user messages.
  const [userBubbles, setUserBubbles] = useState<Record<number, string>>({});
  // Turn indices initiated by the watch loop (continuous mode). Used to (a)
  // render them as muted "observations" and (b) suppress a NOTHING_TO_ADD-only
  // turn. A ref because it's read inside event listeners / send closures.
  const watchTurnsRef = useRef<Set<number>>(new Set());

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
    (text: string, attachments: string[], origin: "user" | "watch" = "user") => {
      if (!adapter || activeTurnIdRef.current) return;
      const spawn = adapter.turnSpawnArgs({
        cwd,
        // Watch turns are observe-only; force read-only "plan" posture so the
        // agent can inspect the board (describe_scene/screenshot) but the
        // suggest-first rule isn't the only thing stopping a stray edit.
        permissionMode: origin === "watch" ? "plan" : permissionModeRef.current,
        prompt: composePrompt(text, attachments),
        sessionId: sessionIdRef.current,
        isFirstTurn: isFirstTurnRef.current,
      });
      if (!spawn) return;

      // The index this turn will occupy in state.turns (turns grow for BOTH
      // user and watch sends, so we key off the live turn count, not the
      // user-bubble count).
      const turnIndex = store.getState().turns.length;
      if (origin === "watch") {
        watchTurnsRef.current.add(turnIndex);
      } else {
        setUserBubbles((b) => ({ ...b, [turnIndex]: text }));
      }

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
    setUserBubbles({});
    watchTurnsRef.current.clear();
    store.reset();
  }, [stop, store]);

  const running = activeTurnId !== null;

  // Expose an imperative handle for the watch loop (continuous mode). Stable
  // across renders because send/running-via-ref don't change identity often;
  // the handle reads the ref so it always sees the live running state.
  useEffect(() => {
    onReady?.({
      sendWatch: (prompt: string) => send(prompt, [], "watch"),
      isRunning: () => activeTurnIdRef.current !== null,
    });
  }, [onReady, send]);

  // Show the "thinking" loader while a turn is in flight but isn't
  // actively streaming text right now: the gap after send (before the
  // first event), an empty turn, or the pause between a tool call/result
  // and the agent's next message. Hidden while text is streaming, since
  // the live-typing cursor is feedback enough.
  const lastTurn = state.turns[state.turns.length - 1];
  const lastItem = lastTurn?.items[lastTurn.items.length - 1];
  const streamingText =
    lastTurn?.status === "streaming" && lastItem?.type === "text";
  const showThinking = running && !streamingText;

  if (!supported) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Chat view is not yet supported for {agentLabel}. Use Terminal view.
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={onSwitchToTerminal}>
            Switch to Terminal
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-background">
      <SessionToolbar
        agentLabel={agentLabel}
        cwd={cwd}
        sessionAlive={state.turns.length > 0 || running}
        onEndSession={endSession}
      />
      <div className="flex flex-1 flex-col gap-1.5 overflow-auto px-4 py-2.5">
        {state.sessionError ? (
          <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/15 p-3 text-ui-base text-destructive">
            {state.sessionError}
          </div>
        ) : null}
        {state.turns.length === 0 && Object.keys(userBubbles).length === 0 ? (
          <div className="py-6 text-sm text-muted-foreground">
            Message {agentLabel} to get started. Your agent runs with your own
            subscription in this project.
          </div>
        ) : null}
        {state.turns.map((t, idx) => {
          const userBubble = userBubbles[idx];
          const isWatch = watchTurnsRef.current.has(idx);
          // Suppress a watch turn whose entire (ended) output is the silent
          // sentinel — the agent chose not to interrupt. While still
          // streaming we render nothing for it either (the leading text may
          // be the sentinel prefix); the ThinkingIndicator covers the gap.
          if (isWatch) {
            const text = t.items
              .filter((it): it is Extract<typeof it, { type: "text" }> => it.type === "text")
              .map((it) => it.text)
              .join("")
              .trim();
            if (text === WATCH_SILENT_SENTINEL || (t.status !== "streaming" && text === "")) {
              return <React.Fragment key={t.turnId} />;
            }
          }
          return (
            <React.Fragment key={t.turnId}>
              {userBubble !== undefined ? <UserMessage text={userBubble} /> : null}
              {isWatch ? (
                <div className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground/70">
                  <Eye className="size-3" />
                  <span>{agentLabel} is observing</span>
                </div>
              ) : null}
              {t.items.map((item, i) =>
                item.type === "tool" ? (
                  <ToolCard key={item.call.callId} call={item.call} />
                ) : (
                  <Message
                    key={`${item.msgId}-${i}`}
                    text={item.text}
                    streaming={
                      t.status === "streaming" && i === t.items.length - 1
                    }
                  />
                ),
              )}
              {t.errorMessage ? (
                <div className="text-xs text-destructive">
                  {t.errorMessage}
                </div>
              ) : null}
            </React.Fragment>
          );
        })}
        {/* Pending user bubble for an in-flight turn whose turn-start
            hasn't arrived yet (keeps the UI responsive on send). */}
        {userBubbles[state.turns.length] !== undefined ? (
          <UserMessage text={userBubbles[state.turns.length]} />
        ) : null}
        {showThinking ? <ThinkingIndicator /> : null}
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
