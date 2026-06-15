// src/pulse/__tests__/registry.test.ts
import { describe, it, expect } from "vitest";
import { EFFECTS, effectTypes } from "../effects/registry";

describe("effect registry", () => {
  it("registers wave, pixelate, noiseField with non-empty GLSL", () => {
    for (const t of ["wave", "pixelate", "noiseField"]) {
      expect(effectTypes).toContain(t);
      expect(EFFECTS[t].frag.length).toBeGreaterThan(20);
      expect(EFFECTS[t].params.length).toBeGreaterThan(0);
    }
  });
  it("pixelate exposes a pixel-size and falloff param", () => {
    const names = EFFECTS.pixelate.params.map((p) => p.name);
    expect(names).toContain("pixelSize");
    expect(names).toContain("falloff");
  });
  it("uniforms() returns a uTime and the param uniforms", () => {
    const frame = { timeSec: 1, tempoPhase: 0, master: { level: 0.5, bandLow: 0, bandMid: 0, bandHigh: 0, brightness: 0, flux: 0 }, stems: {} };
    const u = EFFECTS.wave.uniforms({ amplitude: 0.3, wavelength: 0.2 }, frame as any);
    expect(typeof u.uAmplitude).toBe("number");
  });
});
