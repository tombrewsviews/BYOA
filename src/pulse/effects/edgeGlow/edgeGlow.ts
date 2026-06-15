import frag from "./edgeGlow.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const edgeGlow: EffectDescriptor = {
  type: "edgeGlow", label: "Edge Glow", kind: "effect", frag, blend: "alpha",
  params: [
    { name: "strength", min: 0.5, max: 8, default: 3, step: 0.1 },
    { name: "glow", min: 0, max: 3, default: 1.2, step: 0.05 },
    { name: "r", min: 0, max: 1, default: 0.2, step: 0.01 },
    { name: "g", min: 0, max: 1, default: 1.0, step: 0.01 },
    { name: "b", min: 0, max: 1, default: 0.8, step: 0.01 },
  ],
  uniforms: (p) => ({ uStrength: p.strength, uGlow: p.glow, uColor: [p.r, p.g, p.b] }),
};
