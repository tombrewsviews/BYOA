/**
 * The kinetic-typography canvas plugin.
 *
 * Re-exports the existing kinetic components (Player, Panel, Timeline,
 * Library, StarterCard, PromptModeBar) as a single plugin instance the
 * shell can consume without knowing anything about beats or easings.
 *
 * The component files themselves stay in editor/ — they're already
 * kinetic-only, and moving them would inflate the substrate diff
 * without changing semantics. The seam is in this file: anything that
 * crosses it is canvas-agnostic.
 */
import React from "react";
import { storySchema, storyDurationInFrames, type Story } from "../../../src/kinetic/schema";
import { PlayerStage } from "../../player";
import { Panel } from "../../panel";
import { Timeline } from "../../timeline";
import { Library } from "../../Library";
import { StarterCard } from "../../StarterCard";
import {
  diffFields,
  applyFields,
  readField,
  fieldLabel,
  type FieldKey,
} from "./diff";
import type {
  CanvasPlugin,
  CanvasRendererProps,
  CanvasInspectorProps,
  CanvasTimelineProps,
  ConflictResolution,
} from "../../canvas";
import type { Selection } from "../../selection";

const Renderer: React.FC<CanvasRendererProps<Story>> = (props) => (
  <PlayerStage
    inputProps={props.doc}
    durationInFrames={props.durationInFrames}
    fps={props.fps}
    playerRef={props.playerRef}
    selection={props.selection}
    onChange={props.onChange}
    loop={props.loop}
  />
);

const Inspector: React.FC<CanvasInspectorProps<Story>> = (props) => (
  <Panel
    story={props.doc}
    selection={props.selection}
    onSelect={props.onSelect}
    onChange={props.onChange}
  />
);

const KineticTimeline: React.FC<CanvasTimelineProps<Story>> = (props) => (
  <Timeline
    story={props.doc}
    selection={props.selection}
    onSelect={props.onSelect}
    onChange={props.onChange}
    playerRef={props.playerRef}
    durationInFrames={props.durationInFrames}
    fps={props.fps}
  />
);

const RendererOverlay: React.FC<{ doc: Story; projectPath: string }> = ({
  doc,
  projectPath,
}) => <StarterCard story={doc} projectPath={projectPath} />;

const resolveConflict = (
  saved: Story,
  agent: Story,
  user: Story,
): ConflictResolution<Story> => {
  const userChanges = diffFields(saved, user);
  if (userChanges.size === 0) {
    return { merged: agent, prompt: "" };
  }
  const agentChanges = diffFields(saved, agent);
  const conflicts = new Set<FieldKey>();
  const nonConflicting = new Set<FieldKey>();
  for (const f of userChanges) {
    if (agentChanges.has(f)) conflicts.add(f);
    else nonConflicting.add(f);
  }
  const merged = applyFields(agent, user, nonConflicting);

  if (conflicts.size === 0) {
    return { merged, prompt: "" };
  }
  const lines = [...conflicts].map((f) => {
    const a = JSON.stringify(readField(merged, f));
    const b = JSON.stringify(readField(user, f));
    return `  - ${fieldLabel(f)}: ${a} → ${b}`;
  });
  const prompt = "Apply my changes on top of yours:\n" + lines.join("\n") + "\n";
  return { merged, prompt };
};

const pruneSelection = (doc: Story, selection: Selection): Selection => {
  if (selection.kind !== "beat") return selection;
  const stillValid = selection.indices.filter((i) => i < doc.beats.length);
  if (stillValid.length === 0) return { kind: "story" };
  if (stillValid.length !== selection.indices.length) {
    return { kind: "beat", indices: stillValid };
  }
  return selection;
};

export const kineticCanvas: CanvasPlugin<Story> = {
  id: "kinetic",
  docFilename: "story.json",
  parse: (raw) => storySchema.parse(raw),
  durationInFrames: (doc, fps) => storyDurationInFrames(doc, fps),
  resolveConflict,
  pruneSelection,
  Renderer,
  Inspector,
  Timeline: KineticTimeline,
  RendererOverlay,
  LeftColumnSecondaryTab: {
    label: "library",
    Component: Library,
  },
};
