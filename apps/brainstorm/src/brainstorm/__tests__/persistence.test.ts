import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Tauri core so save_doc/load_doc hit in-memory stubs.
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { saveBoard, restoreBoard } from "../persistence";

const URL = "http://127.0.0.1:3939";

beforeEach(() => {
  invoke.mockReset();
  vi.unstubAllGlobals();
});

describe("brainstorm persistence — saveBoard", () => {
  it("reads live elements + files and writes them to board.json", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/elements"))
          return { ok: true, json: async () => ({ elements: [{ id: "a" }] }) };
        if (url.endsWith("/api/files"))
          return {
            ok: true,
            json: async () => ({ files: { f1: { id: "f1", dataURL: "data:," } } }),
          };
        throw new Error(`unexpected ${url}`);
      }),
    );
    invoke.mockResolvedValue(undefined);

    const ok = await saveBoard(URL, true);
    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("save_doc", expect.objectContaining({ json: expect.any(String) }));
    const written = JSON.parse(invoke.mock.calls[0][1].json);
    expect(written.elements).toEqual([{ id: "a" }]);
    expect(written.files.f1.id).toBe("f1");
    expect(written.source).toBe("brainstorm-canvas");
  });

  it("is a no-op outside Tauri", async () => {
    expect(await saveBoard(URL, false)).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("brainstorm persistence — restoreBoard", () => {
  it("pushes files first, then syncs elements", async () => {
    invoke.mockResolvedValue(
      JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "brainstorm-canvas",
        elements: [{ id: "x" }],
        files: { f1: { id: "f1", dataURL: "data:," } },
        savedAt: 1,
      }),
    );
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return { ok: true, json: async () => ({}) };
      }),
    );

    await restoreBoard(URL, true);
    // Files endpoint hit before the element-sync endpoint.
    expect(calls).toEqual([`${URL}/api/files`, `${URL}/api/elements/sync`]);
  });

  it("no-ops when the saved board is empty", async () => {
    invoke.mockResolvedValue(
      JSON.stringify({ type: "excalidraw", version: 2, elements: [], files: {} }),
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await restoreBoard(URL, true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("no-ops when there's no saved board file", async () => {
    invoke.mockRejectedValue(new Error("no doc"));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await restoreBoard(URL, true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
