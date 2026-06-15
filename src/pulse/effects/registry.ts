import type { EffectDescriptor } from "./types";
import { wave } from "./wave/wave";
import { pixelate } from "./pixelate/pixelate";
import { noiseField } from "./noiseField/noiseField";

export const EFFECTS: Record<string, EffectDescriptor> = {
  wave, pixelate, noiseField,
};
export const effectTypes = Object.keys(EFFECTS);
