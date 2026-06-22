import React, { useEffect, useRef } from "react";
import * as Plot from "@observablehq/plot";
import type { Viz } from "../../../src/data/schema";

type Row = Array<string | number | boolean | null | unknown>;

export type PlotPlan =
  | { kind: "table" }
  | { kind: "hint"; message: string }
  | {
      kind: "plot";
      data: Record<string, unknown>[];
      markType: "bar" | "line" | "scatter";
      x: string;
      y: string;
      color?: string;
    };

/** Decide how to render a result for a given viz spec. Pure — unit-tested. */
export function vizToPlot(viz: Viz, columns: string[], rows: Row[]): PlotPlan {
  if (viz.type === "table") return { kind: "table" };
  if (!viz.x || !viz.y || !columns.includes(viz.x) || !columns.includes(viz.y)) {
    return { kind: "hint", message: "Pick x and y columns present in the result." };
  }
  const markType = viz.type; // bar | line | scatter
  const data = rows.map((r) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((c, i) => { obj[c] = r[i]; });
    return obj;
  });
  const plan: PlotPlan = { kind: "plot", data, markType, x: viz.x, y: viz.y };
  if (viz.color && columns.includes(viz.color)) (plan as Extract<PlotPlan, { kind: "plot" }>).color = viz.color;
  return plan;
}

function buildPlot(plan: Extract<PlotPlan, { kind: "plot" }>): HTMLElement | SVGSVGElement {
  const mark =
    plan.markType === "bar"
      ? Plot.barY(plan.data, { x: plan.x, y: plan.y, ...(plan.color ? { fill: plan.color } : {}) })
      : plan.markType === "line"
      ? Plot.line(plan.data, { x: plan.x, y: plan.y, ...(plan.color ? { stroke: plan.color } : {}) })
      : Plot.dot(plan.data, { x: plan.x, y: plan.y, ...(plan.color ? { stroke: plan.color } : {}) });
  return Plot.plot({
    marks: [mark],
    width: 640,
    height: 360,
    marginLeft: 60,
    marginBottom: 50,
    style: { background: "transparent", color: "currentColor" },
  });
}

export const ChartView: React.FC<{ viz: Viz; columns: string[]; rows: Row[] }> = ({ viz, columns, rows }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const plan = vizToPlot(viz, columns, rows);
  useEffect(() => {
    if (plan.kind !== "plot" || !ref.current) return;
    const node = buildPlot(plan);
    ref.current.innerHTML = "";
    ref.current.append(node);
    return () => { if (ref.current) ref.current.innerHTML = ""; };
  }, [JSON.stringify(plan)]);
  if (plan.kind === "table") return <div className="text-sm text-muted-foreground">Switch viz type to chart in the cell.</div>;
  if (plan.kind === "hint") return <div className="text-sm text-muted-foreground">{plan.message}</div>;
  return <div ref={ref} className="text-foreground" />;
};
