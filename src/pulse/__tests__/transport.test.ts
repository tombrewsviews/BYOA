// src/pulse/__tests__/transport.test.ts
import { describe, it, expect, vi } from "vitest";
import { makeTransport } from "../transport";

describe("makeTransport", () => {
  it("exposes a PlayerRef-shaped API and maps time<->frame at 60fps", () => {
    const t = makeTransport({ durationSec: 10, fps: 60, getTime: () => 2 });
    expect(t.getCurrentFrame()).toBe(120);
    expect(typeof t.play).toBe("function");
    expect(typeof t.pause).toBe("function");
    expect(typeof t.seekTo).toBe("function");
    expect(typeof t.isPlaying).toBe("function");
  });
  it("seekTo(frame) calls the seek callback with seconds", () => {
    const seek = vi.fn();
    const t = makeTransport({ durationSec: 10, fps: 60, getTime: () => 0, onSeek: seek });
    t.seekTo(180);
    expect(seek).toHaveBeenCalledWith(3);
  });
});
