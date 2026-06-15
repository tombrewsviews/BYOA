// src/pulse/__tests__/schema.test.ts
import { describe, it, expect } from "vitest";
import { pulseProjectSchema, seedProject, type PulseProject } from "../schema";

describe("pulseProjectSchema", () => {
  it("accepts a seed project and round-trips through JSON", () => {
    const seed = seedProject("/songs/demo");
    const json = JSON.stringify(seed);
    const parsed = pulseProjectSchema.parse(JSON.parse(json));
    expect(parsed.version).toBe(1);
    expect(parsed.song.sourceFolder).toBe("/songs/demo");
    expect(parsed.decks.A.effects).toEqual([]);
    expect(parsed.decks.B.effects).toEqual([]);
    expect(parsed.mix.active).toBe("A");
  });

  it("rejects an out-of-range stem volume", () => {
    const seed = seedProject("/x") as PulseProject;
    const bad = { ...seed, stems: [{ id: "s0", file: "stem-00.wav", label: "S0", role: "unknown", volume: 5, muted: false }] };
    expect(() => pulseProjectSchema.parse(bad)).toThrow();
  });
});
