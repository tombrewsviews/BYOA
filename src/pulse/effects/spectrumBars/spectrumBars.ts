import frag from "./spectrumBars.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const spectrumBars: EffectDescriptor = {
  type: "spectrumBars", label: "Spectrum Bars", frag, blend: "add",
  params: [
    { name: "low", min: 0, max: 1, default: 0.5, step: 0.01 },
    { name: "mid", min: 0, max: 1, default: 0.5, step: 0.01 },
    { name: "high", min: 0, max: 1, default: 0.5, step: 0.01 },
  ],
  uniforms: (p) => ({ uLow: p.low, uMid: p.mid, uHigh: p.high }),
};
