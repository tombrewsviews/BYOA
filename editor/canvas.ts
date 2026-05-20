/**
 * Canvas plugin — the frontend substrate seam.
 *
 * A canvas plugin describes a domain (kinetic typography, markdown,
 * music, whatever) to the shell. The shell knows nothing about beats,
 * fonts, or animation — it just asks the plugin:
 *
 *   - what's the document filename?
 *   - parse this raw JSON into a typed doc
 *   - given a saved/agent/user trio, what conflicts should I surface?
 *   - render the canvas + inspector for a doc, with a setter
 *
 * v1 ships one canvas: the kinetic-typography one. The plugin
 * instance is the single export `activeCanvas`. Wiring a second
 * canvas later means adding another module and switching what
 * `activeCanvas` resolves to — `App.tsx` does not change.
 */
import type React from "react";
import type { PlayerRef } from "@remotion/player";
import type { Selection } from "./selection";

export type CanvasRendererProps<Doc> = {
  doc: Doc;
  durationInFrames: number;
  fps: number;
  playerRef: React.RefObject<PlayerRef | null>;
  selection: Selection;
  onChange: (next: Doc | ((prev: Doc) => Doc)) => void;
  loop: boolean;
};

export type CanvasInspectorProps<Doc> = {
  doc: Doc;
  selection: Selection;
  onSelect: (next: Selection) => void;
  onChange: (next: Doc | ((prev: Doc) => Doc)) => void;
};

export type CanvasTimelineProps<Doc> = {
  doc: Doc;
  selection: Selection;
  onSelect: (next: Selection) => void;
  onChange: (next: Doc | ((prev: Doc) => Doc)) => void;
  playerRef: React.RefObject<PlayerRef | null>;
  durationInFrames: number;
  fps: number;
};

export type ConflictResolution<Doc> = {
  /** Doc with non-conflicting user edits merged in. */
  merged: Doc;
  /** Human-readable prompt to paste into the agent terminal. Empty
   *  string means "no conflict; no prompt needed". */
  prompt: string;
};

export interface CanvasPlugin<Doc = unknown> {
  /** Stable id, must match the Rust canvas id. */
  id: string;
  /** Document filename inside the project folder. */
  docFilename: string;
  /** Parse raw text from disk into a typed doc, or throw. */
  parse(raw: unknown): Doc;
  /** Total duration of the doc in frames, for the Player. */
  durationInFrames(doc: Doc, fps: number): number;
  /** Three-way merge: saved baseline, agent's disk version, user's
   *  in-memory version. Returns the merged doc + a conflict prompt
   *  to paste into the agent terminal (empty string if none). */
  resolveConflict(saved: Doc, agent: Doc, user: Doc): ConflictResolution<Doc>;
  /** Drop indices that no longer exist after a doc change. Selection
   *  is a substrate concept (a beat index or "story-level"); each
   *  canvas validates its own kind. */
  pruneSelection(doc: Doc, selection: Selection): Selection;
  /** Render the main canvas (preview). */
  Renderer: React.FC<CanvasRendererProps<Doc>>;
  /** Render the inspector / properties panel. */
  Inspector: React.FC<CanvasInspectorProps<Doc>>;
  /** Render the timeline (or other secondary surface). May be null
   *  for canvases without a timeline. */
  Timeline: React.FC<CanvasTimelineProps<Doc>> | null;
  /** Optional extras the shell mounts in the left column above the
   *  terminal. Kinetic uses this for the PromptModeBar. */
  LeftColumnPrelude?: React.FC;
  /** Optional extras mounted on top of the renderer (e.g. starter
   *  card overlay). Receives the doc and the project path. */
  RendererOverlay?: React.FC<{ doc: Doc; projectPath: string }>;
  /** Optional second tab next to "terminal" in the left column.
   *  Kinetic uses this for the Library. The component routes prompt
   *  copies via `useShellActions().copyPromptToAgent`, so no prop is
   *  needed here. */
  LeftColumnSecondaryTab?: {
    label: string;
    Component: React.FC;
  };
}

import { kineticCanvas } from "./canvases/kinetic";

export const activeCanvas: CanvasPlugin<unknown> =
  kineticCanvas as CanvasPlugin<unknown>;
