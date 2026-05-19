import { describe, it, expect } from "vitest";
import { getAdapter } from "../adapters/registry";

describe("adapter registry", () => {
  it("returns null for unsupported agents in v1", () => {
    expect(getAdapter("codex")).not.toBeNull();
    expect(getAdapter("gemini")).not.toBeNull();
    // claude adapter lands in Task 4 — until then, registry returns
    // null for it too. This test will be updated when claude adapter
    // is added.
  });

  it("stub adapters declare no spawn args (chat disabled)", () => {
    const codex = getAdapter("codex");
    expect(codex).not.toBeNull();
    expect(
      codex!.spawnArgs({ cwd: "/tmp", skipPermissions: false }),
    ).toBeNull();
  });
});
