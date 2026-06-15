// src/pulse/effects/types.ts
import type { FeatureFrame } from "../featureBus";

export type ParamSpec = { name: string; min: number; max: number; default: number; step: number };
export type UniformMap = Record<string, number | number[]>;

export type EffectDescriptor = {
  type: string;
  label: string;
  // "generator" makes light from nothing (adds onto a black/previous pass);
  // "effect" only distorts what's already drawn. A stack needs ≥1 generator
  // or it renders black.
  kind: "generator" | "effect";
  frag: string;                 // GLSL fragment source
  params: ParamSpec[];
  // Given resolved param values + the current audio frame, produce uniforms.
  uniforms: (resolved: Record<string, number>, frame: FeatureFrame) => UniformMap;
  blend: "add" | "screen" | "alpha" | "multiply";
  // Media generators (imageSource/videoSource) set this to "image"|"video";
  // the Stage then binds the effect's `src` file to uTex (TEXTURE1).
  media?: "image" | "video";
};
