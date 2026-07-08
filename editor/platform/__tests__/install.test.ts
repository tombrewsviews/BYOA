import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Tauri runtime + invoke BEFORE importing install.
vi.mock("../../runtime", () => ({ isTauri: () => true }));
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
// Stub asset resolution: the real ?url fetch is a browser/Tauri concern, not
// what this test exercises. install.ts's job is to wire manifest+assets into
// the Tauri commands.
vi.mock("../install-assets", () => ({ installAssetsFor: async () => [] }));

import {
  getInstallState,
  startInstall,
  uninstall,
  refreshInstallStates,
  launchApp,
  __resetInstallCacheForTests,
} from "../install";

describe("install.ts backed by Tauri commands", () => {
  beforeEach(() => {
    invoke.mockReset();
    __resetInstallCacheForTests();
  });

  it("defaults to not-installed (no force-install for apps with Root)", () => {
    expect(getInstallState("kinetic").state).toBe("not-installed");
  });

  it("startInstall calls app_install with only ids (bundle copy, no assets)", async () => {
    invoke.mockResolvedValue(undefined);
    await startInstall("remit");
    expect(invoke).toHaveBeenCalledWith("app_install", expect.objectContaining({ appId: "remit" }));
    expect(getInstallState("remit").state).toBe("installed");
  });

  it("startInstall sends launchable flag (in-process app installs registry-only)", async () => {
    invoke.mockResolvedValue(undefined);
    await startInstall("kinetic"); // kinetic is in-process (not launchable)
    expect(invoke).toHaveBeenCalledWith("app_install", {
      appId: "kinetic",
      appName: "Kinetic Studio",
      launchable: false,
    });
    expect(getInstallState("kinetic").state).toBe("installed");
  });

  it("launchApp invokes app_launch with the app id", async () => {
    invoke.mockResolvedValue(undefined);
    await launchApp("remit");
    expect(invoke).toHaveBeenCalledWith("app_launch", { appId: "remit" });
  });

  it("uninstall calls app_uninstall and returns to not-installed", async () => {
    invoke.mockResolvedValue(undefined);
    await startInstall("remit");
    await uninstall("remit");
    expect(invoke).toHaveBeenCalledWith("app_uninstall", expect.objectContaining({ appId: "remit" }));
    expect(getInstallState("remit").state).toBe("not-installed");
  });

  it("refreshInstallStates seeds installed set from backend", async () => {
    invoke.mockResolvedValue(["remit"]);
    await refreshInstallStates();
    expect(getInstallState("remit").state).toBe("installed");
    expect(getInstallState("kinetic").state).toBe("not-installed");
  });
});
