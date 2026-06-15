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
};

// Effects render as a STACK: each effect samples the previous one's output,
// so order matters. Put generators (wave, noiseField) low and distorters
// (pixelate, kaleido, chromaShift) high to fold the layers together.
export const STACK_TIP =
  "Effects stack top→bottom: each one is drawn over the one above it. Generators (Wave, Noise Field) work best at the top; distorters (Pixelate, Kaleido, Chroma Shift) below them fold everything together. Bind any parameter to a stem's audio feature to make it move with the music.";
