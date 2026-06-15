import frag from "./bloomPulse.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const bloomPulse: EffectDescriptor = {
  type: "bloomPulse", label: "Bloom Pulse", kind: "generator", frag, blend: "add",
  params: [
    { name: "intensity", min: 0, max: 2, default: 0.6, step: 0.05 },
    { name: "radius", min: 0.1, max: 1.5, default: 0.6, step: 0.05 },
    { name: "colorR", min: 0, max: 1, default: 0.55, step: 0.01 },
    { name: "colorG", min: 0, max: 1, default: 0.1, step: 0.01 },
    { name: "colorB", min: 0, max: 1, default: 1.0, step: 0.01 },
  ],
  uniforms: (p) => ({
    uIntensity: p.intensity,
    uRadius: p.radius,
    uColor: [p.colorR, p.colorG, p.colorB],
  }),
};
