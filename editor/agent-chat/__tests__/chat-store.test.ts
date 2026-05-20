import { describe, it, expect } from "vitest";
import { createChatStore, type TurnItem } from "../ChatStore";
import type { ChatEvent } from "../events";

const apply = (events: ChatEvent[]) => {
  const store = createChatStore();
  for (const e of events) store.applyEvent(e);
  return store.getState();
};

/** Concatenate all text items of a turn (order-preserving). */
const textOf = (items: TurnItem[]): string =>
  items
    .filter((i): i is Extract<TurnItem, { type: "text" }> => i.type === "text")
    .map((i) => i.text)
    .join("");

/** The tool-call records of a turn, in order. */
const toolsOf = (items: TurnItem[]) =>
  items
    .filter((i): i is Extract<TurnItem, { type: "tool" }> => i.type === "tool")
    .map((i) => i.call);

describe("ChatStore", () => {
  it("accumulates message-delta of the same msgId into one text item", () => {
    const s = apply([
      { kind: "turn-start", turnId: "t1", startedAt: 0 },
      { kind: "message-delta", turnId: "t1", msgId: "m1", text: "Hel" },
      { kind: "message-delta", turnId: "t1", msgId: "m1", text: "lo" },
      { kind: "turn-end", turnId: "t1", endedAt: 1 },
    ]);
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0].items).toHaveLength(1);
    expect(textOf(s.turns[0].items)).toBe("Hello");
    expect(s.turns[0].status).toBe("ended");
  });

  it("records tool calls and pairs them with results by callId", () => {
    const s = apply([
      { kind: "turn-start", turnId: "t1", startedAt: 0 },
      {
        kind: "tool-call",
        turnId: "t1",
        callId: "c1",
        name: "Read",
        input: { file_path: "/x" },
      },
      { kind: "tool-result", callId: "c1", ok: true, output: "data" },
      { kind: "turn-end", turnId: "t1", endedAt: 1 },
    ]);
    const tools = toolsOf(s.turns[0].items);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("Read");
    expect(tools[0].result?.ok).toBe(true);
  });

  it("preserves text↔tool interleaving order within a turn", () => {
    // The bug this guards against: tools were bucketed above all text.
    // Here the agent writes text, calls a tool, then writes more text
    // (under a NEW message id, as Claude does). The transcript must read
    // text → tool → text, not tool → text → text.
    const s = apply([
      { kind: "turn-start", turnId: "t1", startedAt: 0 },
      { kind: "message-delta", turnId: "t1", msgId: "m1", text: "Let me read it." },
      {
        kind: "tool-call",
        turnId: "t1",
        callId: "c1",
        name: "Read",
        input: { file_path: "/x" },
      },
      { kind: "tool-result", callId: "c1", ok: true, output: "data" },
      { kind: "message-delta", turnId: "t1", msgId: "m2", text: "Found it." },
      { kind: "turn-end", turnId: "t1", endedAt: 1 },
    ]);
    const items = s.turns[0].items;
    expect(items.map((i) => i.type)).toEqual(["text", "tool", "text"]);
    expect(items[0]).toMatchObject({ type: "text", text: "Let me read it." });
    expect(items[1]).toMatchObject({ type: "tool" });
    expect(items[2]).toMatchObject({ type: "text", text: "Found it." });
    // The tool result still pairs correctly even though it sits mid-sequence.
    expect(toolsOf(items)[0].result?.ok).toBe(true);
  });

  it("tracks a single pending permission at a time", () => {
    const store = createChatStore();
    store.applyEvent({ kind: "turn-start", turnId: "t1", startedAt: 0 });
    store.applyEvent({
      kind: "permission-request",
      promptId: "p1",
      tool: "Edit",
      args: {},
      scope: "file",
    });
    expect(store.getState().pendingPermission?.promptId).toBe("p1");
    store.applyEvent({
      kind: "permission-decided",
      promptId: "p1",
      decision: "allow",
    });
    expect(store.getState().pendingPermission).toBeNull();
  });

  it("notifies subscribers on change", () => {
    const store = createChatStore();
    let count = 0;
    const unsub = store.subscribe(() => count++);
    store.applyEvent({ kind: "turn-start", turnId: "t1", startedAt: 0 });
    store.applyEvent({ kind: "message-delta", turnId: "t1", msgId: "m1", text: "x" });
    expect(count).toBe(2);
    unsub();
    store.applyEvent({ kind: "turn-end", turnId: "t1", endedAt: 1 });
    expect(count).toBe(2);
  });

  it("records session-level error when no turn is active", () => {
    const store = createChatStore();
    store.applyEvent({
      kind: "error",
      message: "spawn failed",
      recoverable: false,
    });
    const s = store.getState();
    expect(s.sessionError).toBe("spawn failed");
    expect(s.sessionAlive).toBe(false);
    expect(s.turns).toHaveLength(0);
  });

  it("ignores duplicate turn-start with the same turnId", () => {
    const store = createChatStore();
    store.applyEvent({ kind: "turn-start", turnId: "t1", startedAt: 0 });
    store.applyEvent({ kind: "message-delta", turnId: "t1", msgId: "m1", text: "first" });
    // A duplicate turn-start should NOT create a second turn or
    // overwrite the accumulated text.
    store.applyEvent({ kind: "turn-start", turnId: "t1", startedAt: 5 });
    store.applyEvent({ kind: "message-delta", turnId: "t1", msgId: "m1", text: " more" });
    const s = store.getState();
    expect(s.turns).toHaveLength(1);
    expect(textOf(s.turns[0].items)).toBe("first more");
    // Original startedAt preserved:
    expect(s.turns[0].startedAt).toBe(0);
  });

  it("tracks a pending question and clears it on the next turn", () => {
    const store = createChatStore();
    store.applyEvent({ kind: "turn-start", turnId: "t1", startedAt: 0 });
    store.applyEvent({
      kind: "question",
      turnId: "t1",
      callId: "c1",
      questions: [
        {
          question: "Tea or coffee?",
          header: "Beverage",
          options: [{ label: "Tea" }, { label: "Coffee" }],
        },
      ],
    });
    expect(store.getState().pendingQuestion?.callId).toBe("c1");
    expect(store.getState().pendingQuestion?.questions[0].options).toHaveLength(
      2,
    );
    // Answering = a new turn; the question is superseded.
    store.applyEvent({ kind: "turn-start", turnId: "t2", startedAt: 1 });
    expect(store.getState().pendingQuestion).toBeNull();
  });
});
