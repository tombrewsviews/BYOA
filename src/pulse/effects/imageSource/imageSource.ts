import frag from "./imageSource.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const imageSource: EffectDescriptor = {
  type: "imageSource", label: "Image", kind: "generator", media: "image", frag, blend: "alpha",
  params: [
    { name: "opacity", min: 0, max: 1, default: 1, step: 0.01 },
    { name: "fit", min: 0, max: 1, default: 0, step: 1 },
  ],
  uniforms: (p) => ({ uOpacity: p.opacity, uFit: p.fit, uTexAspect: 1 }),
};
