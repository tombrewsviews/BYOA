// src/pulse/__tests__/featureBus.test.ts
import { describe, it, expect } from "vitest";
import { sampleFeatures } from "../featureBus";
import type { Analysis } from "../analysis";

const mk = (): Analysis => ({
  version: 1, sampleRate: 48000, hopSec: 0.1, durationSec: 0.3, tempoBpm: 120, beatTimesSec: [0, 0.5],
  stems: [{
    id: "s0", file: "stem-00.wav", role: "bass", roleConfidence: 0.5,
    level: [0, 0.5, 1], bandLow: [0,0,0], bandMid: [0,0,0], bandHigh: [0,0,0],
    brightness: [0,0,0], flux: [0,0,0], onsets: [],
  }],
});

describe("sampleFeatures", () => {
  it("indexes the correct frame for a given time", () => {
    const a = mk();
    expect(sampleFeatures(a, 0.0).stems.s0.level).toBeCloseTo(0);
    expect(sampleFeatures(a, 0.1).stems.s0.level).toBeCloseTo(0.5);
    expect(sampleFeatures(a, 0.25).stems.s0.level).toBeCloseTo(1);
  });
  it("clamps past the end", () => {
    expect(sampleFeatures(mk(), 99).stems.s0.level).toBeCloseTo(1);
  });
});
