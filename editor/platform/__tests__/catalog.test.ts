import { describe, it, expect } from "vitest";
import { PUBLIC_APPS } from "../catalog";

describe("store catalog loader", () => {
  it("loads all public apps from store-catalog/ with data + Root", () => {
    const ids = PUBLIC_APPS.map((a) => a.id).sort();
    expect(ids).toEqual(["brainstorm", "data", "kinetic", "pulse", "voxel"]);
    const kinetic = PUBLIC_APPS.find((a) => a.id === "kinetic")!;
    expect(kinetic.name).toBe("Kinetic Studio");
    expect(kinetic.Root).toBeTruthy();            // Root re-attached from code map
    const voxel = PUBLIC_APPS.find((a) => a.id === "voxel")!;
    expect(voxel.status).toBe("coming-soon");
    expect(voxel.Root).toBeFalsy();               // coming-soon has no Root
  });
});
