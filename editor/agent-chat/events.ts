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
export type ChatEvent =
  | { kind: "turn-start"; turnId: string; startedAt: number }
  | { kind: "message-delta"; turnId: string; text: string }
  | { kind: "message-end"; turnId: string }
  | {
      kind: "tool-call";
      turnId: string;
      callId: string;
      name: string;
      input: unknown;
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

export const isTurnEnd = (
  e: ChatEvent,
): e is Extract<ChatEvent, { kind: "turn-end" }> => e.kind === "turn-end";
