import frag from "./bloomPulse.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const bloomPulse: EffectDescriptor = {
  type: "bloomPulse", label: "Bloom Pulse", frag, blend: "add",
  params: [
    { name: "intensity", min: 0, max: 2, default: 0.6, step: 0.05 },
    { name: "radius", min: 0.1, max: 1.5, default: 0.6, step: 0.05 },
  ],
  uniforms: (p) => ({ uIntensity: p.intensity, uRadius: p.radius }),
};
