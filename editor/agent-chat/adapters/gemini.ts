import type { AgentAdapter } from "./types";

export const geminiAdapter: AgentAdapter = {
  id: "gemini",
  supportsChat: false,
  turnSpawnArgs: () => null,
  parseChunk: () => {
    throw new Error("gemini adapter not implemented in v1");
  },
};
