import React from "react";
import type {
  CanvasPlugin,
  CanvasRendererProps,
  CanvasInspectorProps,
  ConflictResolution,
} from "../../canvas";
import type { Selection } from "../../selection";

/**
 * The Brainstorm Canvas plugin. Sibling to kineticCanvas / musicCanvas.
 *
 * The board is a LIVE Excalidraw instance served by a local canvas server —
 * NOT a doc this canvas parses/renders/merges. The scene lives in the server,
 * not in a file. So like Pulse, Brainstorm uses `BrainstormApp` as its app Root
 * (registered in apps.ts) and owns its own layout (agent panel + canvas
 * webview). The plugin fields below are honest no-ops that satisfy the
 * substrate's `CanvasPlugin` shape; none of the doc/merge/history machinery
 * applies because the canvas server (and Excalidraw's own undo) is authoritative.
 *
 * `Doc` is an empty marker type — `board.json` is only a detection seed.
 */
export type BoardDoc = Record<string, never>;

const RendererStub: React.FC<CanvasRendererProps<BoardDoc>> = () => null;
const InspectorStub: React.FC<CanvasInspectorProps<BoardDoc>> = () => null;

export const brainstormCanvas: CanvasPlugin<BoardDoc> = {
  id: "brainstorm",
  docFilename: "board.json",
  // The seed marker isn't a real document; parse to an empty object.
  parse: () => ({}) as BoardDoc,
  // No timeline / frames.
  durationInFrames: () => 1,
  // The canvas server is the source of truth; there's nothing to merge.
  resolveConflict: (_saved, agent): ConflictResolution<BoardDoc> => ({
    merged: agent,
    prompt: "",
  }),
  pruneSelection: (_doc, sel) => sel as Selection,
  Renderer: RendererStub,
  Inspector: InspectorStub,
  Timeline: null,
};
