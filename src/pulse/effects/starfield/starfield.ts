import frag from "./starfield.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const starfield: EffectDescriptor = {
  type: "starfield", label: "Starfield", kind: "generator", frag, blend: "add",
  params: [
    { name: "density", min: 1, max: 20, default: 8, step: 0.5 },
    { name: "speed", min: 0, max: 6, default: 2, step: 0.1 },
  ],
  uniforms: (p, frame) => ({ uTime: frame.timeSec, uDensity: p.density, uSpeed: p.speed }),
};
