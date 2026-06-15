// src/pulse/featureBus.ts
import type { Analysis } from "./analysis";

export type StemFeatures = {
  level: number; bandLow: number; bandMid: number; bandHigh: number; brightness: number; flux: number;
};
export type FeatureFrame = {
  timeSec: number;
  tempoPhase: number;                 // 0..1 within the current beat
  master: StemFeatures;
  stems: Record<string, StemFeatures>;
};

const at = (arr: number[], i: number) => arr[Math.max(0, Math.min(arr.length - 1, i))] ?? 0;

export function sampleFeatures(a: Analysis, timeSec: number): FeatureFrame {
  const i = Math.floor(timeSec / a.hopSec);
  const stems: Record<string, StemFeatures> = {};
  const acc: StemFeatures = { level: 0, bandLow: 0, bandMid: 0, bandHigh: 0, brightness: 0, flux: 0 };
  for (const s of a.stems) {
    const f: StemFeatures = {
      level: at(s.level, i), bandLow: at(s.bandLow, i), bandMid: at(s.bandMid, i),
      bandHigh: at(s.bandHigh, i), brightness: at(s.brightness, i), flux: at(s.flux, i),
    };
    stems[s.id] = f;
    acc.level = Math.max(acc.level, f.level);
    acc.bandLow += f.bandLow; acc.bandMid += f.bandMid; acc.bandHigh += f.bandHigh;
    acc.brightness = Math.max(acc.brightness, f.brightness); acc.flux = Math.max(acc.flux, f.flux);
  }
  // tempoPhase from beat grid.
  let phase = 0;
  const beats = a.beatTimesSec;
  if (beats.length >= 2) {
    let b = 0; while (b < beats.length - 1 && beats[b + 1] <= timeSec) b++;
    const t0 = beats[b], t1 = beats[Math.min(beats.length - 1, b + 1)];
    phase = t1 > t0 ? Math.max(0, Math.min(1, (timeSec - t0) / (t1 - t0))) : 0;
  }
  return { timeSec, tempoPhase: phase, master: acc, stems };
}
