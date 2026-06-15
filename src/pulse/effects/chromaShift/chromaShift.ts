import frag from "./chromaShift.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const chromaShift: EffectDescriptor = {
  type: "chromaShift", label: "Chroma Shift", kind: "effect", frag, blend: "alpha",
  params: [
    { name: "amount", min: 0, max: 0.05, default: 0.01, step: 0.001 },
  ],
  uniforms: (p) => ({ uAmount: p.amount }),
};
