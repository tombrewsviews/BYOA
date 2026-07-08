/**
 * Public catalog loader. Manifest DATA lives in `store-catalog/*.json`
 * (the "public app list is a folder in the repo"); the `Root` component
 * can't live in JSON, so it's re-attached here from a small id->component
 * map. Private apps are collected separately from the overlay (apps.ts).
 */
import type React from "react";
import type { AppManifest } from "./apps";
import { KineticApp } from "../canvases/kinetic/KineticApp";
import { PulseApp } from "../canvases/music/PulseApp";
import { DataApp } from "../canvases/data/DataApp";

// The only part of a public app that must be code. Coming-soon apps
// (e.g. voxel) have no entry and stay Root-less.
const ROOTS: Partial<Record<string, React.FC<{ onExit: () => void }>>> = {
  kinetic: KineticApp,
  pulse: PulseApp,
  data: DataApp,
};

const catalogModules = import.meta.glob<{ default: AppManifest }>(
  "../../store-catalog/*.json",
  { eager: true },
);

export const PUBLIC_APPS: AppManifest[] = Object.values(catalogModules)
  .map((m) => {
    const data = m.default;
    const Root = ROOTS[data.id];
    return Root ? { ...data, Root } : data;
  })
  // Deterministic display order by releasedAt then id (was array order).
  .sort((a, b) =>
    a.releasedAt === b.releasedAt
      ? a.id.localeCompare(b.id)
      : a.releasedAt.localeCompare(b.releasedAt),
  );
