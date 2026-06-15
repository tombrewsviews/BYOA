import frag from "./dither.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const dither: EffectDescriptor = {
  type: "dither", label: "Dither", kind: "effect", frag, blend: "alpha",
  params: [
    { name: "scale", min: 1, max: 8, default: 2, step: 1 },
    { name: "levels", min: 2, max: 8, default: 3, step: 1 },
  ],
  uniforms: (p) => ({ uScale: p.scale, uLevels: p.levels }),
};
