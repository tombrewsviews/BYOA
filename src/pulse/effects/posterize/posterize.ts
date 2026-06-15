import frag from "./posterize.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const posterize: EffectDescriptor = {
  type: "posterize", label: "Posterize", kind: "effect", frag, blend: "alpha",
  params: [
    { name: "levels", min: 2, max: 12, default: 4, step: 1 },
  ],
  uniforms: (p) => ({ uLevels: p.levels }),
};
