import React from "react";
import { pulseProjectSchema, type PulseProject } from "../../../src/pulse/schema";
import type {
  CanvasPlugin,
  CanvasRendererProps,
  CanvasInspectorProps,
  ConflictResolution,
} from "../../canvas";
import type { Selection } from "../../selection";
import { Inspector as PulseInspector } from "./Inspector";

/**
 * The Pulse music-visualizer canvas plugin. Sibling to kineticCanvas.
 *
 * Pulse uses `PulseApp` as its app Root (registered in apps.ts) and owns
 * its own layout/engine/preview — it does NOT mount through the kinetic
 * `EditorView`. So the plugin's `Renderer` field is a minimal substrate-
 * shaped stub here (never rendered for Pulse); the real audio-reactive
 * Renderer lives in PulseApp. `Inspector` reuses the real one (its props
 * match the substrate shape). `resolveConflict` is the real three-way
 * merge that preserves the user's live mixer edits.
 */
const RendererStub: React.FC<CanvasRendererProps<PulseProject>> = () => null;
const InspectorAdapter: React.FC<CanvasInspectorProps<PulseProject>> = (props) => (
  <PulseInspector {...props} />
);
export const musicCanvas: CanvasPlugin<PulseProject> = {
  id: "pulse",
  docFilename: "project.json",
  parse: (raw) => pulseProjectSchema.parse(raw),
  durationInFrames: (doc, fps) => Math.max(1, Math.round((doc.song.durationSec || 0) * fps)),
  resolveConflict: (saved, agent, user): ConflictResolution<PulseProject> => {
    // Agent's on-disk version is the base; re-apply the user's LIVE mixer
    // edits (volume/mute) that differ from the saved baseline, so an agent
    // binding/effect edit doesn't stomp a slider the user is dragging. Also
    // preserve an in-flight transition.
    const byId = (arr: PulseProject["stems"]) => Object.fromEntries(arr.map((s) => [s.id, s]));
    const us = byId(user.stems);
    const ss = byId(saved.stems);
    const merged: PulseProject = {
      ...agent,
      stems: agent.stems.map((s) => {
        const u = us[s.id];
        const sv = ss[s.id];
        if (u && sv && (u.volume !== sv.volume || u.muted !== sv.muted)) {
          return { ...s, volume: u.volume, muted: u.muted };
        }
        return s;
      }),
      mix: user.mix.active === "transitioning" ? user.mix : agent.mix,
    };
    return { merged, prompt: "" };
  },
  pruneSelection: (_doc, sel) => sel as Selection,
  Renderer: RendererStub,
  Inspector: InspectorAdapter,
  Timeline: null,
};
