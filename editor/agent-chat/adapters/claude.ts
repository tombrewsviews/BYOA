import type { ChatEvent } from "../events";
import type { AgentAdapter, SpawnArgs } from "./types";

/**
 * Single-session-only by design. `state` is module-scoped because each
 * renderer holds exactly one Chat surface, and the renderer lifetime
 * is the session lifetime. Tests must call
 * `__resetClaudeAdapterStateForTesting` between cases.
 *
 * Protocol assumptions (Claude `--output-format stream-json --verbose`):
 *   - Lines are LF-delimited (no CRLF handling).
 *   - For a given assistant message id, accumulated text grows
 *     monotonically; we emit only the suffix that hasn't been emitted
 *     yet. A shrinking re-send would be silently swallowed — that's
 *     not in the protocol today.
 *   - `turn-end` is terminal for the turn; we don't emit `message-end`
 *     separately. UIs that need a per-message finalizer should treat
 *     `turn-end` (or the next `tool-call`) as the boundary.
 *   - `cwd` is supplied to `spawnArgs` for future use (e.g. setting
 *     env hints) but Claude itself is spawned with the cwd by the
 *     Tauri backend; the adapter does not propagate it.
 */

interface ClaudeStreamLine {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    id: string;
    role: string;
    content?: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: unknown }
      | {
          type: "tool_result";
          tool_use_id: string;
          content: unknown;
          is_error?: boolean;
        }
    >;
  };
  is_error?: boolean;
}

interface AdapterState {
  buf: string;
  decoder: TextDecoder;
  turnId: string | null;
  emittedText: Map<string, string>;
}

const state: AdapterState = {
  buf: "",
  decoder: new TextDecoder(),
  turnId: null,
  emittedText: new Map(),
};

const startTurnIfNeeded = (emit: (e: ChatEvent) => void): string => {
  if (state.turnId) return state.turnId;
  const id = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  state.turnId = id;
  emit({ kind: "turn-start", turnId: id, startedAt: Date.now() });
  return id;
};

const handleLine = (line: string, emit: (e: ChatEvent) => void): void => {
  if (!line.trim()) return;
  let evt: ClaudeStreamLine;
  try {
    evt = JSON.parse(line);
  } catch {
    emit({
      kind: "error",
      message: `claude adapter: invalid JSON line (${line.slice(0, 80)})`,
      recoverable: true,
    });
    return;
  }

  if (evt.type === "system" && evt.subtype === "init") {
    return; // session start metadata — nothing to emit
  }

  if (evt.type === "assistant" && evt.message) {
    const turnId = startTurnIfNeeded(emit);
    const msgId = evt.message.id;
    for (const c of evt.message.content ?? []) {
      if (c.type === "text") {
        const fullText =
          evt.message.content
            ?.filter(
              (x): x is { type: "text"; text: string } => x.type === "text",
            )
            .map((x) => x.text)
            .join("") ?? "";
        const previous = state.emittedText.get(msgId) ?? "";
        if (fullText.length > previous.length) {
          const delta = fullText.slice(previous.length);
          state.emittedText.set(msgId, fullText);
          emit({ kind: "message-delta", turnId, text: delta });
        }
        break; // text already aggregated for the whole message
      }
      if (c.type === "tool_use") {
        emit({
          kind: "tool-call",
          turnId,
          callId: c.id,
          name: c.name,
          input: c.input,
        });
      }
    }
    return;
  }

  if (evt.type === "user" && evt.message) {
    for (const c of evt.message.content ?? []) {
      if (c.type === "tool_result") {
        emit({
          kind: "tool-result",
          callId: c.tool_use_id,
          ok: !c.is_error,
          output: c.content,
        });
      }
    }
    return;
  }

  if (evt.type === "result") {
    const turnId = state.turnId ?? startTurnIfNeeded(emit);
    if (evt.is_error) {
      emit({
        kind: "error",
        turnId,
        message: "claude reported error result",
        recoverable: false,
      });
    }
    emit({ kind: "turn-end", turnId, endedAt: Date.now() });
    state.turnId = null;
    state.emittedText.clear();
    return;
  }
};

const parseChunk = (
  chunk: Uint8Array,
  emit: (e: ChatEvent) => void,
): void => {
  state.buf += state.decoder.decode(chunk, { stream: true });
  let nl: number;
  while ((nl = state.buf.indexOf("\n")) >= 0) {
    const line = state.buf.slice(0, nl);
    state.buf = state.buf.slice(nl + 1);
    handleLine(line, emit);
  }
};

const spawnArgs = (opts: {
  cwd: string;
  skipPermissions: boolean;
}): SpawnArgs => {
  const args = ["--output-format", "stream-json", "--verbose"];
  if (opts.skipPermissions) args.push("--dangerously-skip-permissions");
  return { cmd: "claude", args, env: {} };
};

const encodeUserInput = (text: string, attachments: string[]): Uint8Array => {
  const refs = attachments.map((p) => `@${p}`).join(" ");
  const composed = refs ? `${refs}\n\n${text}` : text;
  return new TextEncoder().encode(composed + "\n");
};

const encodePermissionDecision = (
  _promptId: string,
  decision: "allow" | "allow-always" | "deny",
): Uint8Array =>
  new TextEncoder().encode(
    decision === "deny" ? "n\n" : decision === "allow-always" ? "a\n" : "y\n",
  );

export const claudeAdapter: AgentAdapter = {
  id: "claude",
  spawnArgs,
  parseChunk,
  encodeUserInput,
  encodePermissionDecision,
};

/**
 * Reset adapter state for tests. NOT for production use — production
 * has exactly one Chat session per renderer, so state lifetime equals
 * the page lifetime. Tests that drive the adapter sequentially need
 * this hook to avoid cross-test pollution.
 */
export const __resetClaudeAdapterStateForTesting = (): void => {
  state.buf = "";
  state.turnId = null;
  state.emittedText.clear();
};
