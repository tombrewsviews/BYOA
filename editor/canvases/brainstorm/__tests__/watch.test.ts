import { describe, it, expect } from "vitest";
import { hashElements, detectMentions, mentionSignature, filterUndispatched, buildMentionTurn, type Mention } from "../watch";

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

describe("brainstorm watch — send-once guard", () => {
  const m = (id: string, version: number): Mention => ({
    id,
    version,
    text: `@agent ${id}`,
    instruction: id,
  });

  it("signature combines id and version", () => {
    expect(mentionSignature(m("a", 3))).toBe("a:3");
  });

  it("filters out a mention already in the seen set", () => {
    const seen = new Set(["a:1"]);
    expect(filterUndispatched([m("a", 1)], seen)).toEqual([]);
  });

  it("keeps a mention whose version bumped (an edited tag retries)", () => {
    const seen = new Set(["a:1"]);
    const result = filterUndispatched([m("a", 2)], seen);
    expect(result).toHaveLength(1);
    expect(result[0].version).toBe(2);
  });

  it("does not mutate the seen set", () => {
    const seen = new Set(["a:1"]);
    filterUndispatched([m("b", 1)], seen);
    expect([...seen]).toEqual(["a:1"]);
  });

  it("keeps multiple fresh mentions", () => {
    const seen = new Set<string>();
    expect(filterUndispatched([m("a", 1), m("b", 1)], seen)).toHaveLength(2);
  });
});

describe("brainstorm watch — buildMentionTurn", () => {
  const m = (id: string, instruction: string): Mention => ({
    id,
    version: 1,
    text: `@agent ${instruction}`,
    instruction,
  });

  it("bubble lists the instructions one per line", () => {
    const { bubble } = buildMentionTurn([m("a", "add pricing"), m("b", "group risks")]);
    expect(bubble).toBe("add pricing\ngroup risks");
  });

  it("prompt cites each element id and tells the agent to delete them", () => {
    const { prompt } = buildMentionTurn([m("a", "add pricing")]);
    expect(prompt).toContain("add pricing");
    expect(prompt).toContain("a"); // the element id
    expect(prompt.toLowerCase()).toContain("delete_element");
    expect(prompt.toLowerCase()).toContain("describe_scene");
  });

  it("prompt enumerates multiple mentions with their ids", () => {
    const { prompt } = buildMentionTurn([m("a", "one"), m("b", "two")]);
    expect(prompt).toContain("id: a");
    expect(prompt).toContain("id: b");
  });
});
