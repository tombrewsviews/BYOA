import type { ChatEvent } from "../events";

export type AgentId = "claude" | "codex" | "gemini";

export interface SpawnArgs {
  cmd: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

export interface AgentAdapter {
  /** Stable id matching src-tauri/src/agents.rs AgentKind::id(). */
  readonly id: AgentId;

  /**
   * Command + args to launch the agent in structured-output mode.
   * Returning null means "this agent cannot run in structured mode" —
   * the chat-view toggle will be disabled for it.
   */
  spawnArgs(opts: { cwd: string; skipPermissions: boolean }): SpawnArgs | null;

  /**
   * Parse a chunk of raw bytes from the agent's stdout into zero or
   * more normalized events. Adapter is stateful (line buffering, etc.).
   */
  parseChunk(chunk: Uint8Array, emit: (e: ChatEvent) => void): void;

  /** Encode a user prose message for the agent's stdin. */
  encodeUserInput(text: string, attachments: string[]): Uint8Array;

  /**
   * Encode a permission decision for the agent's stdin. Returns null
   * if this agent's permission flow uses an out-of-band channel.
   */
  encodePermissionDecision(
    promptId: string,
    decision: "allow" | "allow-always" | "deny",
  ): Uint8Array | null;
}
