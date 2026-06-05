import { describe, it, expect, afterEach } from "vitest";
import { applyTokens, resetTokens, toPatch } from "../apply";
import { SnapshotStore } from "../snapshots";
import { resolve, BASE_TOKENS } from "../fanout";
import { emptyState } from "../dials";

afterEach(() => document.documentElement.removeAttribute("style"));

describe("apply", () => {
  it("applyTokens writes every token onto :root", () => {
    applyTokens(resolve({ ...emptyState(), softness: 3 }));
    expect(document.documentElement.style.getPropertyValue("--radius")).not.toBe("");
    expect(document.documentElement.style.getPropertyValue("--spacing")).not.toBe("");
  });
  it("resetTokens clears all overrides", () => {
    applyTokens(resolve({ ...emptyState(), softness: 3 }));
    resetTokens();
    expect(document.documentElement.style.getPropertyValue("--radius")).toBe("");
  });
  it("toPatch emits cssVars for changed tokens and maps to theme.ts paths", () => {
    const map = resolve({ ...emptyState(), softness: 3, temperature: 2 });
    const patch = toPatch(map);
    expect(patch.cssVars["--radius"]).toBe(map["--radius"]);
    expect(patch.themeTs["bg.surface"]).toBe(map["--card"]);
  });
  it("toPatch reports unreachable theme.ts keys, never invents them", () => {
    const patch = toPatch(resolve(emptyState()));
    expect(patch.notReached).toContain("text.secondary");
    expect(Object.keys(patch.themeTs)).not.toContain("text.secondary");
  });
});

describe("SnapshotStore", () => {
  it("saves and recalls dial states by name", () => {
    const s = new SnapshotStore();
    s.save("editorial-v2", { ...emptyState(), density: 2 });
    expect(s.get("editorial-v2")!.density).toBe(2);
    expect(s.names()).toEqual(["editorial-v2"]);
  });
});
