import frag from "./scanGlitch.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const scanGlitch: EffectDescriptor = {
  type: "scanGlitch", label: "Scan Glitch", kind: "effect", frag, blend: "alpha",
  params: [
    { name: "intensity", min: 0, max: 0.5, default: 0.12, step: 0.01 },
    { name: "blocks", min: 4, max: 60, default: 24, step: 1 },
  ],
  uniforms: (p, frame) => ({ uTime: frame.timeSec, uIntensity: p.intensity, uBlocks: p.blocks }),
};
