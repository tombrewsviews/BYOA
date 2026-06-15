import frag from "./ascii.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const ascii: EffectDescriptor = {
  type: "ascii", label: "ASCII", kind: "effect", frag, blend: "alpha",
  params: [
    { name: "cell", min: 4, max: 24, default: 10, step: 1 },
  ],
  uniforms: (p) => ({ uCell: p.cell }),
};
