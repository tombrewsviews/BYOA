import React from "react";
import type { Viz } from "../../../src/data/schema";
export const ChartView: React.FC<{ viz: Viz; columns: string[]; rows: Array<Array<unknown>> }> = () =>
  <div className="text-sm text-muted-foreground">Chart coming in the next step.</div>;
