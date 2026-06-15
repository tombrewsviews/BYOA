// src/pulse/bindings.ts
import type { Binding, Feature } from "./schema";
import type { FeatureFrame, StemFeatures } from "./featureBus";

const featureValue = (f: StemFeatures, frame: FeatureFrame, name: Feature): number => {
  switch (name) {
    case "level": return f.level;
    case "bandLow": return f.bandLow;
    case "bandMid": return f.bandMid;
    case "bandHigh": return f.bandHigh;
    case "brightness": return f.brightness;
    case "flux": return f.flux;
    case "onset": return f.flux;          // onset proxy: instantaneous flux
    case "tempoPhase": return frame.tempoPhase;
  }
};

const shape = (v: number, curve: Binding["curve"]): number => {
  switch (curve) {
    case "linear": return v;
    case "exp": return v * v;
    case "log": return Math.sqrt(Math.max(0, v));
    case "smooth": return v * v * (3 - 2 * v);
  }
};

// Resolve a single effect param: base value + sum of its bindings, each
// scaled by binding.amount and the stem's volume (visual amplitude).
export function resolveParam(
  base: number,
  bindings: Binding[],
  param: string,
  frame: FeatureFrame,
  stemVolume: number,
): number {
  let v = base;
  for (const b of bindings) {
    if (b.param !== param) continue;
    const src = b.source.stem === "master" ? frame.master : frame.stems[b.source.stem];
    if (!src) continue;
    const raw = featureValue(src, frame, b.source.feature);
    const vol = b.source.stem === "master" ? 1 : stemVolume;
    v += (shape(raw, b.curve) * b.amount + b.offset) * vol;
  }
  return v;
}
