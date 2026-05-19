import { describe, it, expect } from "vitest";
import { createChatStore } from "../ChatStore";
import type { ChatEvent } from "../events";

const apply = (events: ChatEvent[]) => {
  const store = createChatStore();
  for (const e of events) store.applyEvent(e);
  return store.getState();
};

describe("ChatStore", () => {
  it("accumulates message-delta into the current assistant bubble", () => {
    const s = apply([
      { kind: "turn-start", turnId: "t1", startedAt: 0 },
      { kind: "message-delta", turnId: "t1", text: "Hel" },
      { kind: "message-delta", turnId: "t1", text: "lo" },
      { kind: "turn-end", turnId: "t1", endedAt: 1 },
    ]);
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0].assistantText).toBe("Hello");
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
    expect(s.turns[0].toolCalls).toHaveLength(1);
    expect(s.turns[0].toolCalls[0].name).toBe("Read");
    expect(s.turns[0].toolCalls[0].result?.ok).toBe(true);
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
    store.applyEvent({ kind: "message-delta", turnId: "t1", text: "x" });
    expect(count).toBe(2);
    unsub();
    store.applyEvent({ kind: "turn-end", turnId: "t1", endedAt: 1 });
    expect(count).toBe(2);
  });

  it("ignores duplicate turn-start with the same turnId", () => {
    const store = createChatStore();
    store.applyEvent({ kind: "turn-start", turnId: "t1", startedAt: 0 });
    store.applyEvent({ kind: "message-delta", turnId: "t1", text: "first" });
    // A duplicate turn-start should NOT create a second turn or
    // overwrite the accumulated text.
    store.applyEvent({ kind: "turn-start", turnId: "t1", startedAt: 5 });
    store.applyEvent({ kind: "message-delta", turnId: "t1", text: " more" });
    const s = store.getState();
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0].assistantText).toBe("first more");
    // Original startedAt preserved:
    expect(s.turns[0].startedAt).toBe(0);
  });
});
