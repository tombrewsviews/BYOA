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
import { PUBLIC_APPS } from "./catalog";

export type AppStatus = "available" | "coming-soon";

export type AppCategory =
  | "video-motion"
  | "audio"
  | "3d-render"
  | "writing"
  | "data"
  | "devtools"
  | "private";

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
  /** "public" apps live in the tracked tree and ship with the shell.
   *  "private" apps live in a git-ignored overlay (editor/apps-private/)
   *  and are absent when the repo is shared/distributed — they only
   *  appear in a local build that has the overlay present. Defaults to
   *  "public" when omitted. */
  visibility?: "public" | "private";
  /** Optional skills the app exposes to the agent. */
  skills?: AppSkill[];
  /** Optional default-runtime hints. */
  runtime?: AppRuntime;
};

/**
 * A private app's self-registration bundle. Private apps live in the
 * git-ignored `editor/apps-private/` overlay and are collected at build
 * time via `import.meta.glob` — so a clone without the overlay simply
 * finds none and ships without them. Each private app dir exposes one
 * `app.tsx` with this default export.
 */
export type PrivateApp = {
  /** The catalog manifest (with Root). `visibility` is forced "private". */
  manifest: AppManifest;
};

/**
 * Collect private apps from the overlay. Eager glob so the manifests are
 * available synchronously at module load, matching the static APPS below.
 * When the overlay is absent (shared/distributed clone) this is `{}` and
 * `PRIVATE_APPS` is empty — no app code, no dangling references.
 */
const privateAppModules = import.meta.glob<{ default: PrivateApp }>(
  "../apps-private/*/app.tsx",
  { eager: true },
);

export const PRIVATE_APPS: AppManifest[] = Object.values(privateAppModules).map(
  (m) => ({ ...m.default.manifest, visibility: "private" as const }),
);

/**
 * The full catalog: public apps first (in display order), then any
 * private apps found in the overlay. A shared clone has no overlay, so
 * `PRIVATE_APPS` is empty and `APPS` is exactly the public set.
 */
export const APPS: AppManifest[] = [...PUBLIC_APPS, ...PRIVATE_APPS];

export const findApp = (id: string): AppManifest | undefined =>
  APPS.find((a) => a.id === id);
