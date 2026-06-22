import { describe, it, expect } from "vitest";
import { graphDocSchema, migrateToV2 } from "../schema";

const v2doc = {
  version: 2,
  nodes: [
    { id: "n1", kind: "source", title: "Reviews",
      source: { path: "data/r.csv", fileKind: "csv" }, ui: { x: 0, y: 0 } },
    { id: "n2", kind: "semantic", title: "Sentiment",
      semantic: { op: "classify", inputColumn: "body", outputColumn: "sent",
        instruction: "Classify sentiment.", labels: ["pos", "neg"], sampleLimit: 50 },
      ui: { x: 300, y: 0 } },
  ],
  edges: [{ from: "n1", to: "n2" }],
  selected: "n2",
};

describe("graphDocSchema", () => {
  it("parses a v2 graph", () => {
    const d = graphDocSchema.parse(v2doc);
    expect(d.nodes).toHaveLength(2);
    expect(d.nodes[1].semantic?.op).toBe("classify");
    expect(d.edges[0]).toEqual({ from: "n1", to: "n2" });
  });

  it("rejects an unknown node kind", () => {
    expect(() => graphDocSchema.parse({
      version: 2, nodes: [{ id: "x", kind: "frobnicate", title: "x", ui: { x: 0, y: 0 } }],
      edges: [], selected: null,
    })).toThrow();
  });

  it("rejects an unknown semantic op", () => {
    expect(() => graphDocSchema.parse({
      version: 2,
      nodes: [{ id: "x", kind: "semantic", title: "x", ui: { x: 0, y: 0 },
        semantic: { op: "translate", inputColumn: "a", outputColumn: "b",
          instruction: "", labels: [], sampleLimit: 10 } }],
      edges: [], selected: null,
    })).toThrow();
  });
});

describe("migrateToV2", () => {
  it("passes a v2 doc through unchanged", () => {
    expect(migrateToV2(v2doc).version).toBe(2);
    expect(migrateToV2(v2doc).nodes).toHaveLength(2);
  });

  it("lifts a v1 doc into source->sql->chart nodes", () => {
    const v1 = {
      version: 1,
      sources: [{ id: "sales", path: "data/s.csv", kind: "csv" }],
      cells: [{ id: "c1", title: "T", sql: "SELECT * FROM sales",
        viz: { type: "bar", x: "region", y: "total", color: null } }],
      activeCell: "c1",
    };
    const g = migrateToV2(v1);
    expect(g.version).toBe(2);
    const kinds = g.nodes.map((n) => n.kind).sort();
    expect(kinds).toEqual(["chart", "source", "sql"]);
    // there is at least one edge chain connecting them
    expect(g.edges.length).toBeGreaterThanOrEqual(2);
  });

  it("migrates an empty v1 doc to an empty graph", () => {
    const g = migrateToV2({ version: 1, sources: [], cells: [], activeCell: "" });
    expect(g.version).toBe(2);
    expect(g.nodes).toEqual([]);
  });
});
