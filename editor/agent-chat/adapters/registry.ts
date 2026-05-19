import type { AgentAdapter, AgentId } from "./types";
import { codexAdapter } from "./codex";
import { geminiAdapter } from "./gemini";

const adapters: Partial<Record<AgentId, AgentAdapter>> = {
  codex: codexAdapter,
  gemini: geminiAdapter,
  // claude added in the next task
};

export const getAdapter = (id: AgentId): AgentAdapter | null =>
  adapters[id] ?? null;
