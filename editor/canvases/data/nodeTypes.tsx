import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Folder, Play, Star, LayoutGrid } from "../../icons";
import type { GraphNode, NodeKind } from "../../../src/data/schema";

/** NodeResult as returned by the `data_evaluate` command (camelCase). */
export type NodeResult = {
  columns: { name: string; type: string }[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  error: string | null;
};

/** Data attached to each React Flow node by GraphCanvas. */
export type GraphNodeData = {
  node: GraphNode;
  result: NodeResult | undefined;
};

const KIND_ICON: Record<NodeKind, React.FC<{ className?: string }>> = {
  source: Folder,
  sql: Play,
  semantic: Star,
  chart: LayoutGrid,
};

const KIND_LABEL: Record<NodeKind, string> = {
  source: "Source",
  sql: "SQL",
  semantic: "Semantic",
  chart: "Chart",
};

/** Compact one-line preview of a node's evaluation result. */
const Preview: React.FC<{ result: NodeResult | undefined }> = ({ result }) => {
  if (!result) return <span className="text-muted-foreground">not run</span>;
  if (result.error) {
    return <span className="text-destructive">{result.error}</span>;
  }
  const cols = result.columns
    .slice(0, 3)
    .map((c) => c.name)
    .join(", ");
  const more = result.columns.length > 3 ? "…" : "";
  return (
    <span className="text-muted-foreground">
      {result.rowCount} rows{cols ? ` · ${cols}${more}` : ""}
    </span>
  );
};

/** The single custom React Flow node. Switches body on `node.kind`. */
const DataNode: React.FC<NodeProps> = ({ data, selected }) => {
  const { node, result } = data as unknown as GraphNodeData;
  const Icon = KIND_ICON[node.kind];

  return (
    <div
      className={`w-56 rounded-lg border bg-card text-card-foreground shadow-sm ${
        selected ? "border-primary ring-1 ring-primary" : "border-border"
      }`}
    >
      {node.kind !== "source" ? (
        <Handle type="target" position={Position.Left} className="!size-2 !bg-muted-foreground" />
      ) : null}

      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Icon className="size-4 text-muted-foreground" />
        <span className="truncate text-sm font-medium text-foreground" title={node.title}>
          {node.title || KIND_LABEL[node.kind]}
        </span>
        <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
          {KIND_LABEL[node.kind]}
        </span>
      </div>

      <div className="px-3 py-2 text-xs">
        <Preview result={result} />
      </div>

      {node.kind !== "chart" ? (
        <Handle type="source" position={Position.Right} className="!size-2 !bg-muted-foreground" />
      ) : null}
    </div>
  );
};

export const nodeTypes = { data: DataNode };
