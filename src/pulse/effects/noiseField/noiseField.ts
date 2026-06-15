import frag from "./noiseField.frag.glsl?raw";
import type { EffectDescriptor } from "../types";

export const noiseField: EffectDescriptor = {
  type: "noiseField", label: "Noise Field", frag, blend: "screen",
  params: [
    { name: "scale", min: 1, max: 40, default: 8, step: 0.5 },
    { name: "speed", min: 0, max: 4, default: 0.5, step: 0.05 },
  ],
  uniforms: (p, frame) => ({ uTime: frame.timeSec, uScale: p.scale, uSpeed: p.speed }),
};
