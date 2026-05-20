import type { AgentAdapter } from "./types";

export const codexAdapter: AgentAdapter = {
  id: "codex",
  supportsChat: false,
  turnSpawnArgs: () => null,
  parseChunk: () => {
    throw new Error("codex adapter not implemented in v1");
  },
};
