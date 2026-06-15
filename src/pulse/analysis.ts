// src/pulse/analysis.ts
import { extractFrame } from "./features";
import { classifyStem, type Aggregate } from "./classify";
import type { StemRole } from "./schema";

export type AnalyzedStem = {
  id: string; file: string; role: StemRole; roleConfidence: number;
  level: number[]; bandLow: number[]; bandMid: number[]; bandHigh: number[];
  brightness: number[]; flux: number[]; onsets: number[];
};

export type Analysis = {
  version: 1; sampleRate: number; hopSec: number; durationSec: number;
  tempoBpm: number; beatTimesSec: number[]; stems: AnalyzedStem[];
};

const WIN = 2048;

// Analyze one mono channel into per-frame feature arrays + classification.
export function analyzeChannel(samples: Float32Array, sampleRate: number, hopSec: number) {
  const hop = Math.max(1, Math.round(hopSec * sampleRate));
  const level: number[] = [], bandLow: number[] = [], bandMid: number[] = [],
        bandHigh: number[] = [], brightness: number[] = [], flux: number[] = [];
  const onsets: number[] = [];
  let prevHigh = 0;
  for (let start = 0; start + WIN <= samples.length; start += hop) {
    const f = extractFrame(samples.subarray(start, start + WIN), sampleRate);
    level.push(f.level); bandLow.push(f.bandLow); bandMid.push(f.bandMid);
    bandHigh.push(f.bandHigh); brightness.push(f.brightness);
    const total = f.bandLow + f.bandMid + f.bandHigh + 1e-9;
    const fx = Math.max(0, total - prevHigh); flux.push(fx); prevHigh = total;
  }
  // Onset peaks: local maxima of flux above mean.
  const mean = flux.reduce((a, b) => a + b, 0) / Math.max(1, flux.length);
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] > mean * 1.5 && flux[i] > flux[i - 1] && flux[i] >= flux[i + 1]) {
      onsets.push((i * hop) / sampleRate);
    }
  }
  // Normalize level + flux + brightness to 0..1 by max.
  const norm = (arr: number[]) => { const m = Math.max(1e-9, ...arr); return arr.map((v) => v / m); };
  const nLevel = norm(level), nLow = norm(bandLow), nMid = norm(bandMid), nHigh = norm(bandHigh), nFlux = norm(flux);
  const sum = bandLow.reduce((a, b) => a + b, 0) + bandMid.reduce((a, b) => a + b, 0) + bandHigh.reduce((a, b) => a + b, 0) + 1e-9;
  const agg: Aggregate = {
    bandLowFrac: bandLow.reduce((a, b) => a + b, 0) / sum,
    bandMidFrac: bandMid.reduce((a, b) => a + b, 0) / sum,
    bandHighFrac: bandHigh.reduce((a, b) => a + b, 0) / sum,
    brightnessMean: brightness.reduce((a, b) => a + b, 0) / Math.max(1, brightness.length),
    onsetDensity: Math.min(1, onsets.length / Math.max(1, samples.length / sampleRate) / 8),
    fluxMean: nFlux.reduce((a, b) => a + b, 0) / Math.max(1, nFlux.length),
  };
  const cls = classifyStem(agg);
  return {
    role: cls.role, roleConfidence: cls.confidence,
    level: nLevel, bandLow: nLow, bandMid: nMid, bandHigh: nHigh,
    brightness, flux: nFlux, onsets,
  };
}
