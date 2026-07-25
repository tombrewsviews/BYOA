import type { AgentQuestion, ChatEvent } from "./events";

export interface ToolCallRecord {
  callId: string;
  name: string;
  input: unknown;
  result: { ok: boolean; output: unknown } | null;
}

/**
 * One item in a turn's ordered transcript. Text and tool calls are stored
 * in a single sequence so the UI renders them interleaved in execution
 * order (text → tool → text …) rather than bucketing all tools above all
 * text. A `text` item groups consecutive deltas of the same `msgId`; a new
 * msgId after a tool call starts a fresh text item below that tool.
 */
export type TurnItem =
  | { type: "text"; msgId: string; text: string }
  | { type: "tool"; call: ToolCallRecord };

export interface TurnRecord {
  turnId: string;
  startedAt: number;
  endedAt: number | null;
  items: TurnItem[];
  status: "streaming" | "ended" | "errored";
  errorMessage?: string;
}

export interface PendingPermission {
  promptId: string;
  tool: string;
  args: unknown;
  scope: string;
}

/** An unanswered question the agent asked via AskUserQuestion. */
export interface PendingQuestion {
  callId: string;
  questions: AgentQuestion[];
}

export interface ChatState {
  turns: TurnRecord[];
  pendingPermission: PendingPermission | null;
  sessionAlive: boolean;
  /** Session-level error not associated with any turn (e.g. spawn failure
   *  before any turn started, agent process killed at startup). */
  sessionError: string | null;
  /** The agent's most recent unanswered question, or null. Cleared when
   *  the user answers (which sends the next turn) or a new turn starts. */
  pendingQuestion: PendingQuestion | null;
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
  pendingQuestion: null,
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
            // A new turn supersedes any unanswered question.
            pendingQuestion: null,
            turns: [
              ...state.turns,
              {
                turnId: e.turnId,
                startedAt: e.startedAt,
                endedAt: null,
                items: [],
                status: "streaming",
              },
            ],
          };
          break;
        }
        case "question": {
          state = {
            ...state,
            pendingQuestion: { callId: e.callId, questions: e.questions },
          };
          break;
        }
        case "message-delta": {
          const t = currentTurn();
          if (!t || t.turnId !== e.turnId) break;
          // Extend the last item if it's a text block for the same msgId;
          // otherwise start a new text item (e.g. text resuming after a
          // tool call, which arrives under a new message id).
          const last = t.items[t.items.length - 1];
          let items: TurnItem[];
          if (last && last.type === "text" && last.msgId === e.msgId) {
            items = [
              ...t.items.slice(0, -1),
              { ...last, text: last.text + e.text },
            ];
          } else {
            items = [...t.items, { type: "text", msgId: e.msgId, text: e.text }];
          }
          const updated: TurnRecord = { ...t, items };
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
            items: [
              ...t.items,
              {
                type: "tool",
                call: {
                  callId: e.callId,
                  name: e.name,
                  input: e.input,
                  result: null,
                },
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
          // Patch the matching tool item by callId, wherever it sits in any
          // turn's ordered items. Results carry only callId (not turnId), so
          // we scan all turns — cheap given transcript sizes.
          state = {
            ...state,
            turns: state.turns.map((t) => ({
              ...t,
              items: t.items.map((it) =>
                it.type === "tool" && it.call.callId === e.callId
                  ? {
                      ...it,
                      call: { ...it.call, result: { ok: e.ok, output: e.output } },
                    }
                  : it,
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
