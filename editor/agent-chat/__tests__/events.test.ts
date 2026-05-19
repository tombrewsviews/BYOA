import { describe, it, expect } from "vitest";
import type { ChatEvent } from "../events";
import {
  isMessageDelta,
  isToolCall,
  isPermissionRequest,
  isTurnStart,
  isError,
} from "../events";

describe("ChatEvent guards", () => {
  it("isMessageDelta narrows correctly", () => {
    const e: ChatEvent = {
      kind: "message-delta",
      turnId: "t1",
      text: "hi",
    };
    expect(isMessageDelta(e)).toBe(true);
    if (isMessageDelta(e)) {
      expect(e.text).toBe("hi");
    }
  });

  it("isToolCall returns false for other kinds", () => {
    const e: ChatEvent = {
      kind: "message-delta",
      turnId: "t1",
      text: "hi",
    };
    expect(isToolCall(e)).toBe(false);
  });

  it("isPermissionRequest narrows tool/args/scope", () => {
    const e: ChatEvent = {
      kind: "permission-request",
      promptId: "p1",
      tool: "Edit",
      args: { path: "/x" },
      scope: "file",
    };
    expect(isPermissionRequest(e)).toBe(true);
  });

  it("isTurnStart narrows to turn-start shape", () => {
    const e: ChatEvent = { kind: "turn-start", turnId: "t1", startedAt: 1000 };
    expect(isTurnStart(e)).toBe(true);
    if (isTurnStart(e)) {
      expect(e.startedAt).toBe(1000);
    }
  });

  it("isError narrows to error shape with optional turnId", () => {
    const e: ChatEvent = {
      kind: "error",
      message: "spawn failed",
      recoverable: false,
    };
    expect(isError(e)).toBe(true);
    if (isError(e)) {
      expect(e.turnId).toBeUndefined();
      expect(e.recoverable).toBe(false);
    }
  });
});
