import frag from "./tunnel.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const tunnel: EffectDescriptor = {
  type: "tunnel", label: "Tunnel", kind: "generator", frag, blend: "add",
  params: [
    { name: "speed", min: 0, max: 4, default: 1, step: 0.05 },
    { name: "twist", min: 0, max: 4, default: 1, step: 0.05 },
  ],
  uniforms: (p, frame) => ({ uTime: frame.timeSec, uSpeed: p.speed, uTwist: p.twist }),
};
