import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../runtime", () => ({ isTauri: () => true }));

// Mock the Tauri invoke so we can drive `app_install_states` from the tests.
// Default: nothing installed. Individual tests override the resolved value.
const invokeMock = vi.fn().mockResolvedValue([]);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import { canOpen, refreshInstallStates, __resetInstallCacheForTests } from "../platform/install";
import { loadCurrentApp } from "../App";

const CURRENT_APP_KEY = "platform.currentApp";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]);
  localStorage.clear();
  // Clear the install-cache singleton so these tests don't depend on run order
  // (the "flips canOpen" test below leaves "kinetic" installed otherwise).
  __resetInstallCacheForTests();
});

describe("open gating", () => {
  it("an app cannot be opened unless installed", () => {
    expect(canOpen("kinetic")).toBe(false); // not installed by default
  });

  it("loadCurrentApp does NOT gate on install cache (boot race)", () => {
    // Persisted selection points at a real, available app with a Root.
    // The install cache is EMPTY on cold boot (refreshInstallStates hasn't
    // resolved yet), so canOpen() is false — but loadCurrentApp must still
    // return the persisted id, otherwise the boot effect wipes localStorage.
    localStorage.setItem(CURRENT_APP_KEY, "kinetic");
    expect(canOpen("kinetic")).toBe(false); // cache empty → not installed yet
    expect(loadCurrentApp()).toBe("kinetic"); // but the id survives init
  });

  it("loadCurrentApp returns null for an unknown/unavailable id", () => {
    localStorage.setItem(CURRENT_APP_KEY, "not-a-real-app");
    expect(loadCurrentApp()).toBe(null);
  });

  it("refreshInstallStates resolving flips canOpen for an installed id", async () => {
    invokeMock.mockResolvedValue(["kinetic"]); // backend reports it installed
    expect(canOpen("kinetic")).toBe(false); // before refresh
    await refreshInstallStates();
    expect(canOpen("kinetic")).toBe(true); // after refresh
  });
});
