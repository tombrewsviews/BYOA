// src/pulse/features.ts
import { fftMagnitudes } from "./fft";

export type Frame = {
  level: number;      // RMS 0..~1
  bandLow: number;    // <250 Hz energy
  bandMid: number;    // 250..2000 Hz
  bandHigh: number;   // >2000 Hz
  brightness: number; // spectral centroid, normalized 0..1
};

function nextPow2(n: number) { let p = 1; while (p < n) p <<= 1; return p; }

// Hann-windowed magnitude spectrum of a mono frame.
function spectrum(frame: Float32Array): { mags: Float32Array; sr2bin: number } {
  const N = nextPow2(frame.length);
  const buf = new Float32Array(N);
  for (let i = 0; i < frame.length; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frame.length - 1));
    buf[i] = frame[i] * w;
  }
  return { mags: fftMagnitudes(buf), sr2bin: N };
}

export function extractFrame(frame: Float32Array, sampleRate: number): Frame {
  // RMS level.
  let sumSq = 0;
  for (let i = 0; i < frame.length; i++) sumSq += frame[i] * frame[i];
  const level = Math.sqrt(sumSq / frame.length);

  const { mags, sr2bin } = spectrum(frame);
  const binHz = sampleRate / sr2bin;
  let low = 0, mid = 0, high = 0, weighted = 0, total = 0;
  for (let i = 1; i < mags.length; i++) {
    const hz = i * binHz, m = mags[i];
    if (hz < 250) low += m; else if (hz < 2000) mid += m; else high += m;
    weighted += hz * m; total += m;
  }
  const centroidHz = total > 0 ? weighted / total : 0;
  const brightness = Math.min(1, centroidHz / (sampleRate / 2));
  return { level, bandLow: low, bandMid: mid, bandHigh: high, brightness };
}
