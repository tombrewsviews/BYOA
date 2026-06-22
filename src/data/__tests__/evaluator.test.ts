import { describe, it, expect } from "vitest";
import { topoOrder, dirtySubgraph, upstreamIds, sqlTokenRefs } from "../evaluator";
import type { GraphDoc } from "../schema";

const doc: GraphDoc = {
  version: 2,
  nodes: [
    { id: "a", kind: "source", title: "A", ui: { x: 0, y: 0 } },
    { id: "b", kind: "sql", title: "B", sql: "SELECT * FROM {{a}}", ui: { x: 1, y: 0 } },
    { id: "c", kind: "chart", title: "C", ui: { x: 2, y: 0 } },
  ],
  edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
  selected: null,
};

describe("topoOrder", () => {
  it("orders dependencies before dependents", () => {
    expect(topoOrder(doc)).toEqual(["a", "b", "c"]);
  });
  it("throws on a cycle", () => {
    const cyclic: GraphDoc = { ...doc,
      edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }] };
    expect(() => topoOrder(cyclic)).toThrow(/cycle/i);
  });
});

describe("dirtySubgraph", () => {
  it("returns changed node + all downstream in topo order", () => {
    expect(dirtySubgraph(doc, "b")).toEqual(["b", "c"]);
  });
  it("a leaf change is just itself", () => {
    expect(dirtySubgraph(doc, "c")).toEqual(["c"]);
  });
  it("a root change is the whole chain", () => {
    expect(dirtySubgraph(doc, "a")).toEqual(["a", "b", "c"]);
  });
});

describe("upstreamIds", () => {
  it("returns direct upstreams", () => {
    expect(upstreamIds(doc, "b")).toEqual(["a"]);
    expect(upstreamIds(doc, "a")).toEqual([]);
  });
});

describe("sqlTokenRefs", () => {
  it("extracts {{id}} refs, de-duplicated, first-seen order", () => {
    expect(sqlTokenRefs("SELECT * FROM {{a}} JOIN {{b}} ON 1 JOIN {{a}} x"))
      .toEqual(["a", "b"]);
  });
  it("returns empty for plain sql", () => {
    expect(sqlTokenRefs("SELECT 1")).toEqual([]);
  });
});
