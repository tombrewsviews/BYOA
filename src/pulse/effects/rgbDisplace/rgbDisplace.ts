import frag from "./rgbDisplace.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const rgbDisplace: EffectDescriptor = {
  type: "rgbDisplace", label: "RGB Displace", kind: "effect", frag, blend: "alpha",
  params: [
    { name: "amount", min: 0, max: 0.2, default: 0.04, step: 0.005 },
    { name: "speed", min: 0, max: 20, default: 6, step: 0.5 },
  ],
  uniforms: (p, frame) => ({ uTime: frame.timeSec, uAmount: p.amount, uSpeed: p.speed }),
};
