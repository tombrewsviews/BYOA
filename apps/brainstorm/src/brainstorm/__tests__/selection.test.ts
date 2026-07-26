import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchSelectedElements,
  formatSelectionBlock,
  summarizeSelectionForChip,
} from "../selection";

const URL = "http://127.0.0.1:3939";

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("brainstorm selection — fetchSelectedElements", () => {
  it("returns [] when nothing is selected (no elements fetch needed)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/selection")) {
        return { ok: true, json: async () => ({ elementIds: [] }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSelectedElements(URL);
    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetches and filters elements to the selected ids", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/selection")) {
          return { ok: true, json: async () => ({ elementIds: ["b"] }) };
        }
        if (url.endsWith("/api/elements")) {
          return {
            ok: true,
            json: async () => ({
              elements: [
                { id: "a", type: "rectangle", x: 0, y: 0 },
                { id: "b", type: "text", x: 10, y: 20, text: "hello" },
              ],
            }),
          };
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const result = await fetchSelectedElements(URL);
    expect(result).toEqual([
      { id: "b", type: "text", x: 10, y: 20, width: undefined, height: undefined, text: "hello" },
    ]);
  });

  it("returns [] when the selection fetch fails (best-effort, never throws)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
    await expect(fetchSelectedElements(URL)).resolves.toEqual([]);
  });

  it("returns [] when the canvas server is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );
    await expect(fetchSelectedElements(URL)).resolves.toEqual([]);
  });

  it("reads an API-created element's label.text when present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/selection")) {
          return { ok: true, json: async () => ({ elementIds: ["r1"] }) };
        }
        return {
          ok: true,
          json: async () => ({
            elements: [
              { id: "r1", type: "rectangle", x: 0, y: 0, width: 100, height: 50, label: { text: "Login" } },
            ],
          }),
        };
      }),
    );
    const result = await fetchSelectedElements(URL);
    expect(result[0].text).toBe("Login");
  });

  // Once the board syncs back from Excalidraw, a shape's label is NOT a
  // `label` property — it's a separate text element pointing at the shape via
  // `containerId`. Selecting the shape selects only the container, so the
  // label has to be resolved from the whole board or the agent sees an
  // unlabelled rectangle.
  it("resolves a shape's label from its bound text element (containerId)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/selection")) {
          return { ok: true, json: async () => ({ elementIds: ["rect1"] }) };
        }
        return {
          ok: true,
          json: async () => ({
            elements: [
              { id: "rect1", type: "rectangle", x: 220, y: 260, width: 180, height: 80 },
              { id: "txt1", type: "text", x: 240, y: 290, text: "API / backend", containerId: "rect1" },
            ],
          }),
        };
      }),
    );
    const result = await fetchSelectedElements(URL);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("rect1");
    expect(result[0].text).toBe("API / backend");
  });

  it("does not list a bound label separately when its container is also selected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/selection")) {
          // Excalidraw can report both the container and its label child.
          return { ok: true, json: async () => ({ elementIds: ["rect1", "txt1"] }) };
        }
        return {
          ok: true,
          json: async () => ({
            elements: [
              { id: "rect1", type: "rectangle", x: 0, y: 0, width: 180, height: 80 },
              { id: "txt1", type: "text", x: 10, y: 10, text: "DB", containerId: "rect1" },
            ],
          }),
        };
      }),
    );
    const result = await fetchSelectedElements(URL);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("rect1");
    expect(result[0].text).toBe("DB");
  });

  it("keeps a standalone text element (no container) as its own entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/selection")) {
          return { ok: true, json: async () => ({ elementIds: ["note1"] }) };
        }
        return {
          ok: true,
          json: async () => ({
            elements: [
              { id: "note1", type: "text", x: 5, y: 6, text: "owns all business logic" },
            ],
          }),
        };
      }),
    );
    const result = await fetchSelectedElements(URL);
    expect(result).toEqual([
      {
        id: "note1",
        type: "text",
        x: 5,
        y: 6,
        width: undefined,
        height: undefined,
        text: "owns all business logic",
      },
    ]);
  });
});

describe("brainstorm selection — formatSelectionBlock", () => {
  it("returns empty string for no elements", () => {
    expect(formatSelectionBlock([])).toBe("");
  });

  it("formats a single element with size and label", () => {
    const block = formatSelectionBlock([
      { id: "abc123", type: "rectangle", x: 100, y: 80, width: 200, height: 100, text: "Login flow" },
    ]);
    expect(block).toBe(
      '[selected on board]\n1. rectangle (id: abc123) at (100, 80), 200×100 — "Login flow"',
    );
  });

  it("formats multiple elements, omitting size/label when absent", () => {
    const block = formatSelectionBlock([
      { id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10 },
      { id: "b", type: "text", x: 5, y: 5, text: "hi" },
    ]);
    expect(block).toBe(
      "[selected on board]\n1. rectangle (id: a) at (0, 0), 10×10\n2. text (id: b) at (5, 5) — \"hi\"",
    );
  });
});

describe("brainstorm selection — summarizeSelectionForChip", () => {
  it("returns empty string for no elements", () => {
    expect(summarizeSelectionForChip([])).toBe("");
  });

  it("summarizes up to 3 elements by label or type", () => {
    const chip = summarizeSelectionForChip([
      { id: "a", type: "rectangle", x: 0, y: 0, text: "Login flow" },
      { id: "b", type: "rectangle", x: 0, y: 0 },
      { id: "c", type: "arrow", x: 0, y: 0 },
    ]);
    expect(chip).toBe('3 selected: "Login flow", rectangle, arrow');
  });

  it("truncates beyond 3 with a +N more suffix", () => {
    const chip = summarizeSelectionForChip([
      { id: "a", type: "rectangle", x: 0, y: 0 },
      { id: "b", type: "rectangle", x: 0, y: 0 },
      { id: "c", type: "rectangle", x: 0, y: 0 },
      { id: "d", type: "rectangle", x: 0, y: 0 },
      { id: "e", type: "rectangle", x: 0, y: 0 },
    ]);
    expect(chip).toBe("5 selected: rectangle, rectangle, rectangle +2 more");
  });
});
