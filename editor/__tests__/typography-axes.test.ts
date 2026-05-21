import { describe, it, expect } from "vitest";
import {
  clampAxis,
  axisSupported,
  setAxisStatic,
  setAxisRange,
  isAxisAnimated,
  staticWeightOptions,
} from "../typography-axes";
import type { AxisRanges } from "../../src/kinetic/schema";

describe("clampAxis", () => {
  it("clamps a value into the font's bounds", () => {
    expect(clampAxis(2000, "wght", "RobotoFlex")).toBe(1000);
    expect(clampAxis(50, "wght", "RobotoFlex")).toBe(100);
    expect(clampAxis(400, "wght", "RobotoFlex")).toBe(400);
  });
  it("pins to the single supported value for static axes", () => {
    expect(clampAxis(700, "wdth", "InterVF")).toBe(100);
    expect(clampAxis(0, "wght", "SpaceGrotesk")).toBe(700);
  });
  it("falls back to the min when given NaN", () => {
    expect(clampAxis(Number.NaN, "wght", "RobotoFlex")).toBe(100);
  });
});

describe("axisSupported", () => {
  it("is false when min===max for that axis", () => {
    expect(axisSupported("wdth", "InterVF")).toBe(false);
    expect(axisSupported("wght", "RobotoFlex")).toBe(true);
    expect(axisSupported("slnt", "Recursive")).toBe(true);
  });
});

describe("setAxisStatic / setAxisRange", () => {
  const base: AxisRanges = {
    wght: [700, 700],
    wdth: [100, 100],
    slnt: [0, 0],
  };
  it("setAxisStatic writes [v,v] clamped", () => {
    expect(setAxisStatic(base, "wght", 5000, "RobotoFlex").wght).toEqual([
      1000, 1000,
    ]);
  });
  it("setAxisRange writes [start,end] clamped", () => {
    expect(setAxisRange(base, "wght", 100, 900, "RobotoFlex").wght).toEqual([
      100, 900,
    ]);
  });
  it("does not mutate the input axes", () => {
    const copy: AxisRanges = { wght: [700, 700], wdth: [100, 100], slnt: [0, 0] };
    setAxisStatic(copy, "wght", 400, "RobotoFlex");
    expect(copy.wght).toEqual([700, 700]);
  });
});

describe("isAxisAnimated", () => {
  it("is true only when start and end differ", () => {
    expect(isAxisAnimated({ wght: [400, 400], wdth: [100, 100], slnt: [0, 0] }, "wght")).toBe(false);
    expect(isAxisAnimated({ wght: [100, 900], wdth: [100, 100], slnt: [0, 0] }, "wght")).toBe(true);
  });
});

describe("staticWeightOptions", () => {
  it("returns null for fonts that vary the weight axis", () => {
    expect(staticWeightOptions("RobotoFlex")).toBeNull();
    expect(staticWeightOptions("BricolageGrotesque")).toBeNull();
  });
  it("returns discrete weights for a non-variable font", () => {
    const opts = staticWeightOptions("SpaceGrotesk");
    expect(opts).not.toBeNull();
    expect(opts!.length).toBeGreaterThanOrEqual(1);
    expect(opts!.some((o) => o.value === 700)).toBe(true);
  });
});
