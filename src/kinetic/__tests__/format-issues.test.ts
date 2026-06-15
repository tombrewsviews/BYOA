import { describe, it, expect } from "vitest";
import { storySchema, formatStoryIssues } from "../schema";

/**
 * `formatStoryIssues` is the human-readable layer over Zod errors used by
 * both the editor's external-reload handler and the kinetic CLI's write
 * guard. The regression it prevents: an invalid `exitKind` (or any enum)
 * landing on disk and surfacing as a cryptic toast instead of a line that
 * names the field and the allowed values.
 */
describe("formatStoryIssues", () => {
  const parseBad = (mutate: (raw: any) => void) => {
    const raw: any = { beats: [{ text: "hi" }, { text: "there" }] };
    mutate(raw);
    const r = storySchema.safeParse(raw);
    expect(r.success).toBe(false);
    return { error: (r as { error: unknown }).error, raw };
  };

  it("names the field path and lists allowed enum values for a bad exitKind", () => {
    const { error, raw } = parseBad((r) => {
      r.beats[1].exitKind = "slide";
    });
    const msg = formatStoryIssues(error, raw);
    expect(msg).toContain("beats[1].exitKind");
    expect(msg).toContain("none, rotate, drop, scatter, blur, echo, morphOut, zoom");
  });

  it("echoes the offending value when the original data is passed", () => {
    const { error, raw } = parseBad((r) => {
      r.beats[0].kind = "wiggle";
    });
    expect(formatStoryIssues(error, raw)).toContain('"wiggle" is not valid');
  });

  it("still produces a message without the original data", () => {
    const { error } = parseBad((r) => {
      r.beats[0].exitKind = "slide";
    });
    const msg = formatStoryIssues(error);
    expect(msg).toContain("beats[0].exitKind");
    expect(msg).toContain("none, rotate, drop");
  });

  it("falls back to the message for non-enum failures (missing required text)", () => {
    const r = storySchema.safeParse({ beats: [{ kind: "reveal" }] });
    expect(r.success).toBe(false);
    const msg = formatStoryIssues((r as { error: unknown }).error, { beats: [{ kind: "reveal" }] });
    expect(msg).toContain("beats[0].text");
  });

  it("passes through plain Errors and non-Zod values unchanged", () => {
    expect(formatStoryIssues(new Error("boom"))).toBe("boom");
    expect(formatStoryIssues("just a string")).toBe("just a string");
  });
});
