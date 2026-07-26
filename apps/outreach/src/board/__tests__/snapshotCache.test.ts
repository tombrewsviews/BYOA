import { describe, it, expect, beforeEach } from "vitest";
import { loadSnapshot, saveSnapshot } from "../snapshotCache";
import type { Snapshot } from "../api";

const snap: Snapshot = {
  stages: [{ id: "researching", label: "Researching", position: 0, color: null, retiredAt: null, version: 1 }],
  leads: [{ id: "l1", stage: "researching", name: "Ada", org: null, archivedAt: null, version: 1 }],
  config: { name: "Board", createdBy: "local", version: 1 },
  notifications: { items: [], unread: 0 },
  mode: "shared",
};

describe("snapshotCache", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a snapshot per project path", () => {
    saveSnapshot("/p/a", snap);
    const back = loadSnapshot("/p/a");
    expect(back?.leads[0].name).toBe("Ada");
    expect(back?.mode).toBe("shared");
  });

  it("keys by project path (no cross-board bleed)", () => {
    saveSnapshot("/p/a", snap);
    expect(loadSnapshot("/p/b")).toBeNull();
  });

  it("returns null for a missing entry", () => {
    expect(loadSnapshot("/never/saved")).toBeNull();
  });

  it("returns null (not a throw) on a corrupt entry", () => {
    localStorage.setItem("outreach.snapshot.v1./p/c", "{not json");
    expect(loadSnapshot("/p/c")).toBeNull();
  });
});
