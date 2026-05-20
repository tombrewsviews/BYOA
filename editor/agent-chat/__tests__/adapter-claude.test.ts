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
  isQuestion,
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

describe("claudeAdapter.turnSpawnArgs", () => {
  const base = {
    cwd: "/x",
    permissionMode: "full" as const,
    prompt: "hello",
    sessionId: "sess-uuid",
  };

  it("returns claude -p with stream-json flags and the prompt last", () => {
    const s = claudeAdapter.turnSpawnArgs({ ...base, isFirstTurn: true });
    expect(s).not.toBeNull();
    expect(s!.cmd).toBe("claude");
    expect(s!.args).toContain("-p");
    expect(s!.args).toContain("--output-format");
    expect(s!.args).toContain("stream-json");
    expect(s!.args).toContain("--verbose");
    // Prompt is the final positional argument.
    expect(s!.args[s!.args.length - 1]).toBe("hello");
  });

  it("uses --session-id on the first turn", () => {
    const s = claudeAdapter.turnSpawnArgs({ ...base, isFirstTurn: true });
    expect(s!.args).toContain("--session-id");
    expect(s!.args).toContain("sess-uuid");
    expect(s!.args).not.toContain("--resume");
  });

  it("uses --resume on subsequent turns", () => {
    const s = claudeAdapter.turnSpawnArgs({ ...base, isFirstTurn: false });
    expect(s!.args).toContain("--resume");
    expect(s!.args).toContain("sess-uuid");
    expect(s!.args).not.toContain("--session-id");
  });

  it("maps permissionMode to the right claude --permission-mode value", () => {
    const cases: Array<[("full" | "plan"), string]> = [
      ["full", "bypassPermissions"],
      ["plan", "plan"],
    ];
    for (const [mode, cli] of cases) {
      const s = claudeAdapter.turnSpawnArgs({
        ...base,
        isFirstTurn: true,
        permissionMode: mode,
      });
      expect(s!.args).toContain("--permission-mode");
      expect(s!.args).toContain(cli);
    }
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

describe("claudeAdapter.parseChunk — AskUserQuestion", () => {
  it("emits a question event with parsed options, not a tool-call", () => {
    const line =
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_q",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_q",
              name: "AskUserQuestion",
              input: {
                questions: [
                  {
                    question: "Tea or coffee?",
                    header: "Beverage",
                    multiSelect: false,
                    options: [
                      { label: "Tea", description: "A cup of tea" },
                      { label: "Coffee", description: "A cup of coffee" },
                    ],
                  },
                ],
              },
            },
          ],
        },
      }) + "\n";
    const events = collect(new TextEncoder().encode(line));
    const q = events.find(isQuestion);
    expect(q).toBeDefined();
    expect(q!.callId).toBe("toolu_q");
    expect(q!.questions[0].question).toBe("Tea or coffee?");
    expect(q!.questions[0].options.map((o) => o.label)).toEqual([
      "Tea",
      "Coffee",
    ]);
    // It should NOT also appear as a generic tool-call.
    expect(events.find(isToolCall)).toBeUndefined();
  });

  it("falls back to a tool-call if the input isn't shaped like questions", () => {
    const line =
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_q2",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_q2",
              name: "AskUserQuestion",
              input: { garbage: true },
            },
          ],
        },
      }) + "\n";
    const events = collect(new TextEncoder().encode(line));
    expect(events.find(isQuestion)).toBeUndefined();
    expect(events.find(isToolCall)).toBeDefined();
  });
});
