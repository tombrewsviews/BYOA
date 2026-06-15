// src/pulse/__tests__/classify.test.ts
import { describe, it, expect } from "vitest";
import { classifyStem } from "../classify";

describe("classifyStem", () => {
  it("classifies low-energy, sparse-onset content as bass/kick", () => {
    const agg = { bandLowFrac: 0.8, bandMidFrac: 0.15, bandHighFrac: 0.05, brightnessMean: 0.05, onsetDensity: 0.4, fluxMean: 0.2 };
    const r = classifyStem(agg);
    expect(["bass", "kick"]).toContain(r.role);
    expect(r.confidence).toBeGreaterThan(0);
  });

  it("classifies bright, high-flux content as lead/fx, not bass", () => {
    const agg = { bandLowFrac: 0.1, bandMidFrac: 0.3, bandHighFrac: 0.6, brightnessMean: 0.7, onsetDensity: 0.5, fluxMean: 0.6 };
    const r = classifyStem(agg);
    expect(r.role).not.toBe("bass");
  });

  it("never throws and always returns a known role", () => {
    const r = classifyStem({ bandLowFrac: 0.33, bandMidFrac: 0.33, bandHighFrac: 0.34, brightnessMean: 0.4, onsetDensity: 0.1, fluxMean: 0.1 });
    expect(["kick","bass","drums","harmony","lead","vocal","fx","unknown"]).toContain(r.role);
  });
});
