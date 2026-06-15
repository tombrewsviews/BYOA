import frag from "./particleBurst.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const particleBurst: EffectDescriptor = {
  type: "particleBurst", label: "Particle Burst", kind: "generator", frag, blend: "add",
  params: [
    { name: "count", min: 4, max: 80, default: 24, step: 1 },
    { name: "burst", min: 0, max: 1, default: 0.5, step: 0.01 },
  ],
  uniforms: (p) => ({ uCount: p.count, uBurst: p.burst }),
};
