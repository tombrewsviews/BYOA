import { describe, it, expect } from "vitest";
import { hashElements, detectMentions } from "../watch";

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

describe("brainstorm watch — @agent detection", () => {
  const textEl = (id: string, text: string, version = 1) => ({
    id,
    type: "text",
    text,
    version,
    versionNonce: version * 7,
  });

  it("detects a text element with a leading @agent prefix and strips it", () => {
    const m = detectMentions([textEl("a", "@agent add a pricing node")]);
    expect(m).toHaveLength(1);
    expect(m[0].id).toBe("a");
    expect(m[0].version).toBe(1);
    expect(m[0].text).toBe("@agent add a pricing node");
    expect(m[0].instruction).toBe("add a pricing node");
  });

  it("is case-insensitive on the @agent trigger", () => {
    expect(detectMentions([textEl("a", "@Agent hi")])).toHaveLength(1);
    expect(detectMentions([textEl("b", "@AGENT hi")])).toHaveLength(1);
  });

  it("detects @agent mid-sentence and keeps the instruction verbatim", () => {
    const m = detectMentions([textEl("a", "hey @agent can you group these")]);
    expect(m).toHaveLength(1);
    expect(m[0].instruction).toBe("hey @agent can you group these");
  });

  it("ignores text elements without @agent", () => {
    expect(detectMentions([textEl("a", "just a note")])).toHaveLength(0);
  });

  it("ignores non-text elements even if a text-like field contains @agent", () => {
    expect(
      detectMentions([{ id: "a", type: "rectangle", text: "@agent", version: 1 }]),
    ).toHaveLength(0);
  });

  it("returns all matches when several @agent elements exist", () => {
    const m = detectMentions([
      textEl("a", "@agent one"),
      textEl("b", "plain"),
      textEl("c", "@agent two"),
    ]);
    expect(m.map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("handles an empty @agent (no instruction) without throwing", () => {
    const m = detectMentions([textEl("a", "@agent")]);
    expect(m).toHaveLength(1);
    expect(m[0].instruction).toBe("");
  });
});
