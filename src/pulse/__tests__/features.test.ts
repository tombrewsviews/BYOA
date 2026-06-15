// src/pulse/__tests__/features.test.ts
import { describe, it, expect } from "vitest";
import { extractFrame } from "../features";

const sine = (freq: number, sr: number, N: number) => {
  const b = new Float32Array(N);
  for (let n = 0; n < N; n++) b[n] = Math.sin((2 * Math.PI * freq * n) / sr);
  return b;
};

describe("extractFrame", () => {
  it("low tone has higher bandLow than bandHigh", () => {
    const sr = 48000, N = 2048;
    const f = extractFrame(sine(80, sr, N), sr);
    expect(f.bandLow).toBeGreaterThan(f.bandHigh);
  });

  it("high tone has higher brightness than a low tone", () => {
    const sr = 48000, N = 2048;
    const low = extractFrame(sine(80, sr, N), sr);
    const high = extractFrame(sine(8000, sr, N), sr);
    expect(high.brightness).toBeGreaterThan(low.brightness);
  });

  it("level of silence is ~0", () => {
    const f = extractFrame(new Float32Array(2048), 48000);
    expect(f.level).toBeLessThan(1e-4);
  });
});
