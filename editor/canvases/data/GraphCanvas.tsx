import React, { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type NodeMouseHandler,
  applyNodeChanges,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { Plus } from "../../icons";
import type { GraphDoc, GraphNode, NodeKind } from "../../../src/data/schema";
import { nodeTypes, type NodeResult } from "./nodeTypes";

/** Default spec for a freshly-added node of each kind. */
function defaultsFor(kind: NodeKind): Partial<GraphNode> {
  switch (kind) {
    case "source":
      return { title: "Source", source: { path: "", fileKind: "csv" } };
    case "sql":
      return { title: "SQL", sql: "SELECT * FROM {{upstream}}" };
    case "semantic":
      return {
        title: "Semantic",
        semantic: {
          op: "classify",
          inputColumn: "",
          outputColumn: "result",
          instruction: "",
          labels: [],
          sampleLimit: 50,
        },
      };
    case "chart":
      return { title: "Chart", chart: { type: "table", x: null, y: null, color: null } };
  }
}

type Props = {
  doc: GraphDoc;
  results: Record<string, NodeResult>;
  onDocChange: (next: GraphDoc) => void;
  /** Structural changes (add node, add edge) that should trigger re-evaluation. */
  onStructuralChange: (next: GraphDoc) => void;
};

export const GraphCanvas: React.FC<Props> = ({
  doc,
  results,
  onDocChange,
  onStructuralChange,
}) => {
  const rfNodes = useMemo<Node[]>(
    () =>
      doc.nodes.map((node) => ({
        id: node.id,
        type: "data",
        position: { x: node.ui.x, y: node.ui.y },
        selected: node.id === doc.selected,
        data: { node, result: results[node.id] },
      })),
    [doc.nodes, doc.selected, results],
  );

  const rfEdges = useMemo<Edge[]>(
    () =>
      doc.edges.map((e) => ({
        id: `${e.from}->${e.to}`,
        source: e.from,
        target: e.to,
      })),
    [doc.edges],
  );

  // Persist position back to `ui` on drag-stop.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const dragStops = changes.filter(
        (c): c is Extract<NodeChange, { type: "position" }> =>
          c.type === "position" && c.dragging === false,
      );
      if (dragStops.length === 0) return;
      const applied = applyNodeChanges(changes, rfNodes);
      const posById = new Map(applied.map((n) => [n.id, n.position]));
      onDocChange({
        ...doc,
        nodes: doc.nodes.map((n) => {
          const p = posById.get(n.id);
          return p ? { ...n, ui: { x: p.x, y: p.y } } : n;
        }),
      });
    },
    [doc, rfNodes, onDocChange],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      if (doc.edges.some((e) => e.from === c.source && e.to === c.target)) return;
      onStructuralChange({
        ...doc,
        edges: [...doc.edges, { from: c.source, to: c.target }],
      });
    },
    [doc, onStructuralChange],
  );

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_evt, node) => {
      if (node.id === doc.selected) return;
      onDocChange({ ...doc, selected: node.id });
    },
    [doc, onDocChange],
  );

  const onPaneClick = useCallback(() => {
    if (doc.selected !== null) onDocChange({ ...doc, selected: null });
  }, [doc, onDocChange]);

  const addNode = useCallback(
    (kind: NodeKind) => {
      const id = `${kind}_${Math.random().toString(36).slice(2, 8)}`;
      // Offset from the last node so new nodes don't pile up at the origin.
      const last = doc.nodes[doc.nodes.length - 1];
      const x = (last?.ui.x ?? 0) + 40;
      const y = (last?.ui.y ?? 0) + 40;
      const node = { id, kind, ui: { x, y }, ...defaultsFor(kind) } as GraphNode;
      onStructuralChange({
        ...doc,
        nodes: [...doc.nodes, node],
        selected: id,
      });
    },
    [doc, onStructuralChange],
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-1 border-b border-border px-2 py-1">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Add</span>
        <Button size="sm" variant="secondary" onClick={() => addNode("source")}>
          <Plus className="size-3.5" />Source
        </Button>
        <Button size="sm" variant="secondary" onClick={() => addNode("sql")}>
          <Plus className="size-3.5" />SQL
        </Button>
        <Button size="sm" variant="secondary" onClick={() => addNode("semantic")}>
          <Plus className="size-3.5" />Semantic
        </Button>
        <Button size="sm" variant="secondary" onClick={() => addNode("chart")}>
          <Plus className="size-3.5" />Chart
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
};
