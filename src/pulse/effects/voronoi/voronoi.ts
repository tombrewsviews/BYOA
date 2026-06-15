import frag from "./voronoi.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const voronoi: EffectDescriptor = {
  type: "voronoi", label: "Voronoi", kind: "generator", frag, blend: "add",
  params: [
    { name: "density", min: 2, max: 24, default: 6, step: 1 },
    { name: "speed", min: 0, max: 4, default: 1, step: 0.05 },
  ],
  uniforms: (p, frame) => ({ uTime: frame.timeSec, uDensity: p.density, uSpeed: p.speed }),
};
