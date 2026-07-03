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
import { PulseApp } from "../canvases/music/PulseApp";
import { BrainstormApp } from "../canvases/brainstorm/BrainstormApp";
import { DataApp } from "../canvases/data/DataApp";
import { RemitApp } from "../canvases/remit/RemitApp";

export type AppStatus = "available" | "coming-soon";

export type AppCategory =
  | "video-motion"
  | "audio"
  | "3d-render"
  | "writing"
  | "data"
  | "devtools";

export type AppSkill = { name: string; on: boolean };

export type AppRuntime = { model: string; context: string; effort: string };

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
  /** ISO date when the app was released. Drives "New this week". */
  releasedAt: string;
  /** Bundle size in bytes. Shown on the Install button. */
  sizeBytes: number;
  /** Primary category — drives the Categories sidebar section. */
  category: AppCategory;
  /** Optional skills the app exposes to the agent. */
  skills?: AppSkill[];
  /** Optional default-runtime hints. */
  runtime?: AppRuntime;
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
    releasedAt: "2026-05-10",
    sizeBytes: 4_100_000,
    category: "video-motion",
    skills: [
      { name: "/gsd:update", on: true },
      { name: "/beat:add", on: true },
      { name: "/palette", on: true },
      { name: "/export", on: true },
    ],
    runtime: { model: "Opus 4.7", context: "1M", effort: "xhigh" },
  },
  {
    id: "pulse",
    name: "Pulse",
    blurb: "Agent-native music visualizer",
    description:
      "Pick a folder of stems; Pulse analyzes each into a live timeline and drives GPU shader effects from the music. Bind stems to visuals, author the next look with the agent, and crossfade it onto a fullscreen stage.",
    creator: "altramanera",
    version: "0.1.0",
    tokens: 0,
    files: 30,
    loc: 2_200,
    rating: 0,
    ratingCount: 0,
    tags: ["music", "visualizer", "agent-native"],
    hue: 142,
    status: "available",
    Root: PulseApp,
    releasedAt: "2026-06-15",
    sizeBytes: 3_000_000,
    category: "audio",
  },
  {
    id: "brainstorm",
    name: "Brainstorm Canvas",
    blurb: "Agent-native collaborative whiteboard",
    description:
      "A live Excalidraw board you share with the agent. It can see the canvas and draw on it. Prompted mode acts when you ask; continuous mode watches the board and chimes in like a participant — observing, suggesting, asking — while you sketch.",
    creator: "altramanera",
    version: "0.1.0",
    tokens: 0,
    files: 8,
    loc: 700,
    rating: 0,
    ratingCount: 0,
    tags: ["whiteboard", "collaboration", "agent-native"],
    hue: 200,
    status: "available",
    Root: BrainstormApp,
    releasedAt: "2026-06-17",
    sizeBytes: 1_200_000,
    category: "writing",
  },
  {
    id: "data",
    name: "Lens",
    blurb: "Agent-native reactive data canvas",
    description:
      "Build data pipelines with a reactive node graph: source files → SQL queries (DuckDB) → semantic AI operations → visualizations. The graph auto-recomputes as you edit query.json; the agent co-authors the pipeline and semantic operations run via your own agent CLI. See the full pipeline state in .kinetic-studio/last_result.json.",
    creator: "altramanera",
    version: "0.1.0",
    tokens: 0,
    files: 9,
    loc: 900,
    rating: 0,
    ratingCount: 0,
    tags: ["data", "reactive", "ai", "agent-native"],
    hue: 48,
    status: "available",
    Root: DataApp,
    releasedAt: "2026-06-22",
    sizeBytes: 2_000_000,
    category: "data",
  },
  {
    id: "remit",
    name: "Remit",
    blurb: "Auto-fill bank transfer forms",
    description:
      "Fill the Maybank remittance form from a small form panel instead of editing a PDF field by field. Your fixed sender details are baked in; enter the recipient, bank, and amount, and export a page-1 PDF that matches the bank's form, on white, with your signature stamped in.",
    creator: "altramanera",
    version: "0.1.0",
    tokens: 0,
    files: 8,
    loc: 1_100,
    rating: 0,
    ratingCount: 0,
    tags: ["forms", "pdf", "banking"],
    hue: 210,
    status: "available",
    Root: RemitApp,
    releasedAt: "2026-07-03",
    sizeBytes: 1_500_000,
    category: "writing",
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
    releasedAt: "2026-04-30",
    sizeBytes: 5_400_000,
    category: "3d-render",
  },
];

export const findApp = (id: string): AppManifest | undefined =>
  APPS.find((a) => a.id === id);
