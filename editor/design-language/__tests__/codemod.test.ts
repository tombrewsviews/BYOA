import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("type codemod completeness", () => {
  it("no editor/**/*.tsx still uses an arbitrary text-[Npx] utility", () => {
    let out = "";
    try {
      out = execSync(
        `grep -rEn 'text-\\[[0-9]+px\\]' editor --include='*.tsx' || true`,
        { encoding: "utf8" },
      ).trim();
    } catch { /* grep non-zero handled by || true */ }
    expect(out).toBe("");
  });
});
