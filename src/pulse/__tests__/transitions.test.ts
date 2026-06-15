// src/pulse/__tests__/transitions.test.ts
import { describe, it, expect } from "vitest";
import { shapeCurve, blendDecks } from "../transitions";
import type { Deck } from "../schema";

const deckA: Deck = { effects: [{ id: "a", type: "wave", enabled: true, locked: false, params: { amplitude: 0 }, bindings: [] }] };
const deckB: Deck = { effects: [{ id: "a", type: "wave", enabled: true, locked: false, params: { amplitude: 1 }, bindings: [] }] };

describe("shapeCurve", () => {
  it("clamps and maps endpoints", () => {
    expect(shapeCurve(0, "linear")).toBe(0);
    expect(shapeCurve(1, "linear")).toBe(1);
    expect(shapeCurve(-1, "linear")).toBe(0);
    expect(shapeCurve(2, "linear")).toBe(1);
  });
  it("ease is monotonic between 0 and 1", () => {
    expect(shapeCurve(0, "ease")).toBeCloseTo(0);
    expect(shapeCurve(1, "ease")).toBeCloseTo(1);
    expect(shapeCurve(0.5, "ease")).toBeGreaterThan(0);
  });
});

describe("blendDecks morphParams", () => {
  it("t=0 returns A params, t=1 returns B params", () => {
    const at0 = blendDecks(deckA, deckB, 0, "morphParams");
    const at1 = blendDecks(deckA, deckB, 1, "morphParams");
    expect(at0.effects[0].params.amplitude).toBeCloseTo(0);
    expect(at1.effects[0].params.amplitude).toBeCloseTo(1);
  });
  it("t=0.5 interpolates a shared param", () => {
    const mid = blendDecks(deckA, deckB, 0.5, "morphParams");
    expect(mid.effects[0].params.amplitude).toBeCloseTo(0.5);
  });
  it("cut switches at 0.5", () => {
    expect(blendDecks(deckA, deckB, 0.4, "cut").effects[0].params.amplitude).toBeCloseTo(0);
    expect(blendDecks(deckA, deckB, 0.6, "cut").effects[0].params.amplitude).toBeCloseTo(1);
  });
});
