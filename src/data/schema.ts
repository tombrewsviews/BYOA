import { z } from "zod";

export const vizTypeSchema = z.enum(["table", "bar", "line", "scatter"]);
export type VizType = z.infer<typeof vizTypeSchema>;

export const vizSchema = z.object({
  type: vizTypeSchema,
  x: z.string().nullable(),
  y: z.string().nullable(),
  color: z.string().nullable(),
});
export type Viz = z.infer<typeof vizSchema>;

export const dataSourceSchema = z.object({
  id: z.string(),
  path: z.string(),
  kind: z.enum(["csv", "parquet", "json"]),
});
export type DataSource = z.infer<typeof dataSourceSchema>;

export const dataCellSchema = z.object({
  id: z.string(),
  title: z.string(),
  sql: z.string(),
  viz: vizSchema,
});
export type DataCell = z.infer<typeof dataCellSchema>;

export const queryDocSchema = z.object({
  version: z.number(),
  sources: z.array(dataSourceSchema),
  cells: z.array(dataCellSchema),
  activeCell: z.string(),
});
export type QueryDoc = z.infer<typeof queryDocSchema>;
