import { describe, it, expect, vi } from "vitest";
vi.mock("../runtime", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
import { canOpen } from "../platform/install";

describe("open gating", () => {
  it("an app cannot be opened unless installed", () => {
    expect(canOpen("kinetic")).toBe(false); // not installed by default
  });
});
