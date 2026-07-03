import React from "react";
import type {
  CanvasPlugin,
  CanvasRendererProps,
  CanvasInspectorProps,
  ConflictResolution,
} from "../../canvas";
import type { Selection } from "../../selection";
import { parseDoc, type RemitDoc } from "./schema";

/**
 * The Remit canvas plugin. Sibling to kinetic / pulse / data.
 *
 * Remit owns its whole experience via `RemitApp` (registered in apps.ts):
 * a form panel + live PDF preview + export. There is no timeline and no
 * frame-based renderer, so the substrate plugin fields below are honest
 * no-ops. The doc (`remit.json`) is real and persisted — parse returns it.
 */
export type { RemitDoc };

const RendererStub: React.FC<CanvasRendererProps<RemitDoc>> = () => null;
const InspectorStub: React.FC<CanvasInspectorProps<RemitDoc>> = () => null;

export const remitCanvas: CanvasPlugin<RemitDoc> = {
  id: "remit",
  docFilename: "remit.json",
  parse: (raw: string) => parseDoc(raw),
  durationInFrames: () => 1,
  // The form panel is the single source of truth; last write wins.
  resolveConflict: (_saved, agent): ConflictResolution<RemitDoc> => ({
    merged: agent,
    prompt: "",
  }),
  pruneSelection: (_doc, sel) => sel as Selection,
  Renderer: RendererStub,
  Inspector: InspectorStub,
  Timeline: null,
};
