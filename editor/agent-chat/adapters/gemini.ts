import type { AgentAdapter } from "./types";

export const geminiAdapter: AgentAdapter = {
  id: "gemini",
  spawnArgs: () => null,
  parseChunk: () => {
    throw new Error("gemini adapter not implemented in v1");
  },
  encodeUserInput: () => {
    throw new Error("gemini adapter not implemented in v1");
  },
  encodePermissionDecision: () => null,
};
