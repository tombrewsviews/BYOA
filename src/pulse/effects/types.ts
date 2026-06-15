// src/pulse/effects/types.ts
import type { FeatureFrame } from "../featureBus";

export type ParamSpec = { name: string; min: number; max: number; default: number; step: number };
export type UniformMap = Record<string, number | number[]>;

export type EffectDescriptor = {
  type: string;
  label: string;
  frag: string;                 // GLSL fragment source
  params: ParamSpec[];
  // Given resolved param values + the current audio frame, produce uniforms.
  uniforms: (resolved: Record<string, number>, frame: FeatureFrame) => UniformMap;
  blend: "add" | "screen" | "alpha" | "multiply";
};
