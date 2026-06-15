import frag from "./contourLines.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const contourLines: EffectDescriptor = {
  type: "contourLines", label: "Contour Lines", kind: "effect", frag, blend: "screen",
  params: [
    { name: "freq", min: 1, max: 40, default: 8, step: 0.5 },
    { name: "threshold", min: 0, max: 1, default: 0.5, step: 0.01 },
  ],
  uniforms: (p) => ({ uFreq: p.freq, uThreshold: p.threshold }),
};
