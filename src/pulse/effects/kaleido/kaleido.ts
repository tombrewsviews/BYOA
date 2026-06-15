import frag from "./kaleido.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const kaleido: EffectDescriptor = {
  type: "kaleido", label: "Kaleido", frag, blend: "alpha",
  params: [
    { name: "segments", min: 1, max: 12, default: 6, step: 1 },
  ],
  uniforms: (p) => ({ uSegments: p.segments }),
};
