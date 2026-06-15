// src/pulse/__tests__/analysis.test.ts
import { describe, it, expect } from "vitest";
import { analyzeChannel } from "../analysis";

// Build a 1-second 48k mono buffer: low tone for 0.5s then high tone.
function twoTone(sr: number): Float32Array {
  const buf = new Float32Array(sr);
  for (let n = 0; n < sr; n++) {
    const f = n < sr / 2 ? 80 : 8000;
    buf[n] = Math.sin((2 * Math.PI * f * n) / sr);
  }
  return buf;
}

describe("analyzeChannel", () => {
  it("produces per-frame arrays of equal length and a role", () => {
    const sr = 48000;
    const res = analyzeChannel(twoTone(sr), sr, 1 / 60);
    expect(res.level.length).toBe(res.brightness.length);
    expect(res.level.length).toBeGreaterThan(50);
    expect(res.brightness[5]).toBeLessThan(res.brightness[res.brightness.length - 5]); // bright at the end
    expect(typeof res.role).toBe("string");
  });
});
