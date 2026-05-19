import type { ChatEvent } from "./events";

export interface ToolCallRecord {
  callId: string;
  name: string;
  input: unknown;
  result: { ok: boolean; output: unknown } | null;
}

export interface TurnRecord {
  turnId: string;
  startedAt: number;
  endedAt: number | null;
  assistantText: string;
  toolCalls: ToolCallRecord[];
  status: "streaming" | "ended" | "errored";
  errorMessage?: string;
}

export interface PendingPermission {
  promptId: string;
  tool: string;
  args: unknown;
  scope: string;
}

export interface ChatState {
  turns: TurnRecord[];
  pendingPermission: PendingPermission | null;
  sessionAlive: boolean;
  /** Session-level error not associated with any turn (e.g. spawn failure
   *  before any turn started, agent process killed at startup). */
  sessionError: string | null;
}

export interface ChatStore {
  getState(): ChatState;
  applyEvent(e: ChatEvent): void;
  subscribe(fn: () => void): () => void;
  reset(): void;
}

const initialState = (): ChatState => ({
  turns: [],
  pendingPermission: null,
  sessionAlive: true,
  sessionError: null,
});

export const createChatStore = (): ChatStore => {
  let state: ChatState = initialState();
  const subs = new Set<() => void>();
  const notify = () => {
    for (const fn of subs) fn();
  };
  const currentTurn = (): TurnRecord | null =>
    state.turns.length ? state.turns[state.turns.length - 1] : null;

  return {
    getState: () => state,
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    reset: () => {
      state = initialState();
      notify();
    },
    applyEvent: (e) => {
      switch (e.kind) {
        case "turn-start": {
          // Defend against duplicate turn-start for the same turnId.
          // A protocol bug or reconnect could re-emit; we treat the first
          // as authoritative rather than orphaning the partial turn.
          if (state.turns.some((t) => t.turnId === e.turnId)) break;
          state = {
            ...state,
            turns: [
              ...state.turns,
              {
                turnId: e.turnId,
                startedAt: e.startedAt,
                endedAt: null,
                assistantText: "",
                toolCalls: [],
                status: "streaming",
              },
            ],
          };
          break;
        }
        case "message-delta": {
          const t = currentTurn();
          if (!t || t.turnId !== e.turnId) break;
          const updated: TurnRecord = {
            ...t,
            assistantText: t.assistantText + e.text,
          };
          state = {
            ...state,
            turns: [...state.turns.slice(0, -1), updated],
          };
          break;
        }
        case "tool-call": {
          const t = currentTurn();
          if (!t || t.turnId !== e.turnId) break;
          const updated: TurnRecord = {
            ...t,
            toolCalls: [
              ...t.toolCalls,
              {
                callId: e.callId,
                name: e.name,
                input: e.input,
                result: null,
              },
            ],
          };
          state = {
            ...state,
            turns: [...state.turns.slice(0, -1), updated],
          };
          break;
        }
        case "tool-result": {
          state = {
            ...state,
            turns: state.turns.map((t) => ({
              ...t,
              toolCalls: t.toolCalls.map((c) =>
                c.callId === e.callId
                  ? { ...c, result: { ok: e.ok, output: e.output } }
                  : c,
              ),
            })),
          };
          break;
        }
        case "permission-request": {
          state = {
            ...state,
            pendingPermission: {
              promptId: e.promptId,
              tool: e.tool,
              args: e.args,
              scope: e.scope,
            },
          };
          break;
        }
        case "permission-decided": {
          if (state.pendingPermission?.promptId === e.promptId) {
            state = { ...state, pendingPermission: null };
          }
          break;
        }
        case "error": {
          const t = currentTurn();
          // Error applies to the current turn IF the error is session-wide
          // (no turnId) OR explicitly targets the current turn. Errors that
          // target a past turn are silently ignored — by the time they
          // arrive, that turn has already been finalized.
          const matchesCurrent = !!t && (!e.turnId || t.turnId === e.turnId);
          if (matchesCurrent) {
            const updated: TurnRecord = {
              ...t,
              status: e.recoverable ? t.status : "errored",
              errorMessage: e.message,
            };
            state = {
              ...state,
              turns: [...state.turns.slice(0, -1), updated],
              sessionAlive: e.recoverable ? state.sessionAlive : false,
            };
          } else {
            // No current turn — record as a session-level error so the
            // UI can show it (otherwise the user sees nothing on early
            // crashes / spawn failures).
            state = {
              ...state,
              sessionError: e.message,
              sessionAlive: e.recoverable ? state.sessionAlive : false,
            };
          }
          break;
        }
        case "turn-end": {
          state = {
            ...state,
            turns: state.turns.map((t) =>
              t.turnId === e.turnId
                ? { ...t, endedAt: e.endedAt, status: "ended" }
                : t,
            ),
          };
          break;
        }
        case "message-end":
          // No state change — message-delta accumulation is authoritative.
          return;
      }
      notify();
    },
  };
};
