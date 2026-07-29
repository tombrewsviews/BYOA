import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
const save = vi.fn();
const open = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...a: unknown[]) => save(...a),
  open: (...a: unknown[]) => open(...a),
}));

import {
  exportBoardToFile,
  pickAndReadScene,
  readLiveScene,
  pushScene,
  slugify,
} from "../portable";

const URL = "http://127.0.0.1:3939";

beforeEach(() => {
  invoke.mockReset();
  save.mockReset();
  open.mockReset();
  vi.unstubAllGlobals();
});

const stubScene = (elements: unknown[], files: Record<string, unknown> = {}) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/api/elements")) return { ok: true, json: async () => ({ elements }) };
      if (url.endsWith("/api/files")) return { ok: true, json: async () => ({ files }) };
      throw new Error(`unexpected ${url}`);
    }),
  );

describe("slugify", () => {
  it("turns a board name into a safe filename stem", () => {
    expect(slugify("My Board")).toBe("my-board");
    expect(slugify("Q3 / Planning!")).toBe("q3-planning");
    expect(slugify("  spaced  ")).toBe("spaced");
    expect(slugify("already-fine")).toBe("already-fine");
  });

  it("falls back when the name has no usable characters", () => {
    expect(slugify("")).toBe("board");
    expect(slugify("///")).toBe("board");
  });
});

describe("readLiveScene", () => {
  it("reads elements and files from the canvas server", async () => {
    stubScene([{ id: "a" }], { f1: { id: "f1" } });
    const scene = await readLiveScene(URL);
    expect(scene.elements).toEqual([{ id: "a" }]);
    expect(scene.files.f1).toEqual({ id: "f1" });
  });

  it("throws when the canvas server can't be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    await expect(readLiveScene(URL)).rejects.toThrow(/canvas server/);
  });
});

describe("exportBoardToFile", () => {
  it("writes the live scene to the path the user picked", async () => {
    stubScene([{ id: "a" }]);
    save.mockResolvedValue("/tmp/my-board.excalidraw");
    invoke.mockResolvedValue(undefined);

    const path = await exportBoardToFile(URL, "my-board");

    expect(path).toBe("/tmp/my-board.excalidraw");
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "my-board.excalidraw" }),
    );
    expect(invoke).toHaveBeenCalledWith(
      "board_export_file",
      expect.objectContaining({
        path: "/tmp/my-board.excalidraw",
        elements: [{ id: "a" }],
      }),
    );
  });

  // Cancelling a save dialog is a normal action, not a failure — it must not
  // write a file or surface an error.
  it("writes nothing when the user cancels the save dialog", async () => {
    stubScene([{ id: "a" }]);
    save.mockResolvedValue(null);

    const path = await exportBoardToFile(URL, "my-board");

    expect(path).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("pickAndReadScene", () => {
  it("reads the file the user picked", async () => {
    open.mockResolvedValue("/tmp/in.excalidraw");
    invoke.mockResolvedValue({ elements: [{ id: "x" }], files: {} });

    const scene = await pickAndReadScene();

    expect(invoke).toHaveBeenCalledWith("board_import_file", { path: "/tmp/in.excalidraw" });
    expect(scene?.elements).toEqual([{ id: "x" }]);
  });

  it("returns null when the user cancels the picker", async () => {
    open.mockResolvedValue(null);
    expect(await pickAndReadScene()).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("takes the first path when the dialog returns a list", async () => {
    open.mockResolvedValue(["/tmp/first.excalidraw"]);
    invoke.mockResolvedValue({ elements: [], files: {} });
    await pickAndReadScene();
    expect(invoke).toHaveBeenCalledWith("board_import_file", { path: "/tmp/first.excalidraw" });
  });

  // Validation lives in Rust; the reason must reach the caller intact so the
  // UI can show the user why their file was rejected.
  it("propagates a rejection reason from the backend", async () => {
    open.mockResolvedValue("/tmp/bad.excalidraw");
    invoke.mockRejectedValue(new Error('not an Excalidraw scene: type is "figma"'));
    await expect(pickAndReadScene()).rejects.toThrow(/figma/);
  });
});

describe("pushScene", () => {
  it("pushes files before elements so image refs resolve", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return { ok: true, json: async () => ({}) };
      }),
    );

    await pushScene(URL, { elements: [{ id: "a" }], files: { f1: { id: "f1" } } });

    expect(calls).toEqual([`${URL}/api/files`, `${URL}/api/elements/sync`]);
  });

  it("skips the files POST when there are none", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return { ok: true, json: async () => ({}) };
      }),
    );

    await pushScene(URL, { elements: [], files: {} });

    expect(calls).toEqual([`${URL}/api/elements/sync`]);
  });
});
