import frag from "./videoSource.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const videoSource: EffectDescriptor = {
  type: "videoSource", label: "Video", kind: "generator", media: "video", frag, blend: "alpha",
  params: [
    { name: "opacity", min: 0, max: 1, default: 1, step: 0.01 },
    { name: "fit", min: 0, max: 1, default: 0, step: 1 },
  ],
  uniforms: (p) => ({ uOpacity: p.opacity, uFit: p.fit, uTexAspect: 1 }),
};
