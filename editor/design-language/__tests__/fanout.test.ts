import { describe, it, expect } from "vitest";
import { resolve, BASE_TOKENS } from "../fanout";
import { emptyState } from "../dials";
import { hexToHsl } from "../color";

describe("fanout.resolve (pure)", () => {
  it("neutral state returns BASE unchanged", () => {
    expect(resolve(emptyState())).toEqual(BASE_TOKENS);
  });
  it("warmer temperature raises hue of mid-grey neutrals toward amber", () => {
    const warm = resolve({ ...emptyState(), temperature: 3 });
    const baseH = hexToHsl(BASE_TOKENS["--card"]).h;
    const warmH = hexToHsl(warm["--card"]).h;
    expect(warm["--card"]).not.toBe(BASE_TOKENS["--card"]);
    expect(Math.abs(((warmH - 40 + 540) % 360) - 180)).toBeLessThan(
      Math.abs(((baseH - 40 + 540) % 360) - 180) + 1,
    );
  });
  it("punchy contrast pushes foreground lighter and background darker", () => {
    const punchy = resolve({ ...emptyState(), contrast: 3 });
    expect(hexToHsl(punchy["--foreground"]).l).toBeGreaterThanOrEqual(
      hexToHsl(BASE_TOKENS["--foreground"]).l,
    );
    expect(hexToHsl(punchy["--background"]).l).toBeLessThanOrEqual(
      hexToHsl(BASE_TOKENS["--background"]).l,
    );
  });
  it("airy density increases --spacing, packed decreases it", () => {
    const airy = parseFloat(resolve({ ...emptyState(), density: -3 })["--spacing"]);
    const packed = parseFloat(resolve({ ...emptyState(), density: 3 })["--spacing"]);
    const base = parseFloat(BASE_TOKENS["--spacing"]);
    expect(airy).toBeGreaterThan(base);
    expect(packed).toBeLessThan(base);
  });
  it("rounded softness increases --radius, sharp decreases it", () => {
    expect(parseFloat(resolve({ ...emptyState(), softness: 3 })["--radius"]))
      .toBeGreaterThan(parseFloat(BASE_TOKENS["--radius"]));
    expect(parseFloat(resolve({ ...emptyState(), softness: -3 })["--radius"]))
      .toBeLessThan(parseFloat(BASE_TOKENS["--radius"]));
  });
  it("expressive character raises saturation of --primary", () => {
    const expr = resolve({ ...emptyState(), character: 3 });
    expect(hexToHsl(expr["--primary"]).s).toBeGreaterThanOrEqual(
      hexToHsl(BASE_TOKENS["--primary"]).s,
    );
  });
  it("is relative to BASE, never compounding (idempotent per state)", () => {
    const a = resolve({ ...emptyState(), temperature: 2 });
    const b = resolve({ ...emptyState(), temperature: 2 });
    expect(a).toEqual(b);
  });
  it("BASE includes the 6 ui-text + 6 ui-leading tokens", () => {
    for (const k of ["--ui-2xs","--ui-xs","--ui-sm","--ui-base","--ui-lg","--ui-xl"])
      expect(BASE_TOKENS[k]).toBeTruthy();
    for (const k of ["--ui-leading-2xs","--ui-leading-xs","--ui-leading-sm","--ui-leading-base","--ui-leading-lg","--ui-leading-xl"])
      expect(BASE_TOKENS[k]).toBeTruthy();
  });
  it("large scale grows every --ui-* size token, compact shrinks it", () => {
    const big = resolve({ ...emptyState(), scale: 3 });
    const small = resolve({ ...emptyState(), scale: -3 });
    for (const k of ["--ui-2xs","--ui-sm","--ui-xl"]) {
      expect(parseFloat(big[k])).toBeGreaterThan(parseFloat(BASE_TOKENS[k]));
      expect(parseFloat(small[k])).toBeLessThan(parseFloat(BASE_TOKENS[k]));
    }
  });
  it("loose leading raises every --ui-leading-* token, tight lowers it", () => {
    const loose = resolve({ ...emptyState(), leading: 3 });
    const tight = resolve({ ...emptyState(), leading: -3 });
    for (const k of ["--ui-leading-sm","--ui-leading-base"]) {
      expect(parseFloat(loose[k])).toBeGreaterThan(parseFloat(BASE_TOKENS[k]));
      expect(parseFloat(tight[k])).toBeLessThan(parseFloat(BASE_TOKENS[k]));
    }
  });
});
