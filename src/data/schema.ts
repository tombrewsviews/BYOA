import { z } from "zod";

export const nodeKindSchema = z.enum(["source", "sql", "semantic", "chart"]);
export type NodeKind = z.infer<typeof nodeKindSchema>;

export const semanticOpSchema = z.enum(["filter", "classify", "extract", "label"]);
export type SemanticOp = z.infer<typeof semanticOpSchema>;

export const chartTypeSchema = z.enum(["table", "bar", "line", "scatter"]);
export type ChartType = z.infer<typeof chartTypeSchema>;

export const sourceSpecSchema = z.object({
  path: z.string(),
  fileKind: z.enum(["csv", "parquet", "json"]),
});
export type SourceSpec = z.infer<typeof sourceSpecSchema>;

export const semanticSpecSchema = z.object({
  op: semanticOpSchema,
  inputColumn: z.string(),
  outputColumn: z.string(),
  instruction: z.string(),
  labels: z.array(z.string()),
  sampleLimit: z.number(),
});
export type SemanticSpec = z.infer<typeof semanticSpecSchema>;

export const chartSpecSchema = z.object({
  type: chartTypeSchema,
  x: z.string().nullable(),
  y: z.string().nullable(),
  color: z.string().nullable(),
});
export type ChartSpec = z.infer<typeof chartSpecSchema>;

export const graphNodeSchema = z.object({
  id: z.string(),
  kind: nodeKindSchema,
  title: z.string(),
  ui: z.object({ x: z.number(), y: z.number() }),
  source: sourceSpecSchema.optional(),
  sql: z.string().optional(),
  semantic: semanticSpecSchema.optional(),
  chart: chartSpecSchema.optional(),
});
export type GraphNode = z.infer<typeof graphNodeSchema>;

export const graphEdgeSchema = z.object({ from: z.string(), to: z.string() });
export type GraphEdge = z.infer<typeof graphEdgeSchema>;

export const graphDocSchema = z.object({
  version: z.literal(2),
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  selected: z.string().nullable(),
});
export type GraphDoc = z.infer<typeof graphDocSchema>;

/** Lift a v1 {sources,cells} doc into a v2 graph; pass v2 through unchanged. */
export function migrateToV2(raw: unknown): GraphDoc {
  const obj = raw as { version?: number };
  if (obj?.version === 2) return graphDocSchema.parse(raw);

  // v1 shape
  const v1 = raw as {
    sources?: Array<{ id: string; path: string; kind: "csv" | "parquet" | "json" }>;
    cells?: Array<{ id: string; title: string; sql: string;
      viz: { type: ChartType; x: string | null; y: string | null; color: string | null } }>;
  };
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let y = 0;
  const sourceIds = (v1.sources ?? []).map((s) => {
    const id = `src_${s.id}`;
    nodes.push({ id, kind: "source", title: s.id,
      source: { path: s.path, fileKind: s.kind }, ui: { x: 0, y } });
    y += 140;
    return id;
  });
  (v1.cells ?? []).forEach((c, i) => {
    const sqlId = `sql_${c.id}`;
    const chartId = `chart_${c.id}`;
    nodes.push({ id: sqlId, kind: "sql", title: c.title, sql: c.sql,
      ui: { x: 300, y: i * 140 } });
    nodes.push({ id: chartId, kind: "chart", title: `${c.title} chart`,
      chart: c.viz, ui: { x: 600, y: i * 140 } });
    // wire every source into the first sql cell (best-effort lineage)
    sourceIds.forEach((sid) => edges.push({ from: sid, to: sqlId }));
    edges.push({ from: sqlId, to: chartId });
  });
  return { version: 2, nodes, edges, selected: nodes[0]?.id ?? null };
}
