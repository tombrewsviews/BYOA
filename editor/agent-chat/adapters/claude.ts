import type { ChatEvent } from "../events";
import type { AgentAdapter, SpawnArgs } from "./types";

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
    const fullText =
      evt.message.content
        ?.filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("") ?? "";
    const previous = state.emittedText.get(msgId) ?? "";
    if (fullText.length > previous.length) {
      const delta = fullText.slice(previous.length);
      state.emittedText.set(msgId, fullText);
      emit({ kind: "message-delta", turnId, text: delta });
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
