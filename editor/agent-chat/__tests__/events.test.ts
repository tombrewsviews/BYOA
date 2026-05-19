import { describe, it, expect } from "vitest";
import type { ChatEvent } from "../events";
import { isMessageDelta, isToolCall, isPermissionRequest } from "../events";

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
});
