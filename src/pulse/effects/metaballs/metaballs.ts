import frag from "./metaballs.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const metaballs: EffectDescriptor = {
  type: "metaballs", label: "Metaballs", kind: "generator", frag, blend: "add",
  params: [
    { name: "count", min: 2, max: 12, default: 6, step: 1 },
    { name: "radius", min: 0.05, max: 0.4, default: 0.18, step: 0.01 },
    { name: "speed", min: 0, max: 4, default: 1, step: 0.05 },
  ],
  uniforms: (p, frame) => ({ uTime: frame.timeSec, uCount: p.count, uRadius: p.radius, uSpeed: p.speed }),
};
