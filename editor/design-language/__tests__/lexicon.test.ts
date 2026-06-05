import { describe, it, expect } from "vitest";
import { parsePhrase, LEXICON } from "../lexicon";

describe("lexicon.parsePhrase", () => {
  it("maps a single known word to a delta", () => {
    const { deltas, unknownWords } = parsePhrase("warmer");
    expect(deltas).toEqual([{ temperature: 1 }]);
    expect(unknownWords).toEqual([]);
  });
  it("collects multiple known words (multi-axis words allowed)", () => {
    const { deltas } = parsePhrase("warmer and more editorial");
    expect(deltas.length).toBe(2);
  });
  it("captures unknown words, ignores filler", () => {
    const { deltas, unknownWords } = parsePhrase("make it feel like a ski resort");
    expect(deltas).toEqual([]);
    expect(unknownWords).toContain("ski");
    expect(unknownWords).not.toContain("a");
  });
  it("maps type words to scale/leading axes", () => {
    expect(parsePhrase("larger").deltas).toEqual([{ scale: 1 }]);
    expect(parsePhrase("looser").deltas).toEqual([{ leading: 1 }]);
    expect(parsePhrase("smaller").deltas).toEqual([{ scale: -1 }]);
  });
  it("every lexicon entry only touches valid axes", () => {
    const valid = new Set(["temperature","contrast","density","softness","character","weight","scale","leading"]);
    for (const word of Object.keys(LEXICON))
      for (const k of Object.keys(LEXICON[word])) expect(valid.has(k)).toBe(true);
  });
});
