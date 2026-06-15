import frag from "./feedbackTrails.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const feedbackTrails: EffectDescriptor = {
  type: "feedbackTrails", label: "Feedback Trails", kind: "effect", frag, blend: "alpha",
  params: [
    { name: "decay", min: 0, max: 0.99, default: 0.85, step: 0.01 },
  ],
  uniforms: (p) => ({ uDecay: p.decay }),
};
