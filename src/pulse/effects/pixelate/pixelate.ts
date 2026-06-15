import frag from "./pixelate.frag.glsl?raw";
import type { EffectDescriptor } from "../types";

export const pixelate: EffectDescriptor = {
  type: "pixelate", label: "Pixelate", kind: "effect", frag, blend: "alpha",
  params: [
    { name: "pixelSize", min: 1, max: 80, default: 12, step: 1 },
    { name: "falloff", min: 0, max: 1, default: 0.3, step: 0.01 },
    { name: "tint", min: 0, max: 1, default: 0.5, step: 0.01 },
    { name: "bounce", min: 0, max: 1, default: 0.3, step: 0.01 },
    { name: "cascade", min: 0, max: 2, default: 0.5, step: 0.01 },
  ],
  uniforms: (p) => ({
    uPixelSize: p.pixelSize,
    uFalloff: p.falloff,
    uTint: p.tint,
    uBounce: p.bounce,
    uCascade: p.cascade,
  }),
};
