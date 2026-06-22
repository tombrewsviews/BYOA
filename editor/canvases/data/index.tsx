import React from "react";
import { queryDocSchema, type QueryDoc } from "../../../src/data/schema";
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
 * (agent panel + SQL/chart canvas) — it does NOT mount through the kinetic
 * EditorView. So Renderer/Inspector/Timeline are substrate-shaped stubs.
 * Unlike Brainstorm, the doc is real: `parse` validates query.json and
 * `resolveConflict` re-applies the user's live cell edits over the agent's
 * on-disk version (mirrors Pulse's mixer merge).
 */
const RendererStub: React.FC<CanvasRendererProps<QueryDoc>> = () => null;
const InspectorStub: React.FC<CanvasInspectorProps<QueryDoc>> = () => null;

export const dataCanvas: CanvasPlugin<QueryDoc> = {
  id: "data",
  docFilename: "query.json",
  parse: (raw) => queryDocSchema.parse(raw),
  durationInFrames: () => 1,
  resolveConflict: (saved, agent, user): ConflictResolution<QueryDoc> => {
    // Agent's on-disk doc is the base; re-apply the user's live edits to the
    // active cell's sql/viz if they diverge from the saved baseline, so an
    // agent edit doesn't stomp what the user is typing.
    const activeId = user.activeCell;
    const savedCell = saved.cells.find((c) => c.id === activeId);
    const userCell = user.cells.find((c) => c.id === activeId);
    const merged: QueryDoc = {
      ...agent,
      cells: agent.cells.map((c) => {
        if (c.id !== activeId || !userCell || !savedCell) return c;
        const userTouched =
          userCell.sql !== savedCell.sql ||
          JSON.stringify(userCell.viz) !== JSON.stringify(savedCell.viz);
        return userTouched ? { ...c, sql: userCell.sql, viz: userCell.viz } : c;
      }),
    };
    return { merged, prompt: "" };
  },
  pruneSelection: (_doc, sel) => sel as Selection,
  Renderer: RendererStub,
  Inspector: InspectorStub,
  Timeline: null,
};
