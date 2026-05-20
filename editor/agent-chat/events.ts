/**
 * Normalized event model for the agent-chat UI layer.
 *
 * Each per-agent adapter parses its agent's structured output stream
 * into these events. The UI is a pure consumer — no agent-specific
 * conditionals live above this boundary.
 *
 * `input` and `output` are `unknown` deliberately. The UI inspects
 * them for known shapes (e.g. file paths in Edit calls) but treats
 * unknown shapes as opaque JSON to render.
 *
 * Design notes:
 *   - `tool-result` carries only `callId`, not `turnId`. The UI resolves
 *     the parent turn through the matching tool-call's callId, keeping
 *     result routing trivial and adapter-agnostic.
 *   - `error.turnId` is optional: session-level errors (e.g. spawn failure
 *     before any turn begins) have no turn to attach to.
 */
/** One option in an agent-asked question. */
export interface QuestionOption {
  label: string;
  description?: string;
}

/** One question the agent asked via its AskUserQuestion tool. */
export interface AgentQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: QuestionOption[];
}

export type ChatEvent =
  | { kind: "turn-start"; turnId: string; startedAt: number }
  | { kind: "message-delta"; turnId: string; msgId: string; text: string }
  | { kind: "message-end"; turnId: string }
  | {
      kind: "tool-call";
      turnId: string;
      callId: string;
      name: string;
      input: unknown;
    }
  | {
      // The agent invoked AskUserQuestion. In the per-turn model the agent
      // process has already exited, so answering means sending the chosen
      // label(s) as the next turn (which --resumes the conversation).
      kind: "question";
      turnId: string;
      callId: string;
      questions: AgentQuestion[];
    }
  | {
      kind: "tool-result";
      callId: string;
      ok: boolean;
      output: unknown;
    }
  | {
      kind: "permission-request";
      promptId: string;
      tool: string;
      args: unknown;
      scope: string;
    }
  | {
      kind: "permission-decided";
      promptId: string;
      decision: "allow" | "allow-always" | "deny";
    }
  | {
      kind: "error";
      turnId?: string;
      message: string;
      recoverable: boolean;
    }
  | { kind: "turn-end"; turnId: string; endedAt: number };

export type ChatEventKind = ChatEvent["kind"];

export const isTurnStart = (
  e: ChatEvent,
): e is Extract<ChatEvent, { kind: "turn-start" }> => e.kind === "turn-start";

export const isError = (
  e: ChatEvent,
): e is Extract<ChatEvent, { kind: "error" }> => e.kind === "error";

export const isMessageDelta = (
  e: ChatEvent,
): e is Extract<ChatEvent, { kind: "message-delta" }> =>
  e.kind === "message-delta";

export const isToolCall = (
  e: ChatEvent,
): e is Extract<ChatEvent, { kind: "tool-call" }> => e.kind === "tool-call";

export const isToolResult = (
  e: ChatEvent,
): e is Extract<ChatEvent, { kind: "tool-result" }> => e.kind === "tool-result";

export const isPermissionRequest = (
  e: ChatEvent,
): e is Extract<ChatEvent, { kind: "permission-request" }> =>
  e.kind === "permission-request";

export const isPermissionDecided = (
  e: ChatEvent,
): e is Extract<ChatEvent, { kind: "permission-decided" }> =>
  e.kind === "permission-decided";

export const isTurnEnd = (
  e: ChatEvent,
): e is Extract<ChatEvent, { kind: "turn-end" }> => e.kind === "turn-end";

export const isQuestion = (
  e: ChatEvent,
): e is Extract<ChatEvent, { kind: "question" }> => e.kind === "question";
