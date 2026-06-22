import React from "react";
import { migrateToV2, type GraphDoc } from "../../../src/data/schema";
import type {
  CanvasPlugin,
  CanvasRendererProps,
  CanvasInspectorProps,
  ConflictResolution,
} from "../../canvas";
import type { Selection } from "../../selection";

/**
 * The Data Explorer canvas plugin. Sibling to musicCanvas/brainstormCanvas.
 *
 * `DataApp` is the app Root (registered in apps.ts) and owns its own layout
 * (agent panel + node-graph canvas) — it does NOT mount through the kinetic
 * EditorView. So Renderer/Inspector/Timeline are substrate-shaped stubs.
 * Unlike Brainstorm, the doc is real: `parse` migrates query.json to the v2
 * graph and `resolveConflict` re-applies the user's live selection + position
 * over the agent's on-disk version (mirrors Pulse's mixer merge).
 */
const RendererStub: React.FC<CanvasRendererProps<GraphDoc>> = () => null;
const InspectorStub: React.FC<CanvasInspectorProps<GraphDoc>> = () => null;

export const dataCanvas: CanvasPlugin<GraphDoc> = {
  id: "data",
  docFilename: "query.json",
  parse: (raw) => migrateToV2(raw),
  durationInFrames: () => 1,
  resolveConflict: (_saved, agent, user): ConflictResolution<GraphDoc> => {
    // Agent's on-disk doc is the base. Re-apply the user's live selection and
    // the position of the selected node so an agent edit doesn't yank the node
    // the user is currently dragging out from under them.
    const userNode = user.selected
      ? user.nodes.find((n) => n.id === user.selected)
      : undefined;
    const merged: GraphDoc = {
      ...agent,
      selected: user.selected,
      nodes: agent.nodes.map((n) =>
        userNode && n.id === userNode.id ? { ...n, ui: userNode.ui } : n,
      ),
    };
    return { merged, prompt: "" };
  },
  pruneSelection: (_doc, sel) => sel as Selection,
  Renderer: RendererStub,
  Inspector: InspectorStub,
  Timeline: null,
};
