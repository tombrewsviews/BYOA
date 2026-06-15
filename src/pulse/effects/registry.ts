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
import { plasma } from "./plasma/plasma";
import { voronoi } from "./voronoi/voronoi";
import { metaballs } from "./metaballs/metaballs";
import { tunnel } from "./tunnel/tunnel";
import { gradient } from "./gradient/gradient";
import { starfield } from "./starfield/starfield";
import { dither } from "./dither/dither";
import { mirror } from "./mirror/mirror";
import { posterize } from "./posterize/posterize";
import { imageSource } from "./imageSource/imageSource";
import { videoSource } from "./videoSource/videoSource";
import { halftone } from "./halftone/halftone";
import { ascii } from "./ascii/ascii";
import { crt } from "./crt/crt";
import { edgeGlow } from "./edgeGlow/edgeGlow";
import { rgbDisplace } from "./rgbDisplace/rgbDisplace";
import { scanGlitch } from "./scanGlitch/scanGlitch";
import { oilPaint } from "./oilPaint/oilPaint";

export const EFFECTS: Record<string, EffectDescriptor> = {
  wave, pixelate, noiseField, bloomPulse, spectrumBars, feedbackTrails, kaleido, chromaShift, contourLines, particleBurst,
  plasma, voronoi, metaballs, tunnel, gradient, starfield, dither, mirror, posterize, imageSource, videoSource,
  halftone, ascii, crt, edgeGlow, rgbDisplace, scanGlitch, oilPaint,
};
export const effectTypes = Object.keys(EFFECTS);

/** Effect type ids grouped by kind, each sorted by label — for grouped menus. */
export const effectTypesByKind = (kind: EffectDescriptor["kind"]): string[] =>
  effectTypes
    .filter((t) => EFFECTS[t].kind === kind)
    .sort((a, b) => EFFECTS[a].label.localeCompare(EFFECTS[b].label));
