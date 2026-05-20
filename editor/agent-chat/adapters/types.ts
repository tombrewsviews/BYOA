import type { ChatEvent } from "../events";

export type AgentId = "claude" | "codex" | "gemini";

/**
 * Permission posture for a chat turn. Only modes that never need an
 * interactive prompt are offered — non-interactive `-p` mode cannot
 * surface a y/n dialog, so a prompting mode would silently block.
 *   - "full"  → bypassPermissions: read, edit, run anything.
 *   - "edits" → acceptEdits: auto-approve edits; reads/bash still blocked.
 *   - "plan"  → plan: read-only, no writes (planning/analysis).
 */
export type PermissionMode = "full" | "edits" | "plan";

export const PERMISSION_MODES: ReadonlyArray<{
  value: PermissionMode;
  label: string;
  hint: string;
}> = [
  { value: "full", label: "Full access", hint: "read, edit, run anything" },
  { value: "edits", label: "Edits only", hint: "auto-approve edits" },
  { value: "plan", label: "Plan (read-only)", hint: "no writes" },
];

export interface SpawnArgs {
  cmd: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

/** Options for building a per-turn spawn command. */
export interface TurnSpawnOpts {
  cwd: string;
  permissionMode: PermissionMode;
  /** The user's prompt for this turn (with @path refs already inlined). */
  prompt: string;
  /**
   * Stable conversation id. Turn 1 passes a fresh UUID via --session-id
   * to establish the session; turn 2+ passes the same id via --resume so
   * conversation history carries over. The caller owns the UUID.
   */
  sessionId: string;
  /** True for turn 1 (--session-id), false for subsequent turns (--resume). */
  isFirstTurn: boolean;
}

export interface AgentAdapter {
  /** Stable id matching src-tauri/src/agents.rs AgentKind::id(). */
  readonly id: AgentId;

  /**
   * True if this agent supports chat-view in v1. When false, the
   * chat-view surface shows an "unsupported" state. (Codex/Gemini are
   * stubbed in v1.)
   */
  readonly supportsChat: boolean;

  /**
   * Build the command to run ONE turn to completion. Claude's
   * structured-output mode is non-interactive: each turn spawns a fresh
   * `claude -p ... "<prompt>"` that emits its event stream and exits.
   * Conversation continuity is via --session-id / --resume, not a
   * persistent process. Returns null if the agent can't run this way.
   */
  turnSpawnArgs(opts: TurnSpawnOpts): SpawnArgs | null;

  /**
   * Parse a chunk of raw bytes from the agent's stdout into zero or
   * more normalized events. Adapter is stateful (line buffering, etc.).
   */
  parseChunk(chunk: Uint8Array, emit: (e: ChatEvent) => void): void;
}
