import { describe, it, expect } from "vitest";
import { queryDocSchema } from "../schema";

describe("queryDocSchema", () => {
  it("parses the seed document shape", () => {
    const doc = queryDocSchema.parse({
      version: 1,
      sources: [],
      cells: [
        { id: "c1", title: "Untitled query", sql: "SELECT 1 AS hello",
          viz: { type: "table", x: null, y: null, color: null } },
      ],
      activeCell: "c1",
    });
    expect(doc.cells[0].sql).toBe("SELECT 1 AS hello");
    expect(doc.cells[0].viz.type).toBe("table");
  });

  it("rejects an unknown viz type", () => {
    expect(() =>
      queryDocSchema.parse({
        version: 1,
        sources: [],
        cells: [{ id: "c1", title: "x", sql: "SELECT 1",
          viz: { type: "pie", x: null, y: null, color: null } }],
        activeCell: "c1",
      }),
    ).toThrow();
  });

  it("rejects an unknown source kind", () => {
    expect(() =>
      queryDocSchema.parse({
        version: 1,
        sources: [{ id: "s", path: "a.xlsx", kind: "excel" }],
        cells: [],
        activeCell: "",
      }),
    ).toThrow();
  });
});
