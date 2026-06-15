// src/pulse/__tests__/audioGraph.test.ts
import { describe, it, expect, vi } from "vitest";
import { computeGains } from "../audioGraph";

describe("computeGains", () => {
  it("muted stem yields 0, else its volume", () => {
    const stems = [
      { id: "s0", volume: 0.8, muted: false },
      { id: "s1", volume: 0.5, muted: true },
    ];
    const g = computeGains(stems as any);
    expect(g.s0).toBeCloseTo(0.8);
    expect(g.s1).toBe(0);
  });
});
