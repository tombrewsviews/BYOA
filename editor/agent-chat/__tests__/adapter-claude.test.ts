import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claudeAdapter } from "../adapters/claude";
import type { ChatEvent } from "../events";

const fixture = (name: string): Uint8Array =>
  new TextEncoder().encode(
    readFileSync(join(__dirname, "..", "__fixtures__", name), "utf-8"),
  );

const collect = (bytes: Uint8Array): ChatEvent[] => {
  const events: ChatEvent[] = [];
  claudeAdapter.parseChunk(bytes, (e) => events.push(e));
  return events;
};

describe("claudeAdapter.spawnArgs", () => {
  it("returns claude with stream-json flags", () => {
    const s = claudeAdapter.spawnArgs({ cwd: "/x", skipPermissions: false });
    expect(s).not.toBeNull();
    expect(s!.cmd).toBe("claude");
    expect(s!.args).toContain("--output-format");
    expect(s!.args).toContain("stream-json");
    expect(s!.args).toContain("--verbose");
  });

  it("adds --dangerously-skip-permissions when requested", () => {
    const s = claudeAdapter.spawnArgs({ cwd: "/x", skipPermissions: true });
    expect(s!.args).toContain("--dangerously-skip-permissions");
  });
});

describe("claudeAdapter.parseChunk — prose", () => {
  it("emits turn-start, message-delta, turn-end", () => {
    const events = collect(fixture("claude-prose.jsonl"));
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("turn-start");
    expect(kinds).toContain("message-delta");
    expect(kinds).toContain("turn-end");
    const deltas = events
      .filter((e) => e.kind === "message-delta")
      .map((e) => (e as { text: string }).text);
    expect(deltas.join("")).toContain("Hello");
  });

  it("handles chunks split across newlines", () => {
    const full = fixture("claude-prose.jsonl");
    const a = full.slice(0, 40);
    const b = full.slice(40);
    const events: ChatEvent[] = [];
    claudeAdapter.parseChunk(a, (e) => events.push(e));
    claudeAdapter.parseChunk(b, (e) => events.push(e));
    expect(events.some((e) => e.kind === "turn-end")).toBe(true);
  });
});
