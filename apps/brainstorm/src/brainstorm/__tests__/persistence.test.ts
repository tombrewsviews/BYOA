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

  // The canvas server is shared across boards for the life of the app, so an
  // empty board must still SYNC (clearing the previous board's scene) rather
  // than no-op. Otherwise switching boards leaves the old drawing on screen and
  // autosave writes it into the empty board's board.json.
  it("syncs an empty scene so a previous board's elements are cleared", async () => {
    invoke.mockResolvedValue(
      JSON.stringify({ type: "excalidraw", version: 2, elements: [], files: {} }),
    );
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: string }) => {
        if (url.endsWith("/api/elements/sync"))
          bodies.push(JSON.parse(init?.body ?? "{}"));
        return { ok: true, json: async () => ({}) };
      }),
    );

    await restoreBoard(URL, true);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].elements).toEqual([]);
  });

  it("syncs an empty scene when there's no saved board file", async () => {
    invoke.mockRejectedValue(new Error("no doc"));
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return { ok: true, json: async () => ({}) };
      }),
    );
    await restoreBoard(URL, true);
    // No files to push, but the element sync still runs to clear the canvas.
    expect(calls).toEqual([`${URL}/api/elements/sync`]);
  });

  it("is a no-op outside Tauri", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await restoreBoard(URL, false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
