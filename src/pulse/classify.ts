// src/pulse/classify.ts
import type { StemRole } from "./schema";

export type Aggregate = {
  bandLowFrac: number;   // fraction of total band energy in low
  bandMidFrac: number;
  bandHighFrac: number;
  brightnessMean: number; // 0..1
  onsetDensity: number;   // onsets per second, normalized 0..1 (1 ≈ very busy)
  fluxMean: number;       // 0..1
};

export type Classification = { role: StemRole; confidence: number };

// Heuristic, filename-independent. Returns the best role + a rough
// confidence (margin between top and runner-up score).
export function classifyStem(a: Aggregate): Classification {
  const scores: Record<StemRole, number> = {
    kick:    a.bandLowFrac * 1.2 + a.onsetDensity * 0.3 - a.brightnessMean,
    bass:    a.bandLowFrac * 1.3 + (1 - a.fluxMean) * 0.3 - a.brightnessMean,
    drums:   a.onsetDensity * 1.2 + a.fluxMean * 0.6 + a.bandHighFrac * 0.4,
    harmony: a.bandMidFrac * 1.1 + (1 - a.fluxMean) * 0.5 - a.onsetDensity * 0.3,
    lead:    a.bandMidFrac * 0.6 + a.brightnessMean * 0.8 - a.onsetDensity * 0.2,
    vocal:   a.bandMidFrac * 0.9 + a.brightnessMean * 0.4 + a.fluxMean * 0.2,
    fx:      a.bandHighFrac * 0.8 + a.brightnessMean * 0.6,
    unknown: 0.25,
  };
  const ranked = (Object.entries(scores) as [StemRole, number][]).sort((x, y) => y[1] - x[1]);
  const [role, top] = ranked[0];
  const second = ranked[1][1];
  const confidence = Math.max(0, Math.min(1, top - second));
  return { role, confidence };
}
