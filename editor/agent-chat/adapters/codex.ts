import type { AgentAdapter } from "./types";

export const codexAdapter: AgentAdapter = {
  id: "codex",
  spawnArgs: () => null,
  parseChunk: () => {
    throw new Error("codex adapter not implemented in v1");
  },
  encodeUserInput: () => {
    throw new Error("codex adapter not implemented in v1");
  },
  encodePermissionDecision: () => null,
};
