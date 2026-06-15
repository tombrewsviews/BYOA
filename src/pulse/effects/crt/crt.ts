import frag from "./crt.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const crt: EffectDescriptor = {
  type: "crt", label: "CRT", kind: "effect", frag, blend: "alpha",
  params: [
    { name: "scanline", min: 0, max: 1, default: 0.4, step: 0.01 },
    { name: "curve", min: 0, max: 0.5, default: 0.15, step: 0.01 },
    { name: "vignette", min: 0, max: 1, default: 0.5, step: 0.01 },
  ],
  uniforms: (p) => ({ uScanline: p.scanline, uCurve: p.curve, uVignette: p.vignette }),
};
