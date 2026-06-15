import frag from "./halftone.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const halftone: EffectDescriptor = {
  type: "halftone", label: "Halftone", kind: "effect", frag, blend: "alpha",
  params: [
    { name: "scale", min: 3, max: 30, default: 8, step: 1 },
    { name: "angle", min: 0, max: 1.57, default: 0.4, step: 0.01 },
  ],
  uniforms: (p) => ({ uScale: p.scale, uAngle: p.angle }),
};
