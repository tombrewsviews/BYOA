// src/pulse/__tests__/stage-compile.test.ts
import { describe, it, expect } from "vitest";
import { buildDeckPasses } from "../Stage";
import type { Deck } from "../schema";

describe("buildDeckPasses", () => {
  it("maps deck effects to passes with frag + blend, skipping disabled/unknown", () => {
    const deck: Deck = { effects: [
      { id: "e0", type: "wave", enabled: true, locked: false, params: { amplitude: 0.2, wavelength: 0.3 }, bindings: [] },
      { id: "e1", type: "pixelate", enabled: false, locked: false, params: {}, bindings: [] },
      { id: "e2", type: "doesNotExist", enabled: true, locked: false, params: {}, bindings: [] },
    ]};
    const passes = buildDeckPasses(deck);
    expect(passes.length).toBe(1);
    expect(passes[0].type).toBe("wave");
    expect(passes[0].frag.length).toBeGreaterThan(20);
  });
});
