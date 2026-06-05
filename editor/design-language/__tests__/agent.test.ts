import { describe, it, expect } from "vitest";
import { validateDeltaResponse } from "../agent";

describe("agent delta validation", () => {
  it("accepts a well-formed delta and clamps to range", () => {
    expect(validateDeltaResponse('{"temperature": 5, "density": -1}'))
      .toEqual({ temperature: 3, density: -1 });
  });
  it("drops unknown axes", () => {
    expect(validateDeltaResponse('{"temperature": 1, "bogus": 9}'))
      .toEqual({ temperature: 1 });
  });
  it("returns null on non-JSON or empty", () => {
    expect(validateDeltaResponse("not json")).toBeNull();
    expect(validateDeltaResponse("{}")).toBeNull();
  });
});
