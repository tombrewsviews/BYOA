// src/pulse/__tests__/bindings.test.ts
import { describe, it, expect } from "vitest";
import { resolveParam } from "../bindings";
import type { FeatureFrame } from "../featureBus";

const frame: FeatureFrame = {
  timeSec: 0, tempoPhase: 0.5,
  master: { level: 0.5, bandLow: 0.2, bandMid: 0, bandHigh: 0, brightness: 0.3, flux: 0 },
  stems: { s0: { level: 1, bandLow: 1, bandMid: 0, bandHigh: 0, brightness: 0, flux: 0 } },
};

describe("resolveParam", () => {
  it("returns base param when there is no binding", () => {
    expect(resolveParam(10, [], "size", frame, 1)).toBe(10);
  });
  it("adds a stem-bound feature scaled by amount and stem volume", () => {
    const bindings = [{ param: "size", source: { stem: "s0", feature: "level" as const }, amount: 4, curve: "linear" as const, offset: 0 }];
    // base 10 + level(1) * amount(4) * volume(0.5) = 12
    expect(resolveParam(10, bindings, "size", frame, 0.5)).toBe(12);
  });
  it("uses master features when stem is 'master'", () => {
    const bindings = [{ param: "size", source: { stem: "master", feature: "level" as const }, amount: 2, curve: "linear" as const, offset: 1 }];
    // base 0 + (level 0.5 * 2 + offset 1) * vol 1 = 2
    expect(resolveParam(0, bindings, "size", frame, 1)).toBeCloseTo(2);
  });
});
