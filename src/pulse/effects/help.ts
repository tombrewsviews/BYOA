// In-context explanations for each effect: what it does + how to use it.
// Kept central (not on the descriptor) so it's easy to extend without
// touching every effect file.

export type EffectHelp = { what: string; how: string };

export const EFFECT_HELP: Record<string, EffectHelp> = {
  wave: {
    what: "A travelling sine wave across the screen.",
    how: "Bind amplitude to a stem's level for a pulse; wavelength to tempoPhase to make it ride the beat.",
  },
  pixelate: {
    what: "Chunks the image into square pixels with an edge falloff.",
    how: "Bind pixelSize to bandLow (bass) so the picture gets blockier on heavy hits; falloff to onset for punch.",
  },
  noiseField: {
    what: "An animated, flowing noise texture.",
    how: "Bind speed to brightness for faster flow on bright moments; scale to level for density.",
  },
  bloomPulse: {
    what: "A radial glow that blooms from the centre.",
    how: "Bind intensity to onset or level so it flares on transients/drops.",
  },
  spectrumBars: {
    what: "Three energy bars (low / mid / high) from the audio spectrum.",
    how: "Bind low/mid/high to a stem's bandLow/bandMid/bandHigh for a classic analyzer look.",
  },
  feedbackTrails: {
    what: "A motion smear that leaves trails behind movement.",
    how: "Raise decay for longer trails; bind decay to level so motion-memory grows with energy.",
  },
  kaleido: {
    what: "Mirrors the image into kaleidoscope wedges.",
    how: "Bind segments to a beat-driven feature; layer it OVER wave/noise to fold them into symmetry.",
  },
  chromaShift: {
    what: "Splits the red/blue channels for a glitchy RGB offset.",
    how: "Bind amount to flux so it glitches on transients (snares, clicks).",
  },
  contourLines: {
    what: "Iso-lines (topographic contours) of a noise field.",
    how: "Bind threshold to brightness; bind freq to a stem's level for denser lines on loud parts.",
  },
  particleBurst: {
    what: "A field of procedural dots that flash.",
    how: "Bind burst to onset so particles pop on hits; count to level for density.",
  },
  plasma: {
    what: "A flowing, colourful sinusoidal plasma field.",
    how: "Bind speed to level for faster churn on loud parts; scale to bandLow for chunkier waves.",
  },
  voronoi: {
    what: "Animated cellular (Voronoi) cells.",
    how: "Bind density to level; speed to tempoPhase so the cells pulse on the beat.",
  },
  metaballs: {
    what: "Blobby merging circles (classic lava-lamp).",
    how: "Bind radius to bandLow so blobs swell on the bass; speed to level for energy.",
  },
  tunnel: {
    what: "An infinite zooming tunnel in polar coordinates.",
    how: "Bind speed to level for acceleration on drops; twist to brightness.",
  },
  gradient: {
    what: "A smooth animated gradient — the simplest never-black base layer.",
    how: "Put it at the bottom of a stack so distorters always have something to fold. Bind angle/speed to taste.",
  },
  starfield: {
    what: "Flying-through-stars warp field.",
    how: "Bind speed to level for a warp-on-the-beat effect; density to bandHigh.",
  },
  dither: {
    what: "Ordered (Bayer) dithering for a retro 8-bit / print look.",
    how: "Put it near the TOP over a generator. Lower levels = harsher; bind scale to bandLow for a pulsing grain.",
  },
  mirror: {
    what: "Mirrors the image across a vertical or horizontal axis.",
    how: "Set axis (0 = vertical, 1 = horizontal) and split. Layer over any generator for instant symmetry.",
  },
  posterize: {
    what: "Crushes colours to a few flat bands.",
    how: "Lower levels = bolder poster look; bind levels to a beat feature for a flickering crush.",
  },
  imageSource: {
    what: "Draws a chosen image file as the base layer.",
    how: "Pick an image, then stack distorters (kaleido, dither, chroma shift) over it to remix it to the music.",
  },
  videoSource: {
    what: "Draws a chosen video file (muted, looping) as the base layer.",
    how: "Pick a video, then layer effects over it. Bind effect params to the audio so the clip reacts to the track.",
  },
  halftone: {
    what: "Comic / newspaper halftone dots from the image's brightness.",
    how: "Put over an image or video. Bind scale to bandLow so the dots swell on the bass.",
  },
  ascii: {
    what: "Renders the image as a grid of glyph-like cells (ASCII art look).",
    how: "Layer over video. Bind cell to level so the resolution coarsens when the track gets loud.",
  },
  crt: {
    what: "Old-TV look: scanlines, aperture-grille tint, barrel curve and vignette.",
    how: "Great as a top layer over media. Bind scanline to flux for a flickering CRT on transients.",
  },
  edgeGlow: {
    what: "Sobel edge detection traced as a neon outline over the image.",
    how: "Layer over video/image. Bind glow to onset so the outlines flare on hits; set the colour to taste.",
  },
  rgbDisplace: {
    what: "Datamosh-style RGB channel displacement driven by blocky noise.",
    how: "Bind amount to flux so it tears on transients; speed to level for faster churn.",
  },
  scanGlitch: {
    what: "Horizontal band displacement + channel tear (VHS / signal glitch).",
    how: "Bind intensity to onset for a glitch-on-the-beat; blocks to bandHigh for finer tearing.",
  },
  oilPaint: {
    what: "Kuwahara-style painterly smear that flattens detail into brush blobs.",
    how: "Layer over video for a moving-painting look. Bind radius to level for a thicker brush on loud parts.",
  },
};

// Effects render as a STACK: each effect samples the previous one's output,
// so order matters. Put generators (wave, noiseField) low and distorters
// (pixelate, kaleido, chromaShift) high to fold the layers together.
export const STACK_TIP =
  "Effects stack top→bottom: each one is drawn over the one above it. Generators (Wave, Noise Field) work best at the top; distorters (Pixelate, Kaleido, Chroma Shift) below them fold everything together. Bind any parameter to a stem's audio feature to make it move with the music.";
