import frag from "./wave.frag.glsl?raw";
import type { EffectDescriptor } from "../types";

export const wave: EffectDescriptor = {
  type: "wave", label: "Wave", kind: "generator", frag, blend: "add",
  params: [
    { name: "amplitude", min: 0, max: 0.5, default: 0.15, step: 0.01 },
    { name: "wavelength", min: 0.02, max: 1, default: 0.2, step: 0.01 },
  ],
  uniforms: (p, frame) => ({ uTime: frame.timeSec, uAmplitude: p.amplitude, uWavelength: p.wavelength }),
};
