import { describe, it, expect } from "vitest";
import { hashElements } from "../watch";

/**
 * The scene-hash is the dedup guard that (with the running-gate) prevents the
 * continuous-mode watch loop from re-waking the agent when nothing actually
 * changed — e.g. a pure pan/zoom, or edits that net back to the same scene.
 */
describe("brainstorm watch — scene hash", () => {
  const el = (id: string, version: number) => ({ id, version, versionNonce: version * 7 });

  it("is identical for the same elements (dedup: no spurious wake)", () => {
    const scene = [el("a", 1), el("b", 2)];
    expect(hashElements(scene)).toBe(hashElements([...scene]));
  });

  it("is order-independent (element array order is not a change)", () => {
    expect(hashElements([el("a", 1), el("b", 2)])).toBe(
      hashElements([el("b", 2), el("a", 1)]),
    );
  });

  it("changes when an element's version bumps (a real edit wakes the agent)", () => {
    expect(hashElements([el("a", 1)])).not.toBe(hashElements([el("a", 2)]));
  });

  it("changes when an element is added or removed", () => {
    const base = [el("a", 1)];
    expect(hashElements(base)).not.toBe(hashElements([...base, el("b", 1)]));
  });

  it("empty scene hashes to a stable empty value", () => {
    expect(hashElements([])).toBe("");
  });
});
