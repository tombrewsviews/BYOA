import frag from "./plasma.frag.glsl?raw";
import type { EffectDescriptor } from "../types";
export const plasma: EffectDescriptor = {
  type: "plasma", label: "Plasma", kind: "generator", frag, blend: "screen",
  params: [
    { name: "scale",      min: 2,   max: 40,  default: 12,  step: 0.5  },
    { name: "speed",      min: 0,   max: 4,   default: 1,   step: 0.05 },
    // hue offset: 0=red, 0.17=yellow, 0.33=green, 0.5=cyan, 0.67=blue, 0.83=magenta
    { name: "colorR",     min: 0,   max: 1,   default: 0.6, step: 0.01 },
    // saturation: keep at 1 for vivid, lower for pastels
    { name: "saturation", min: 0,   max: 1,   default: 1.0, step: 0.01 },
    // brightness: keep below 0.85 to avoid white blowout when layers stack
    { name: "brightness", min: 0,   max: 1,   default: 0.7, step: 0.01 },
    // 0=screen (safe), 1=add (bright), 2=multiply (dark), 3=overlay
    { name: "blendMode",  min: 0,   max: 3,   default: 0,   step: 1    },
  ],
  uniforms: (p, frame) => ({
    uTime:       frame.timeSec,
    uScale:      p.scale,
    uSpeed:      p.speed,
    uColorR:     p.colorR,
    uColorG:     0, // unused — kept for shader uniform slot compatibility
    uColorB:     0,
    uSaturation: p.saturation,
    uBrightness: p.brightness,
    uBlend:      p.blendMode,
  }),
};
