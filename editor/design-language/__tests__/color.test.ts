import { describe, it, expect } from "vitest";
import { hexToHsl, hslToHex, shiftHue, shiftLightness, shiftSaturation } from "../color";

describe("color math (pure HSL transforms)", () => {
  it("round-trips hex -> hsl -> hex", () => {
    expect(hslToHex(hexToHsl("#242427"))).toBe("#242427");
  });
  it("parses and reserializes pure white/black", () => {
    expect(hslToHex(hexToHsl("#ffffff"))).toBe("#ffffff");
    expect(hslToHex(hexToHsl("#000000"))).toBe("#000000");
  });
  it("shiftLightness raises L (brighter) and clamps at 100", () => {
    const darker = hexToHsl("#242427");
    expect(shiftLightness(darker, 10).l).toBeGreaterThan(darker.l);
    expect(shiftLightness(hexToHsl("#ffffff"), 10).l).toBe(100);
  });
  it("shiftSaturation raises S and clamps 0..100", () => {
    const c = hexToHsl("#f87171");
    expect(shiftSaturation(c, 10).s).toBeGreaterThanOrEqual(c.s);
    expect(shiftSaturation(c, -999).s).toBe(0);
  });
  it("shiftHue wraps modulo 360", () => {
    expect(shiftHue({ h: 350, s: 50, l: 50 }, 20).h).toBeCloseTo(10, 5);
  });
  it("near-grey has near-zero saturation (caveat from spec)", () => {
    expect(hexToHsl("#0a0a0a").s).toBeLessThan(5);
  });
});
