// src/pulse/__tests__/fft.test.ts
import { describe, it, expect } from "vitest";
import { fftMagnitudes } from "../fft";

describe("fftMagnitudes", () => {
  it("puts energy in the bin matching a pure sine", () => {
    const N = 64;
    const k = 8; // 8 cycles across the window
    const sig = new Float32Array(N);
    for (let n = 0; n < N; n++) sig[n] = Math.sin((2 * Math.PI * k * n) / N);
    const mags = fftMagnitudes(sig); // length N/2
    let peak = 0, peakBin = -1;
    for (let i = 0; i < mags.length; i++) if (mags[i] > peak) { peak = mags[i]; peakBin = i; }
    expect(peakBin).toBe(k);
  });

  it("returns near-zero for a DC-removed silent signal", () => {
    const mags = fftMagnitudes(new Float32Array(64));
    const sum = mags.reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThan(1e-6);
  });
});
