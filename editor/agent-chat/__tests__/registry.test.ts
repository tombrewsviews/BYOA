import { describe, it, expect } from "vitest";
import { getAdapter } from "../adapters/registry";

describe("adapter registry", () => {
  it("returns non-null adapters for registered agents", () => {
    expect(getAdapter("claude")).not.toBeNull();
    expect(getAdapter("codex")).not.toBeNull();
    expect(getAdapter("gemini")).not.toBeNull();
  });

  it("claude supports chat; codex/gemini are stubbed off in v1", () => {
    expect(getAdapter("claude")!.supportsChat).toBe(true);
    expect(getAdapter("codex")!.supportsChat).toBe(false);
    expect(getAdapter("gemini")!.supportsChat).toBe(false);
  });

  it("stub adapters return null turnSpawnArgs (chat disabled)", () => {
    const codex = getAdapter("codex");
    expect(codex).not.toBeNull();
    expect(
      codex!.turnSpawnArgs({
        cwd: "/tmp",
        skipPermissions: false,
        prompt: "hi",
        sessionId: "x",
        isFirstTurn: true,
      }),
    ).toBeNull();
  });
});
