import type { AgentAdapter, AgentId } from "./types";
import { claudeAdapter } from "./claude";
import { codexAdapter } from "./codex";
import { geminiAdapter } from "./gemini";

const adapters: Partial<Record<AgentId, AgentAdapter>> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
};

export const getAdapter = (id: AgentId): AgentAdapter | null =>
  adapters[id] ?? null;
