import { describe, it, expect } from "vitest";
import { DIAL_AXES, PRESETS, emptyState, clampState, mergeDeltas } from "../dials";

describe("dials", () => {
  it("defines exactly the 6 spec axes", () => {
    expect(DIAL_AXES.map((a) => a.key).sort()).toEqual(
      ["character", "contrast", "density", "softness", "temperature", "weight"],
    );
  });
  it("emptyState is all-zero for every axis", () => {
    const s = emptyState();
    expect(Object.values(s).every((v) => v === 0)).toBe(true);
    expect(Object.keys(s).length).toBe(6);
  });
  it("clampState bounds each axis to -3..+3", () => {
    expect(clampState({ ...emptyState(), temperature: 9 }).temperature).toBe(3);
    expect(clampState({ ...emptyState(), density: -9 }).density).toBe(-3);
  });
  it("mergeDeltas sums then clamps", () => {
    const s = mergeDeltas(emptyState(), [{ temperature: 2 }, { temperature: 2, density: 1 }]);
    expect(s.temperature).toBe(3); // 2+2 clamped
    expect(s.density).toBe(1);
  });
  it("every preset is a valid dial state", () => {
    for (const name of Object.keys(PRESETS)) {
      const s = PRESETS[name];
      expect(Object.keys(s).length).toBe(6);
      expect(Object.values(s).every((v) => v >= -3 && v <= 3)).toBe(true);
    }
    expect(PRESETS.default).toEqual(emptyState());
  });
});
