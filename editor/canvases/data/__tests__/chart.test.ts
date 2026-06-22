import { describe, it, expect } from "vitest";
import { vizToPlot } from "../Chart";

const cols = ["region", "total"];
const rows = [["west", 10], ["east", 20]];

describe("vizToPlot", () => {
  it("returns table kind for table viz", () => {
    const r = vizToPlot({ type: "table", x: null, y: null, color: null }, cols, rows);
    expect(r.kind).toBe("table");
  });

  it("maps a bar viz to plot data keyed by column name", () => {
    const r = vizToPlot({ type: "bar", x: "region", y: "total", color: null }, cols, rows);
    expect(r.kind).toBe("plot");
    if (r.kind === "plot") {
      expect(r.markType).toBe("bar");
      expect(r.x).toBe("region");
      expect(r.y).toBe("total");
      expect(r.data[0]).toEqual({ region: "west", total: 10 });
    }
  });

  it("returns a hint when x/y columns are missing from the result", () => {
    const r = vizToPlot({ type: "bar", x: "missing", y: "total", color: null }, cols, rows);
    expect(r.kind).toBe("hint");
  });
});
