import frag from "./oilPaint.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const oilPaint: EffectDescriptor = {
  type: "oilPaint", label: "Oil Paint", kind: "effect", frag, blend: "alpha",
  params: [
    { name: "radius", min: 1, max: 4, default: 3, step: 1 },
  ],
  uniforms: (p) => ({ uRadius: p.radius }),
};
