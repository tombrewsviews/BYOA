import frag from "./gradient.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const gradient: EffectDescriptor = {
  type: "gradient", label: "Gradient", kind: "generator", frag, blend: "add",
  params: [
    { name: "angle", min: 0, max: 6.2831, default: 1.2, step: 0.05 },
    { name: "speed", min: 0, max: 4, default: 0.5, step: 0.05 },
    { name: "aR", min: 0, max: 1, default: 0.1, step: 0.01 },
    { name: "aG", min: 0, max: 1, default: 0.0, step: 0.01 },
    { name: "aB", min: 0, max: 1, default: 0.3, step: 0.01 },
    { name: "bR", min: 0, max: 1, default: 0.9, step: 0.01 },
    { name: "bG", min: 0, max: 1, default: 0.3, step: 0.01 },
    { name: "bB", min: 0, max: 1, default: 0.6, step: 0.01 },
  ],
  uniforms: (p, frame) => ({
    uTime: frame.timeSec, uAngle: p.angle, uSpeed: p.speed,
    uColorA: [p.aR, p.aG, p.aB], uColorB: [p.bR, p.bG, p.bB],
  }),
};
