import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  claudeAdapter,
  __resetClaudeAdapterStateForTesting,
} from "../adapters/claude";
import type { ChatEvent } from "../events";
import {
  isToolCall,
  isToolResult,
  isPermissionRequest,
  isPermissionDecided,
  isError,
  isMessageDelta,
  isTurnStart,
  isTurnEnd,
} from "../events";

beforeEach(() => {
  __resetClaudeAdapterStateForTesting();
});

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
    const deltas: string[] = [];
    for (const e of events) {
      if (e.kind === "message-delta") deltas.push(e.text);
    }
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

describe("claudeAdapter.parseChunk — tool calls", () => {
  it("emits tool-call with name + input, then tool-result", () => {
    const events = collect(fixture("claude-tool-call.jsonl"));

    const call = events.find(isToolCall);
    expect(call).toBeDefined();
    expect(call!.name).toBe("Read");
    expect((call!.input as { file_path: string }).file_path).toBe(
      "/x/story.json",
    );

    const result = events.find(isToolResult);
    expect(result).toBeDefined();
    expect(result!.ok).toBe(true);
  });
});

describe("claudeAdapter.parseChunk — permissions", () => {
  it("emits permission-request and permission-decided for allow flow", () => {
    const events = collect(fixture("claude-permission-allow.jsonl"));
    const req = events.find(isPermissionRequest);
    expect(req).toBeDefined();
    expect(req!.tool).toBe("Edit");
    const decided = events.find(isPermissionDecided);
    expect(decided).toBeDefined();
    expect(decided!.decision).toBe("allow");
  });

  it("emits permission-decided=deny for deny flow", () => {
    const events = collect(fixture("claude-permission-deny.jsonl"));
    const decided = events.find(isPermissionDecided);
    expect(decided).toBeDefined();
    expect(decided!.decision).toBe("deny");
  });
});

describe("claudeAdapter.encodePermissionDecision", () => {
  it("returns 'y' for allow", () => {
    const bytes = claudeAdapter.encodePermissionDecision("p", "allow");
    expect(new TextDecoder().decode(bytes!)).toBe("y\n");
  });
  it("returns 'n' for deny", () => {
    const bytes = claudeAdapter.encodePermissionDecision("p", "deny");
    expect(new TextDecoder().decode(bytes!)).toBe("n\n");
  });
  it("returns 'a' for allow-always", () => {
    const bytes = claudeAdapter.encodePermissionDecision("p", "allow-always");
    expect(new TextDecoder().decode(bytes!)).toBe("a\n");
  });
});

describe("claudeAdapter.parseChunk — error recovery", () => {
  it("emits recoverable error on invalid JSON line, keeps parsing", () => {
    const events = collect(fixture("claude-error.jsonl"));
    const err = events.find(isError);
    expect(err).toBeDefined();
    expect(err!.recoverable).toBe(true);

    // The bad line sits between two valid assistant lines with DIFFERENT
    // message ids, so each produces its own complete delta. Verify the
    // line AFTER the bad one is parsed (proves recovery, not just
    // first-line success).
    const deltas = events.filter(isMessageDelta);
    expect(deltas.length).toBe(2);
    expect(deltas[0].text).toBe("trying");
    expect(deltas[1].text).toBe("trying again");
  });
});

describe("claudeAdapter.parseChunk — multi-turn", () => {
  it("produces two turn-start / turn-end pairs", () => {
    const events = collect(fixture("claude-multiturn.jsonl"));
    const starts = events.filter(isTurnStart);
    const ends = events.filter(isTurnEnd);
    expect(starts.length).toBe(2);
    expect(ends.length).toBe(2);
    expect(starts[0].turnId).not.toBe(starts[1].turnId);
  });
});
