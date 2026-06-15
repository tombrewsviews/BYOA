import { pulseProjectSchema, type PulseProject } from "../../../src/pulse/schema";
import type { CanvasPlugin, ConflictResolution } from "../../canvas";
import type { Selection } from "../../selection";
import { Renderer } from "./Renderer";
import { Inspector } from "./Inspector";

/**
 * The Pulse music-visualizer canvas plugin. Sibling to kineticCanvas.
 *
 * For the vertical slice, `resolveConflict` is last-write-wins (the
 * agent's on-disk version wins). The real three-way merge that preserves
 * a user's volume edit against an agent's binding edit is the follow-up
 * plan. `Timeline` is null until the waveform/beat timeline lands.
 */
export const musicCanvas: CanvasPlugin<PulseProject> = {
  id: "pulse",
  docFilename: "project.json",
  parse: (raw) => pulseProjectSchema.parse(raw),
  durationInFrames: (doc, fps) => Math.max(1, Math.round((doc.song.durationSec || 0) * fps)),
  resolveConflict: (_saved, agent, _user): ConflictResolution<PulseProject> => ({
    merged: agent,
    prompt: "",
  }),
  pruneSelection: (_doc, sel) => sel as Selection,
  Renderer: Renderer as CanvasPlugin<PulseProject>["Renderer"],
  Inspector,
  Timeline: null,
};
