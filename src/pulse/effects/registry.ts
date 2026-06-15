import type { EffectDescriptor } from "./types";
import { wave } from "./wave/wave";
import { pixelate } from "./pixelate/pixelate";
import { noiseField } from "./noiseField/noiseField";
import { bloomPulse } from "./bloomPulse/bloomPulse";
import { spectrumBars } from "./spectrumBars/spectrumBars";
import { feedbackTrails } from "./feedbackTrails/feedbackTrails";
import { kaleido } from "./kaleido/kaleido";
import { chromaShift } from "./chromaShift/chromaShift";
import { contourLines } from "./contourLines/contourLines";
import { particleBurst } from "./particleBurst/particleBurst";

export const EFFECTS: Record<string, EffectDescriptor> = {
  wave, pixelate, noiseField, bloomPulse, spectrumBars, feedbackTrails, kaleido, chromaShift, contourLines, particleBurst,
};
export const effectTypes = Object.keys(EFFECTS);
