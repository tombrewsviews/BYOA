import frag from "./mirror.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const mirror: EffectDescriptor = {
  type: "mirror", label: "Mirror", kind: "effect", frag, blend: "alpha",
  params: [
    { name: "axis", min: 0, max: 1, default: 0, step: 1 },
    { name: "split", min: 0.1, max: 0.9, default: 0.5, step: 0.01 },
  ],
  uniforms: (p) => ({ uAxis: p.axis, uSplit: p.split }),
};
