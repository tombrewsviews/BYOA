/**
 * App registry — the platform's catalog.
 *
 * An "app" is a full substrate experience: a terminal, a canvas, an
 * onboarding flow, custom tabs, whatever the app author wired up. The
 * platform's home screen (The Square) lists these and hands control to
 * one when the user clicks.
 *
 * v1 ships kinetic as the only real app, plus two mock cards so the
 * Square reads like a marketplace from day one. The manifest schema
 * is forward-looking — `tokens`, `files`, `loc`, `rating`, `creator`,
 * `version` are all read by the card UI today, even though the values
 * are local/static for now. When apps move to a real distribution
 * channel later, the same schema fills from the network.
 *
 * The Root field is the React component the platform mounts when the
 * user opens the app. It is the app's whole world — top bar included.
 * Coming-soon apps have no Root.
 */
import type React from "react";
import { KineticApp } from "../canvases/kinetic/KineticApp";

export type AppStatus = "available" | "coming-soon";

export type AppManifest = {
  /** Stable id; persisted as the current-app pointer + favorite key. */
  id: string;
  /** Display name on the card and in the top bar. */
  name: string;
  /** One-line description shown under the name. */
  blurb: string;
  /** Longer description for the stats side panel. */
  description: string;
  /** Creator handle (display only). */
  creator: string;
  /** Semver display string. */
  version: string;
  /** Approximate tokens spent generating the app, for the card stat. */
  tokens: number;
  /** Number of source files. */
  files: number;
  /** Approximate lines of code. */
  loc: number;
  /** Community rating, 0..5 (one decimal). */
  rating: number;
  /** Number of ratings (display only). */
  ratingCount: number;
  /** Comma-separated tags rendered as chips. */
  tags: string[];
  /** Hue 0..360 for the card's accent gradient. Lets the catalog
   *  look varied without shipping artwork yet. */
  hue: number;
  /** "available" cards open on click; "coming-soon" are read-only. */
  status: AppStatus;
  /** Mounted by the platform when the user opens the app. Required
   *  for "available"; absent for "coming-soon". */
  Root?: React.FC<{ onExit: () => void }>;
};

/**
 * The registry. Order is display order on the Square. Stats for the
 * kinetic app are approximate — they update as the project grows.
 */
export const APPS: AppManifest[] = [
  {
    id: "kinetic",
    name: "Kinetic Studio",
    blurb: "Agent-native kinetic typography",
    description:
      "Compose animated text pieces with the agent in the terminal. Bring your own Claude / Codex / Gemini. The agent edits a single story.json on disk; the canvas re-renders within ~300 ms. Scrub parameters directly; the agent sees your edits.",
    creator: "altramanera",
    version: "0.1.0",
    tokens: 12_400_000,
    files: 142,
    loc: 8_200,
    rating: 4.8,
    ratingCount: 23,
    tags: ["typography", "video", "agent-native"],
    hue: 268,
    status: "available",
    Root: KineticApp,
  },
  {
    id: "tonebench",
    name: "Tonebench",
    blurb: "Agent-native music production",
    description:
      "A timeline-driven sampler the agent can compose into. Sketch a track with words, scrub, refine. Coming soon.",
    creator: "tonebench-labs",
    version: "0.0.1",
    tokens: 3_100_000,
    files: 48,
    loc: 2_900,
    rating: 0,
    ratingCount: 0,
    tags: ["music", "audio", "agent-native"],
    hue: 142,
    status: "coming-soon",
  },
  {
    id: "voxel",
    name: "Voxel",
    blurb: "Agent-native 3D scenes",
    description:
      "A blocky scene graph the agent populates. Tweak materials and lighting on the canvas; the agent retopologises. Coming soon.",
    creator: "voxel-collective",
    version: "0.0.1",
    tokens: 6_800_000,
    files: 91,
    loc: 5_400,
    rating: 0,
    ratingCount: 0,
    tags: ["3d", "scene", "agent-native"],
    hue: 24,
    status: "coming-soon",
  },
];

export const findApp = (id: string): AppManifest | undefined =>
  APPS.find((a) => a.id === id);
