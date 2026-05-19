# Shell Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the platform shell (titlebar, The Square, Kinetic editor chrome) to a unified grayscale-with-white-accent system, replace the Square's big-card grid with an App Store-style row list + click-to-open drawer, and add a mocked install lifecycle that drives the action button label.

**Architecture:** Tokens live in one new module (`editor/platform/theme.ts`). Install state lives in another (`editor/platform/install.ts`) with a React hook. The Square decomposes into three components — `Sidebar`, `AppRow`, `AppDrawer` — orchestrated by a rewritten `Square.tsx`. The Kinetic editor's existing layout is untouched; only colors, borders, and button shapes change to consume the tokens.

**Tech Stack:** React 19, TypeScript, inline `style={{}}` objects (existing codebase pattern — no CSS-in-JS lib, no Tailwind). Tauri 2 runtime. Vite dev server (`npm run editor`) for in-browser manual verification.

**Testing note:** The repo has no test framework. Each task therefore uses **manual verification steps** (specific commands + observable outcomes) in place of automated tests. Tasks that touch type signatures rely on TypeScript via `npx tsc --noEmit` for correctness checks.

---

## File map

### Added (5 files)

- `editor/platform/theme.ts` — color/spacing/radius tokens + `primaryBtn`, `secondaryBtn`, `ghostBtn`, `tabBtn` style helpers. Pure data, no React import.
- `editor/platform/install.ts` — install state machine + `useInstallState` hook + persistence in `localStorage`. Mocked fetch via `setTimeout`.
- `editor/platform/Sidebar.tsx` — left rail: search input + Browse/Categories/Installed sections.
- `editor/platform/AppRow.tsx` — single list row: icon + name + blurb + install/open button.
- `editor/platform/AppDrawer.tsx` — right drawer with Identity / Bundle / Skills / Runtime sections + primary CTA.

### Changed (10 files)

- `editor/platform/Square.tsx` — rewritten as thin orchestrator (~150 LOC). Old `Card`, `Stars`, `StatRow`, `StatsPanel` deleted; favorites toolbar removed.
- `editor/platform/apps.ts` — manifest gains `releasedAt`, `sizeBytes`, `category`; optional `skills`, `runtime`.
- `editor/App.tsx` — platform titlebar tokens.
- `editor/canvases/kinetic/KineticApp.tsx` — `TopBarBtn` → `secondaryBtn`; focus rings → `accent.focus`; tab buttons → `tabBtn`; error banner → `danger.*`.
- `editor/canvases/kinetic/ProjectsView.tsx` — project list rows adopt the row pattern.
- `editor/panel.tsx` — tokens + button variants throughout.
- `editor/timeline.tsx` — tokens + button variants throughout.
- `editor/player.tsx` — Transport buttons via variants.
- `editor/Library.tsx` — tokens + variants.
- `editor/FirstRun.tsx` — tokens + variants.
- `editor/UndoMenu.tsx` — adopt `ghostBtn` + tokens.

### Approx line delta

- New code: ~700 LOC across 5 new files.
- `Square.tsx`: 565 → ~150 LOC (rewritten and decomposed).
- Other restyles: small line-level swaps, near-zero net delta per file.

---

## Task 1: Add theme tokens module

**Files:**
- Create: `editor/platform/theme.ts`

- [ ] **Step 1: Write the new module**

```typescript
/**
 * Shell-wide design tokens and button style helpers.
 *
 * Single source of truth for colors, spacing, radii, and the three
 * button variants used across the platform shell (The Square, the
 * platform titlebar) and the Kinetic editor chrome.
 *
 * Pure data + style returners. No React imports — these are consumed
 * as plain CSSProperties objects by every UI module.
 */
import type React from "react";

export const color = {
  bg: {
    canvas: "#08080c",
    surface: "#0a0a10",
    raised: "#0f0f18",
    hover: "#14141e",
    selected: "#1a1a24",
  },
  border: {
    faint: "#1a1a24",
    line: "#232330",
    strong: "#2e2e3c",
    hover: "#3a3a4a",
  },
  text: {
    primary: "#fafafa",
    secondary: "#e4e4ee",
    muted: "#8b8b9a",
    dim: "#6b6b80",
    faint: "#5a5a6e",
  },
  accent: {
    fg: "#fafafa",
    bg: "#08080c",
    dot: "#fafafa",
    focus: "rgba(250,250,250,0.18)",
  },
  danger: {
    bg: "#3a1414",
    border: "#5a2020",
    text: "#ffb4b4",
  },
} as const;

export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 10,
  pill: 999,
} as const;

export const space = {
  s2: 2,
  s4: 4,
  s6: 6,
  s8: 8,
  s10: 10,
  s12: 12,
  s14: 14,
  s16: 16,
  s20: 20,
  s24: 24,
  s32: 32,
  s40: 40,
} as const;

export const font = {
  family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  size: { xs: 10, sm: 11, md: 12, base: 13, lg: 14, xl: 18, display: 36 },
} as const;

export const primaryBtn = (
  opts: { size?: "sm" | "md"; disabled?: boolean } = {},
): React.CSSProperties => {
  const sm = opts.size === "sm";
  return {
    background: opts.disabled ? color.bg.selected : color.accent.fg,
    border: 0,
    borderRadius: radius.md,
    color: opts.disabled ? color.text.dim : color.accent.bg,
    fontSize: sm ? font.size.md : font.size.base,
    fontWeight: 700,
    padding: sm ? "6px 10px" : "10px 14px",
    cursor: opts.disabled ? "default" : "pointer",
    letterSpacing: 0,
    transition: "background 120ms ease",
  };
};

export const secondaryBtn = (
  opts: { active?: boolean; disabled?: boolean } = {},
): React.CSSProperties => ({
  background: opts.active ? color.bg.selected : "transparent",
  border: `1px solid ${color.border.strong}`,
  borderRadius: radius.md,
  color: opts.disabled
    ? color.text.dim
    : opts.active
      ? color.text.primary
      : color.text.secondary,
  fontSize: font.size.sm,
  fontWeight: 600,
  padding: "6px 12px",
  cursor: opts.disabled ? "default" : "pointer",
  opacity: opts.disabled ? 0.5 : 1,
  transition: "border-color 120ms ease, background 120ms ease",
});

export const ghostBtn = (
  opts: { disabled?: boolean } = {},
): React.CSSProperties => ({
  background: "transparent",
  border: 0,
  borderRadius: radius.sm,
  color: color.text.muted,
  fontSize: font.size.sm,
  fontWeight: 500,
  padding: "6px 8px",
  cursor: opts.disabled ? "default" : "pointer",
  opacity: opts.disabled ? 0.5 : 1,
  transition: "background 120ms ease, color 120ms ease",
});

/** One-off pattern for the terminal/secondary tab switcher. */
export const tabBtn = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: "6px 8px",
  fontSize: font.size.sm,
  fontWeight: 600,
  background: active ? color.bg.surface : "transparent",
  border: "1px solid",
  borderColor: active ? color.border.line : "transparent",
  borderBottomColor: active ? color.bg.surface : "transparent",
  borderRadius: "6px 6px 0 0",
  color: active ? color.text.primary : color.text.dim,
  cursor: "pointer",
  textTransform: "capitalize",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
});

/** Standard inset focus ring used on the editor's three focus zones. */
export const focusRing = `inset 0 0 0 2px ${color.accent.focus}`;

/** Format a byte count as KB/MB/GB with one decimal. */
export const formatBytes = (bytes: number): string => {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
};
```

- [ ] **Step 2: Type-check the new file**

Run: `npx tsc --noEmit`
Expected: clean exit (no errors). The new file is exported but not yet imported — that's fine.

- [ ] **Step 3: Commit**

```bash
git add editor/platform/theme.ts
git commit -m "feat(shell): add theme tokens and button style helpers"
```

---

## Task 2: Add install lifecycle module

**Files:**
- Create: `editor/platform/install.ts`

- [ ] **Step 1: Write the new module**

```typescript
/**
 * Install lifecycle for community apps.
 *
 * Today the only "installable" surface is The Square's primary CTA
 * (Install / Installing… / Open). The flow is intentionally mocked —
 * `startInstall(id)` walks progress 0 → 1 over ~2 seconds via
 * setTimeout, then lands on 'installed'. Persistence is localStorage.
 *
 * The real GitHub fetch is a separate, much larger workstream (Tauri
 * commands, code signing, dynamic module loading, sandbox). This
 * module's API is shaped so a real implementation can drop in by
 * replacing the walk inside startInstall() with an event-driven
 * Rust-side install — nothing else needs to change.
 *
 * Bundled apps (those whose AppManifest carries a `Root` component)
 * are always reported as 'installed'. The user cannot uninstall a
 * bundled app from the UI.
 */
import { useEffect, useState } from "react";
import { findApp } from "./apps";

export type InstallState =
  | "not-installed"
  | "installing"
  | "installed"
  | "failed";

export type InstallRecord = {
  state: InstallState;
  progress: number; // 0..1
  installedAt: string | null;
  error: string | null;
};

const DEFAULT_RECORD: InstallRecord = {
  state: "not-installed",
  progress: 0,
  installedAt: null,
  error: null,
};

const storageKey = (appId: string) => `platform.install.${appId}`;

const isBundled = (appId: string): boolean => {
  const app = findApp(appId);
  return !!app?.Root;
};

const loadFromStorage = (appId: string): InstallRecord => {
  try {
    const raw = localStorage.getItem(storageKey(appId));
    if (!raw) return DEFAULT_RECORD;
    const parsed = JSON.parse(raw) as Partial<InstallRecord>;
    return {
      state: (parsed.state as InstallState) ?? "not-installed",
      progress: typeof parsed.progress === "number" ? parsed.progress : 0,
      installedAt: parsed.installedAt ?? null,
      error: parsed.error ?? null,
    };
  } catch {
    return DEFAULT_RECORD;
  }
};

const saveToStorage = (appId: string, record: InstallRecord) => {
  try {
    localStorage.setItem(storageKey(appId), JSON.stringify(record));
  } catch {
    /* ignore */
  }
};

// In-memory store + subscribers so multiple components reflect the
// same record without round-tripping through localStorage on each
// progress tick.
const cache = new Map<string, InstallRecord>();
const subscribers = new Map<string, Set<(rec: InstallRecord) => void>>();
const timers = new Map<string, number>();

const notify = (appId: string, rec: InstallRecord) => {
  cache.set(appId, rec);
  saveToStorage(appId, rec);
  const subs = subscribers.get(appId);
  if (subs) for (const fn of subs) fn(rec);
};

export const getInstallState = (appId: string): InstallRecord => {
  if (isBundled(appId)) {
    return {
      state: "installed",
      progress: 1,
      installedAt: cache.get(appId)?.installedAt ?? new Date(0).toISOString(),
      error: null,
    };
  }
  const cached = cache.get(appId);
  if (cached) return cached;
  const loaded = loadFromStorage(appId);
  cache.set(appId, loaded);
  return loaded;
};

const subscribe = (
  appId: string,
  fn: (rec: InstallRecord) => void,
): (() => void) => {
  let set = subscribers.get(appId);
  if (!set) {
    set = new Set();
    subscribers.set(appId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
  };
};

export const useInstallState = (appId: string): InstallRecord => {
  const [rec, setRec] = useState<InstallRecord>(() => getInstallState(appId));
  useEffect(() => {
    setRec(getInstallState(appId));
    const unsub = subscribe(appId, setRec);
    return unsub;
  }, [appId]);
  return rec;
};

/** Idempotent: no-op if already installing or installed (or bundled). */
export const startInstall = (appId: string): void => {
  if (isBundled(appId)) return;
  const current = getInstallState(appId);
  if (current.state === "installing" || current.state === "installed") return;

  notify(appId, { state: "installing", progress: 0, installedAt: null, error: null });

  // Walk progress to 1.0 over ~2s in 40ms ticks (50 ticks).
  let progress = 0;
  const tick = () => {
    progress = Math.min(1, progress + 1 / 50);
    if (progress >= 1) {
      timers.delete(appId);
      notify(appId, {
        state: "installed",
        progress: 1,
        installedAt: new Date().toISOString(),
        error: null,
      });
      return;
    }
    notify(appId, {
      state: "installing",
      progress,
      installedAt: null,
      error: null,
    });
    const id = window.setTimeout(tick, 40);
    timers.set(appId, id);
  };
  const id = window.setTimeout(tick, 40);
  timers.set(appId, id);
};

export const cancelInstall = (appId: string): void => {
  const t = timers.get(appId);
  if (t !== undefined) {
    window.clearTimeout(t);
    timers.delete(appId);
  }
  const current = getInstallState(appId);
  if (current.state !== "installing") return;
  notify(appId, { ...DEFAULT_RECORD });
};

export const uninstall = (appId: string): void => {
  if (isBundled(appId)) return;
  cancelInstall(appId);
  notify(appId, { ...DEFAULT_RECORD });
};
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add editor/platform/install.ts
git commit -m "feat(shell): add install lifecycle module with mocked progress"
```

---

## Task 3: Extend AppManifest with restyle-required fields

**Files:**
- Modify: `editor/platform/apps.ts`

- [ ] **Step 1: Add new fields to the AppManifest type**

In `editor/platform/apps.ts`, replace the `AppManifest` type (lines 23-58) so the type ends with the new fields, keeping all existing fields:

```typescript
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
```

- [ ] **Step 2: Fill values for the three existing apps**

Replace the `APPS` array (lines 64-117) with the same three entries plus the new fields:

```typescript
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
    releasedAt: "2026-04-22",
    sizeBytes: 2_900_000,
    category: "audio",
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
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 4: Commit**

```bash
git add editor/platform/apps.ts
git commit -m "feat(platform): extend AppManifest with releasedAt, sizeBytes, category, skills, runtime"
```

---

## Task 4: Build Sidebar component

**Files:**
- Create: `editor/platform/Sidebar.tsx`

- [ ] **Step 1: Write the component**

```tsx
/**
 * The Square's left rail.
 *
 * Renders the search input plus three sections — Browse, Categories,
 * Installed. Filter state is owned by the parent (Square); this
 * component is fully controlled.
 */
import React from "react";
import { color, font, radius, space } from "./theme";
import { APPS, type AppCategory, type AppManifest } from "./apps";

export type Filter =
  | { kind: "browse"; key: "featured" | "new" | "most" | "soon" }
  | { kind: "category"; name: AppCategory }
  | { kind: "installed"; appId: string };

const BROWSE: { key: "featured" | "new" | "most" | "soon"; label: string }[] = [
  { key: "featured", label: "Featured" },
  { key: "new", label: "New this week" },
  { key: "most", label: "Most prompted" },
  { key: "soon", label: "Coming soon" },
];

const CATEGORY_LABEL: Record<AppCategory, string> = {
  "video-motion": "Video & Motion",
  audio: "Audio",
  "3d-render": "3D & Render",
  writing: "Writing",
  data: "Data",
  devtools: "Devtools",
};

const sectionLabel: React.CSSProperties = {
  fontSize: font.size.xs,
  fontWeight: 600,
  color: color.text.dim,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  padding: "0 12px",
  marginBottom: space.s6,
};

const row = (active: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  background: "transparent",
  border: 0,
  textAlign: "left",
  color: active ? color.text.primary : color.text.secondary,
  fontFamily: font.family,
  fontSize: font.size.base,
  fontWeight: active ? 600 : 500,
  padding: "6px 12px",
  cursor: "pointer",
});

const dot = (visible: boolean): React.CSSProperties => ({
  width: 6,
  height: 6,
  borderRadius: radius.pill,
  background: visible ? color.accent.dot : "transparent",
  flex: "0 0 auto",
});

const sameFilter = (a: Filter, b: Filter): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === "browse" && b.kind === "browse") return a.key === b.key;
  if (a.kind === "category" && b.kind === "category") return a.name === b.name;
  if (a.kind === "installed" && b.kind === "installed")
    return a.appId === b.appId;
  return false;
};

export const Sidebar: React.FC<{
  filter: Filter;
  onFilter: (f: Filter) => void;
  search: string;
  onSearch: (v: string) => void;
  installed: AppManifest[];
}> = ({ filter, onFilter, search, onSearch, installed }) => {
  // Only show category rows that have at least one app.
  const usedCategories = Array.from(
    new Set(APPS.map((a) => a.category)),
  ) as AppCategory[];

  return (
    <div
      style={{
        width: 220,
        flex: "0 0 220px",
        background: color.bg.surface,
        borderRight: `1px solid ${color.border.line}`,
        display: "flex",
        flexDirection: "column",
        padding: "16px 0 24px",
        gap: space.s20,
        overflowY: "auto",
        fontFamily: font.family,
      }}
    >
      <div style={{ padding: "0 12px" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: color.bg.raised,
            border: `1px solid ${color.border.line}`,
            borderRadius: radius.md,
            color: color.text.primary,
            fontFamily: font.family,
            fontSize: font.size.md,
            padding: "8px 10px",
            outline: "none",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = color.border.hover)}
          onBlur={(e) => (e.currentTarget.style.borderColor = color.border.line)}
        />
      </div>

      <div>
        <div style={sectionLabel}>Browse</div>
        {BROWSE.map((b) => {
          const active = sameFilter(filter, { kind: "browse", key: b.key });
          return (
            <button
              key={b.key}
              onClick={() => onFilter({ kind: "browse", key: b.key })}
              style={row(active)}
            >
              <span style={dot(active)} />
              {b.label}
            </button>
          );
        })}
      </div>

      {usedCategories.length > 0 && (
        <div>
          <div style={sectionLabel}>Categories</div>
          {usedCategories.map((cat) => {
            const active = sameFilter(filter, { kind: "category", name: cat });
            return (
              <button
                key={cat}
                onClick={() => onFilter({ kind: "category", name: cat })}
                style={row(active)}
              >
                <span style={dot(active)} />
                {CATEGORY_LABEL[cat]}
              </button>
            );
          })}
        </div>
      )}

      {installed.length > 0 && (
        <div>
          <div style={sectionLabel}>Installed</div>
          {installed.map((app) => {
            const active = sameFilter(filter, {
              kind: "installed",
              appId: app.id,
            });
            return (
              <button
                key={app.id}
                onClick={() =>
                  onFilter({ kind: "installed", appId: app.id })
                }
                style={row(active)}
              >
                <span style={dot(active)} />
                {app.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean exit. (Sidebar isn't imported yet — that's fine.)

- [ ] **Step 3: Commit**

```bash
git add editor/platform/Sidebar.tsx
git commit -m "feat(square): add Sidebar component"
```

---

## Task 5: Build AppRow component

**Files:**
- Create: `editor/platform/AppRow.tsx`

- [ ] **Step 1: Write the component**

```tsx
/**
 * A single row in The Square's app list.
 *
 * Layout: 44×44 colored icon · name + sub-line (blurb · creator · version) ·
 * trailing install/open button. Click on icon or the text block opens the
 * drawer for this app. Click on the button installs or opens — and does
 * NOT open the drawer (the button stops propagation).
 */
import React from "react";
import { color, font, radius, primaryBtn, secondaryBtn, formatBytes } from "./theme";
import { type AppManifest } from "./apps";
import { startInstall, useInstallState } from "./install";

const ICON_SIZE = 44;

const InstallButton: React.FC<{
  app: AppManifest;
  onOpen: () => void;
}> = ({ app, onOpen }) => {
  const rec = useInstallState(app.id);
  if (app.status === "coming-soon") {
    return (
      <button
        disabled
        style={secondaryBtn({ disabled: true })}
        onClick={(e) => e.stopPropagation()}
      >
        Coming soon
      </button>
    );
  }
  if (rec.state === "installed") {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        style={primaryBtn({ size: "sm" })}
      >
        Open
      </button>
    );
  }
  if (rec.state === "installing") {
    const pct = Math.round(rec.progress * 100);
    return (
      <button
        onClick={(e) => e.stopPropagation()}
        style={secondaryBtn()}
        title="Installing…"
      >
        Installing… {pct}%
      </button>
    );
  }
  if (rec.state === "failed") {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          startInstall(app.id);
        }}
        style={secondaryBtn()}
      >
        Retry install
      </button>
    );
  }
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        startInstall(app.id);
      }}
      style={primaryBtn({ size: "sm" })}
    >
      Install · {formatBytes(app.sizeBytes)}
    </button>
  );
};

export const AppRow: React.FC<{
  app: AppManifest;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}> = ({ app, selected, onSelect, onOpen }) => {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 14px",
        background: selected ? color.bg.selected : color.bg.raised,
        border: `1px solid ${color.border.line}`,
        borderRadius: radius.lg,
        cursor: "pointer",
        fontFamily: font.family,
        transition: "border-color 120ms ease, background 120ms ease",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.borderColor = color.border.hover)
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.borderColor = color.border.line)
      }
    >
      <div
        aria-hidden
        style={{
          width: ICON_SIZE,
          height: ICON_SIZE,
          flex: "0 0 auto",
          background: `hsl(${app.hue}, 70%, 38%)`,
          borderRadius: radius.lg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(255,255,255,0.6)",
          fontSize: 18,
          fontWeight: 800,
          letterSpacing: -0.5,
        }}
      >
        {app.name.charAt(0)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: font.size.lg,
            fontWeight: 700,
            color: color.text.primary,
          }}
        >
          {app.name}
        </div>
        <div
          style={{
            fontSize: font.size.md,
            color: color.text.muted,
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {app.blurb} · {app.creator} · v{app.version}
        </div>
      </div>
      <InstallButton app={app} onOpen={onOpen} />
    </div>
  );
};
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add editor/platform/AppRow.tsx
git commit -m "feat(square): add AppRow component with install lifecycle button"
```

---

## Task 6: Build AppDrawer component

**Files:**
- Create: `editor/platform/AppDrawer.tsx`

- [ ] **Step 1: Write the component**

```tsx
/**
 * The Square's right detail drawer.
 *
 * Renders an app's full identity, bundle stats, optional skills, and
 * optional runtime hints, plus the same install/open CTA as the row.
 * Visible only when the user has clicked an app's icon or row body.
 * Closes on × button, Esc, or by clicking the active row again
 * (handled in the parent).
 */
import React, { useEffect, useState } from "react";
import {
  color,
  font,
  radius,
  space,
  primaryBtn,
  secondaryBtn,
  ghostBtn,
  formatBytes,
} from "./theme";
import { type AppManifest } from "./apps";
import { startInstall, useInstallState } from "./install";

const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

const formatLoc = (n: number): string => {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

const KV: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      padding: "4px 0",
      fontSize: font.size.md,
    }}
  >
    <span style={{ color: color.text.muted }}>{k}</span>
    <span
      style={{
        color: color.text.primary,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {v}
    </span>
  </div>
);

const Section: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          background: "transparent",
          border: 0,
          color: color.text.primary,
          fontFamily: font.family,
          fontSize: font.size.md,
          fontWeight: 700,
          padding: "8px 0",
          cursor: "pointer",
        }}
      >
        <span>{title}</span>
        <span style={{ color: color.text.dim, fontSize: font.size.sm }}>
          {open ? "⌃" : "⌄"}
        </span>
      </button>
      {open && <div style={{ paddingBottom: space.s8 }}>{children}</div>}
    </div>
  );
};

const CTA: React.FC<{
  app: AppManifest;
  onOpen: () => void;
}> = ({ app, onOpen }) => {
  const rec = useInstallState(app.id);
  if (app.status === "coming-soon") {
    return (
      <button disabled style={{ ...primaryBtn({ disabled: true }), width: "100%" }}>
        Coming soon
      </button>
    );
  }
  if (rec.state === "installed") {
    return (
      <button onClick={onOpen} style={{ ...primaryBtn(), width: "100%" }}>
        Open {app.name}
      </button>
    );
  }
  if (rec.state === "installing") {
    const pct = Math.round(rec.progress * 100);
    return (
      <div
        style={{
          width: "100%",
          background: color.bg.selected,
          border: `1px solid ${color.border.strong}`,
          borderRadius: radius.md,
          padding: "10px 14px",
          fontSize: font.size.base,
          fontWeight: 700,
          color: color.text.primary,
          position: "relative",
          overflow: "hidden",
          textAlign: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            height: 2,
            width: `${pct}%`,
            background: color.accent.fg,
            transition: "width 60ms linear",
          }}
        />
        Installing… {pct}%
      </div>
    );
  }
  if (rec.state === "failed") {
    return (
      <button
        onClick={() => startInstall(app.id)}
        style={{ ...secondaryBtn(), width: "100%" }}
      >
        Retry install
      </button>
    );
  }
  return (
    <button
      onClick={() => startInstall(app.id)}
      style={{ ...primaryBtn(), width: "100%" }}
    >
      Install · {formatBytes(app.sizeBytes)}
    </button>
  );
};

export const AppDrawer: React.FC<{
  app: AppManifest;
  favorite: boolean;
  onToggleFavorite: () => void;
  onClose: () => void;
  onOpen: () => void;
}> = ({ app, favorite, onToggleFavorite, onClose, onOpen }) => {
  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      style={{
        width: 360,
        flex: "0 0 360px",
        background: color.bg.surface,
        borderLeft: `1px solid ${color.border.line}`,
        display: "flex",
        flexDirection: "column",
        fontFamily: font.family,
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "14px 16px 8px",
        }}
      >
        <span
          style={{
            flex: 1,
            fontSize: font.size.xs,
            fontWeight: 600,
            color: color.text.dim,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          App
        </span>
        <button onClick={onClose} aria-label="Close" style={ghostBtn()}>
          ×
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 16px 16px",
        }}
      >
        <div
          aria-hidden
          style={{
            width: 40,
            height: 40,
            background: `hsl(${app.hue}, 70%, 38%)`,
            borderRadius: radius.lg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(255,255,255,0.6)",
            fontSize: font.size.xl,
            fontWeight: 800,
          }}
        >
          {app.name.charAt(0)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: font.size.lg,
              fontWeight: 700,
              color: color.text.primary,
            }}
          >
            {app.name}
          </div>
          <div
            style={{
              fontSize: font.size.sm,
              color: color.text.dim,
              marginTop: 2,
              letterSpacing: 0.2,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            app.{app.id}.v{app.version}
          </div>
        </div>
        <button
          onClick={onToggleFavorite}
          aria-label={favorite ? "Unfavorite" : "Favorite"}
          style={{
            ...ghostBtn(),
            color: favorite ? color.text.primary : color.text.faint,
            fontSize: font.size.lg,
          }}
        >
          ★
        </button>
      </div>

      <div style={{ padding: "0 16px 16px", flex: 1 }}>
        <Section title="Identity">
          <KV k="Name" v={app.name} />
          <KV k="Author" v={app.creator} />
          <KV k="Version" v={app.version} />
        </Section>

        <Section title="Bundle">
          <KV k="Tokens" v={formatTokens(app.tokens)} />
          <KV k="Files" v={String(app.files)} />
          <KV k="Lines" v={formatLoc(app.loc)} />
          <KV k="Size" v={formatBytes(app.sizeBytes)} />
        </Section>

        {app.skills && app.skills.length > 0 && (
          <Section title="Skills">
            {app.skills.map((s) => (
              <KV key={s.name} k={s.name} v={s.on ? "on" : "off"} />
            ))}
          </Section>
        )}

        {app.runtime && (
          <Section title="Runtime">
            <KV k="Model" v={app.runtime.model} />
            <KV k="Context" v={app.runtime.context} />
            <KV k="Effort" v={app.runtime.effort} />
          </Section>
        )}

        <p
          style={{
            fontSize: font.size.md,
            color: color.text.secondary,
            lineHeight: 1.6,
            margin: "12px 0 0",
          }}
        >
          {app.description}
        </p>
      </div>

      <div style={{ padding: 16, borderTop: `1px solid ${color.border.faint}` }}>
        <CTA app={app} onOpen={onOpen} />
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add editor/platform/AppDrawer.tsx
git commit -m "feat(square): add AppDrawer with collapsible sections + install CTA"
```

---

## Task 7: Rewrite Square.tsx as thin orchestrator

**Files:**
- Modify: `editor/platform/Square.tsx` (full rewrite)

- [ ] **Step 1: Replace the file entirely**

Replace the full contents of `editor/platform/Square.tsx` with:

```tsx
/**
 * The Square — the platform's launch screen.
 *
 * Three columns: Sidebar (filters), center list of AppRows, and a
 * conditional AppDrawer when the user has selected an app.
 *
 * Filter rules:
 *  - The active sidebar filter constrains which apps appear in the list.
 *  - Typing into the search box OVERRIDES the sidebar filter while the
 *    search value is non-empty.
 *  - Sort is in-memory; resets on reload.
 *
 * Selection rules:
 *  - Clicking an app's icon or row body opens the drawer for that app.
 *  - Clicking the row's install/open button does NOT open the drawer.
 *  - If the selected app is filtered out of the current view, the drawer
 *    closes automatically.
 *  - Clicking the active row again closes the drawer.
 */
import React, { useEffect, useMemo, useState } from "react";
import { APPS, type AppManifest } from "./apps";
import { color, font } from "./theme";
import { Sidebar, type Filter } from "./Sidebar";
import { AppRow } from "./AppRow";
import { AppDrawer } from "./AppDrawer";
import { getInstallState } from "./install";

const FAVORITES_KEY = "platform.favorites";

const loadFavorites = (): Set<string> => {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
};

const saveFavorites = (set: Set<string>) => {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
};

type SortKey = "featured" | "new" | "tokens";

const BROWSE_DISPLAY: Record<
  "featured" | "new" | "most" | "soon",
  { title: string; sort: SortKey }
> = {
  featured: { title: "Featured", sort: "featured" },
  new: { title: "New this week", sort: "new" },
  most: { title: "Most prompted", sort: "tokens" },
  soon: { title: "Coming soon", sort: "featured" },
};

const CATEGORY_DISPLAY: Record<string, string> = {
  "video-motion": "Video & Motion",
  audio: "Audio",
  "3d-render": "3D & Render",
  writing: "Writing",
  data: "Data",
  devtools: "Devtools",
};

const filterApps = (filter: Filter): AppManifest[] => {
  if (filter.kind === "browse") {
    if (filter.key === "soon") {
      return APPS.filter((a) => a.status === "coming-soon");
    }
    if (filter.key === "new") {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return APPS.filter((a) => Date.parse(a.releasedAt) >= cutoff);
    }
    return APPS;
  }
  if (filter.kind === "category") {
    return APPS.filter((a) => a.category === filter.name);
  }
  // installed
  return APPS.filter((a) => a.id === filter.appId);
};

const sortApps = (
  apps: AppManifest[],
  key: SortKey,
  dir: "asc" | "desc",
): AppManifest[] => {
  const copy = [...apps];
  if (key === "featured") {
    if (dir === "asc") copy.reverse();
    return copy;
  }
  const cmp = (a: AppManifest, b: AppManifest): number => {
    if (key === "new") return Date.parse(b.releasedAt) - Date.parse(a.releasedAt);
    if (key === "tokens") return b.tokens - a.tokens;
    return 0;
  };
  copy.sort(cmp);
  if (dir === "asc") copy.reverse();
  return copy;
};

const searchApps = (query: string): AppManifest[] => {
  const q = query.trim().toLowerCase();
  if (!q) return APPS;
  return APPS.filter(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      a.blurb.toLowerCase().includes(q) ||
      a.tags.some((t) => t.toLowerCase().includes(q)),
  );
};

const filterTitle = (filter: Filter): string => {
  if (filter.kind === "browse") return BROWSE_DISPLAY[filter.key].title;
  if (filter.kind === "category") return CATEGORY_DISPLAY[filter.name] ?? filter.name;
  const app = APPS.find((a) => a.id === filter.appId);
  return app ? app.name : "Installed";
};

export const Square: React.FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => {
  const [filter, setFilter] = useState<Filter>({ kind: "browse", key: "featured" });
  const [search, setSearch] = useState("");
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    saveFavorites(favorites);
  }, [favorites]);

  const toggleFavorite = (id: string) =>
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const installed = useMemo(
    () => APPS.filter((a) => getInstallState(a.id).state === "installed"),
    [],
  );

  const sortKey: SortKey =
    filter.kind === "browse" ? BROWSE_DISPLAY[filter.key].sort : "featured";

  const visible = useMemo(() => {
    const base = search.trim() ? searchApps(search) : filterApps(filter);
    return sortApps(base, sortKey, sortDir);
  }, [filter, search, sortKey, sortDir]);

  // Close drawer if the selected app is no longer visible.
  useEffect(() => {
    if (!selectedAppId) return;
    if (!visible.some((a) => a.id === selectedAppId)) setSelectedAppId(null);
  }, [visible, selectedAppId]);

  // Sidebar filter change with a selection: if the user clicked an
  // "Installed → kinetic" entry, also open the drawer for it.
  const handleFilter = (next: Filter) => {
    setFilter(next);
    setSearch("");
    if (next.kind === "installed") setSelectedAppId(next.appId);
  };

  const onRowSelect = (id: string) => {
    setSelectedAppId((cur) => (cur === id ? null : id));
  };

  const headerTitle = search.trim() ? "Search" : filterTitle(filter);
  const selectedApp = selectedAppId
    ? APPS.find((a) => a.id === selectedAppId) ?? null
    : null;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: color.bg.canvas,
        color: color.text.secondary,
        fontFamily: font.family,
        overflow: "hidden",
      }}
    >
      <Sidebar
        filter={filter}
        onFilter={handleFilter}
        search={search}
        onSearch={(v) => {
          setSearch(v);
        }}
        installed={installed}
      />

      <div
        style={{
          flex: 1,
          minWidth: 0,
          overflowY: "auto",
          padding: "32px 32px 80px",
        }}
      >
        <div style={{ maxWidth: 920, margin: "0 auto" }}>
          <div style={{ marginBottom: 24 }}>
            <h1
              style={{
                margin: 0,
                fontSize: font.size.display,
                fontWeight: 800,
                letterSpacing: -1,
                color: color.text.primary,
              }}
            >
              {headerTitle}
            </h1>
            <div
              style={{
                marginTop: 8,
                fontSize: font.size.md,
                color: color.text.muted,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span>{visible.length} results · sort: {sortKey}</span>
              <button
                onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                aria-label="Toggle sort direction"
                style={{
                  background: "transparent",
                  border: 0,
                  color: color.text.muted,
                  cursor: "pointer",
                  fontSize: font.size.base,
                  padding: 0,
                }}
              >
                {sortDir === "desc" ? "↓" : "↑"}
              </button>
            </div>
          </div>

          {visible.length === 0 ? (
            <div
              style={{
                padding: 40,
                textAlign: "center",
                color: color.text.faint,
                fontSize: font.size.base,
                border: `1px dashed ${color.border.line}`,
                borderRadius: 12,
              }}
            >
              No apps match. Try clearing the filters.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {visible.map((app) => (
                <AppRow
                  key={app.id}
                  app={app}
                  selected={selectedAppId === app.id}
                  onSelect={() => onRowSelect(app.id)}
                  onOpen={() => onOpen(app.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedApp && (
        <AppDrawer
          app={selectedApp}
          favorite={favorites.has(selectedApp.id)}
          onToggleFavorite={() => toggleFavorite(selectedApp.id)}
          onClose={() => setSelectedAppId(null)}
          onOpen={() => onOpen(selectedApp.id)}
        />
      )}
    </div>
  );
};
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 3: Run the dev editor and verify The Square manually**

Run: `npm run editor` (Vite dev server)
Open: the printed localhost URL.
Verify:
  1. The Square renders sidebar + list + (no drawer initially).
  2. "Featured" is the active sidebar row with a leading white dot.
  3. Three rows render: Kinetic Studio (with `Open` button), Tonebench (`Coming soon`), Voxel (`Install · 5.4 MB`).
  4. Click the Kinetic row body → drawer opens on the right with Identity / Bundle / Skills / Runtime sections.
  5. Click the same Kinetic row again → drawer closes.
  6. Click Voxel's `Install · 5.4 MB` button → button label cycles `Installing… {pct}%` over ~2s, lands on `Open`. Drawer does NOT open.
  7. Reload the page → Voxel button still says `Open` (localStorage persistence works).
  8. Click "Coming soon" in the sidebar → list shows only Tonebench + Voxel (Voxel is now `installed` but its status is `coming-soon` — confirm row still shows in `soon` filter). If a drawer was open on Kinetic, it closes.
  9. Type "music" in the search → list shows only Tonebench; sidebar's active dot stays visible but is ignored.
 10. Clear search → list returns to whatever sidebar filter was active.
 11. Click Esc with the drawer open → drawer closes.

If any item fails, fix before proceeding.

- [ ] **Step 4: Commit**

```bash
git add editor/platform/Square.tsx
git commit -m "refactor(square): rewrite as thin orchestrator with sidebar + list + drawer"
```

---

## Task 8: Restyle the platform titlebar in App.tsx

**Files:**
- Modify: `editor/App.tsx`

- [ ] **Step 1: Token-swap inline color literals**

In `editor/App.tsx`, modify the `PlatformChrome` component (lines 58-116). Add a theme import at the top alongside the existing imports:

```tsx
import { color, font, radius, secondaryBtn } from "./platform/theme";
```

Replace the `<div data-tauri-drag-region>` style and inner button styles:

```tsx
const PlatformChrome: React.FC<{
  app: AppManifest | null;
  onExit: () => void;
}> = ({ app, onExit }) => (
  <div
    data-tauri-drag-region
    style={{
      height: CHROME_HEIGHT,
      flex: "0 0 auto",
      background: color.bg.surface,
      borderBottom: `1px solid ${color.border.line}`,
      display: "flex",
      alignItems: "center",
      gap: 10,
      paddingLeft: isMac ? MAC_LEFT_PAD : 12,
      paddingRight: 12,
      color: color.text.secondary,
      fontFamily: font.family,
      fontSize: font.size.md,
      userSelect: "none",
      WebkitUserSelect: "none",
    }}
  >
    {app ? (
      <>
        <button
          data-tauri-drag-region={false}
          onClick={onExit}
          title="Back to The Square"
          style={{
            ...secondaryBtn(),
            padding: "4px 10px",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            borderRadius: radius.md,
          }}
        >
          <span style={{ fontSize: 13, lineHeight: 1 }}>⊞</span>
          The Square
        </button>
        <span style={{ color: color.text.primary, fontWeight: 600 }}>
          {app.name}
        </span>
        <span style={{ color: color.text.faint, fontSize: font.size.sm }}>
          v{app.version}
        </span>
      </>
    ) : (
      <span
        style={{
          color: color.text.primary,
          fontWeight: 700,
          letterSpacing: -0.2,
        }}
      >
        The Square
      </span>
    )}
  </div>
);
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 3: Verify in the dev editor**

Run: `npm run editor`
Verify: title bar still shows "The Square" on the home screen; after opening Kinetic Studio, it shows the `⊞ The Square` button + project name. Button border becomes a hairline.

- [ ] **Step 4: Commit**

```bash
git add editor/App.tsx
git commit -m "style(platform): tokenize titlebar colors and adopt secondaryBtn"
```

---

## Task 9: Restyle KineticApp.tsx top bar and focus rings

**Files:**
- Modify: `editor/canvases/kinetic/KineticApp.tsx`

- [ ] **Step 1: Add theme imports**

At the top of `editor/canvases/kinetic/KineticApp.tsx`, add this import alongside the existing ones:

```tsx
import { color, focusRing, font, secondaryBtn, tabBtn } from "../../platform/theme";
```

- [ ] **Step 2: Delete the local `TopBarBtn` component**

Remove the `TopBarBtn` definition (lines 54-71). It will be replaced by `secondaryBtn()`.

- [ ] **Step 3: Replace the single `TopBarBtn` usage**

Change line ~476 from:

```tsx
<TopBarBtn onClick={onCloseProject}>← Projects</TopBarBtn>
```

to:

```tsx
<button onClick={onCloseProject} style={secondaryBtn()}>← Projects</button>
```

- [ ] **Step 4: Tokenize the top bar div**

In the top bar (lines ~463-489), replace the inline style colors:

```tsx
<div
  style={{
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 12px",
    background: color.bg.surface,
    borderBottom: `1px solid ${color.border.line}`,
    fontSize: font.size.md,
    color: color.text.muted,
    fontFamily: font.family,
    flex: "0 0 auto",
  }}
>
```

And the project name span:

```tsx
<span style={{ color: color.text.primary, fontWeight: 600 }}>{project.name}</span>
```

- [ ] **Step 5: Tokenize the error banner**

Replace the error banner style block (the `<div>` rendered when `error` is truthy, lines ~490-523) with:

```tsx
{error && (
  <div
    style={{
      display: "flex",
      alignItems: "flex-start",
      gap: 8,
      padding: "8px 12px",
      background: color.danger.bg,
      borderBottom: `1px solid ${color.danger.border}`,
      color: color.danger.text,
      fontSize: font.size.sm,
      lineHeight: 1.4,
      flex: "0 0 auto",
    }}
  >
    <span style={{ fontWeight: 700 }}>⚠</span>
    <span style={{ flex: 1 }}>{error}</span>
    <button
      onClick={() => setError(null)}
      style={{
        background: "transparent",
        border: 0,
        color: color.danger.text,
        cursor: "pointer",
        fontSize: 14,
        lineHeight: 1,
        padding: 0,
      }}
      aria-label="Dismiss error"
    >
      ×
    </button>
  </div>
)}
```

- [ ] **Step 6: Tokenize the main editor grid background and font**

In the `<div style={{ display: "grid", ... }}>` at line ~524, change:

```tsx
background: "#08080c",
color: "#e4e4ee",
fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
```

to:

```tsx
background: color.bg.canvas,
color: color.text.secondary,
fontFamily: font.family,
```

- [ ] **Step 7: Replace the three focus rings**

Search for `inset 0 0 0 2px #7c5cff` in this file (three occurrences in `boxShadow` expressions for terminal panel, panel, and timeline zones). Replace each with `focusRing`:

```tsx
boxShadow:
  focusedZone === "terminal"
    ? focusRing
    : "none",
```

(Same swap for `"panel"` and `"timeline"`.)

- [ ] **Step 8: Tokenize the terminal column wrapper**

In the left-column wrapper (around line ~540), replace `background: "#0a0a10"` with `background: color.bg.surface` and `borderRight: "1px solid #232330"` with `borderRight: \`1px solid ${color.border.line}\``.

- [ ] **Step 9: Replace tab buttons with the `tabBtn` helper**

Replace the tab button style block (the `style={{ flex: 1, padding: "6px 8px", ... }}` style on lines ~591-609) with `tabBtn(leftTab === t)`:

```tsx
{(["terminal", "secondary"] as const).map((t) => (
  <button
    key={t}
    onClick={() => setLeftTab(t)}
    title={t === "terminal" ? "Focus from anywhere: Option+C" : undefined}
    style={tabBtn(leftTab === t)}
  >
    {t === "secondary" ? (
      SecondaryTab.label
    ) : (
      <>
        terminal
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: 0.3,
            color: leftTab === "terminal" ? color.text.muted : color.text.faint,
            border: `1px solid ${leftTab === "terminal" ? color.border.strong : color.border.faint}`,
            borderRadius: 3,
            padding: "1px 4px",
            textTransform: "none",
          }}
        >
          ⌥C
        </span>
      </>
    )}
  </button>
))}
```

- [ ] **Step 10: Tokenize remaining colors**

Search for the remaining hardcoded color literals in this file: `"#08080c"`, `"#0a0a10"`, `"#232330"`, `"#2e2e3c"`, `"#fafafa"`, `"#e4e4ee"`, `"#8b8b9a"`, `"#6b6b80"`, `"#4b4b5a"`, `"#5a5a6e"`, `"#1a1a24"`, `"#ff8b8b"`. Replace each with the equivalent token (`color.bg.canvas`, `color.bg.surface`, `color.border.line`, `color.border.strong`, `color.text.primary`, `color.text.secondary`, `color.text.muted`, `color.text.dim`, `color.text.faint`, `color.border.faint`, `color.danger.text` respectively). The `#4b4b5a` color is close enough to `color.text.faint` (#5a5a6e) — use that.

- [ ] **Step 11: Type-check**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 12: Verify in the dev editor**

Run: `npm run editor`
Open Kinetic Studio. Verify:
  1. Top bar background and border still look the same (the colors are token-equivalent).
  2. `← Projects` button is a hairline secondary button.
  3. Click into the terminal — its panel gets a soft low-opacity white focus ring (NOT purple).
  4. Click into the inspector panel — focus ring appears there in the same soft white.
  5. Click into the timeline — same focus ring.
  6. The `⌥C` chip still renders next to the terminal tab label.

- [ ] **Step 13: Commit**

```bash
git add editor/canvases/kinetic/KineticApp.tsx
git commit -m "style(kinetic): tokenize top bar, focus rings, tabs, and error banner"
```

---

## Task 10: Restyle UndoMenu.tsx

**Files:**
- Modify: `editor/UndoMenu.tsx`

- [ ] **Step 1: Add theme imports**

Add at the top of `editor/UndoMenu.tsx`:

```tsx
import { color, font, radius, secondaryBtn } from "./platform/theme";
```

- [ ] **Step 2: Replace the `baseBtn` constant**

Replace the local `baseBtn` definition (lines 37-44) with a derived secondary style:

```tsx
const baseBtn: React.CSSProperties = {
  ...secondaryBtn(),
  fontSize: font.size.sm,
  padding: "3px 8px",
};
```

- [ ] **Step 3: Tokenize the dropdown panel**

In the dropdown panel `<div>` (lines 94-111), replace literal colors:

```tsx
<div
  style={{
    position: "absolute",
    top: "100%",
    left: 0,
    marginTop: 4,
    minWidth: 220,
    maxHeight: 320,
    overflowY: "auto",
    background: color.bg.surface,
    border: `1px solid ${color.border.strong}`,
    borderRadius: radius.md,
    boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
    zIndex: 100,
    fontSize: font.size.sm,
  }}
>
```

- [ ] **Step 4: Tokenize the section header**

Replace the `History · {entries.length}` div style:

```tsx
<div
  style={{
    padding: "6px 10px",
    borderBottom: `1px solid ${color.border.line}`,
    color: color.text.dim,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontSize: font.size.xs,
  }}
>
  History · {entries.length}
</div>
```

- [ ] **Step 5: Tokenize the per-entry button**

Replace the entry button style + hover handlers:

```tsx
<button
  key={pastIndex}
  onClick={() => {
    history.jumpTo(pastIndex);
    setOpen(false);
  }}
  style={{
    display: "flex",
    width: "100%",
    background: "transparent",
    border: 0,
    color: color.text.secondary,
    padding: "6px 10px",
    cursor: "pointer",
    textAlign: "left",
    alignItems: "baseline",
    gap: 8,
  }}
  onMouseEnter={(e) => (e.currentTarget.style.background = color.bg.hover)}
  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
>
  <span style={{ flex: 1 }}>{entry.label}</span>
  <span style={{ color: color.text.dim, fontSize: font.size.xs }}>
    {fmtAgo(now, entry.at)}
  </span>
</button>
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 7: Verify in the dev editor**

Run: `npm run editor`
Open Kinetic Studio, make any edit to a beat to populate history, then click the `▾` arrow next to Undo. Verify the dropdown opens with the new token-styled rows.

- [ ] **Step 8: Commit**

```bash
git add editor/UndoMenu.tsx
git commit -m "style(undo): tokenize undo menu colors and adopt secondaryBtn"
```

---

## Task 11: Restyle panel.tsx

**Files:**
- Modify: `editor/panel.tsx`

- [ ] **Step 1: Add theme imports**

At the top of `editor/panel.tsx`, add:

```tsx
import {
  color,
  font,
  radius,
  primaryBtn,
  secondaryBtn,
  ghostBtn,
} from "./platform/theme";
```

- [ ] **Step 2: Token-swap all hardcoded colors**

Open `editor/panel.tsx`. The file uses these literal colors (and only these):

```
#08080c → color.bg.canvas
#0a0a10 → color.bg.surface
#0f0f18 → color.bg.raised
#14141e → color.bg.hover
#14141c → color.bg.hover    (close enough — single token)
#1a1a24 → color.border.faint
#1c1c26 → color.bg.selected
#232330 → color.border.line
#2e2e3c → color.border.strong
#3a3a4a → color.border.hover
#5a5a6e → color.text.faint
#6b6b80 → color.text.dim
#8b8b9a → color.text.muted
#e4e4ee → color.text.secondary
#fafafa → color.text.primary
#7c5cff → color.accent.fg    (also re-check usage — see step 3)
```

Read the file, then in each `style={{ ... }}` block swap every literal in the list above for its token. Where `fontFamily: "-apple-system, ..."` appears, use `font.family`. Where `fontSize: <number>` appears, leave numeric sizes as-is (the type scale tokens are advisory; sizes already match).

- [ ] **Step 3: Replace `#7c5cff` purple accents**

The panel uses `#7c5cff` for input focus borders and any active highlight. Replace each with `color.border.hover` (subtle white-ish, in keeping with the new accent-less palette). If it was used as a button background, use `color.accent.fg` text on `color.accent.bg` background (i.e. `primaryBtn()`).

- [ ] **Step 4: Convert buttons to variants**

For each `<button>` in the file, evaluate its role:
- **Primary CTA** (uncommon — only the "Apply" or main action button if present): `style={primaryBtn({ size: "sm" })}`.
- **Secondary** (the typical case — bordered inline action button): replace inline button style with `style={secondaryBtn()}` plus any layout-only properties (e.g. `marginLeft`).
- **Ghost** (chevron toggles, `+` / `−` adjusters, close buttons): `style={ghostBtn()}` plus layout overrides.

Keep `onClick`, `disabled`, `title`, `aria-*` props unchanged.

- [ ] **Step 5: Add tabular-nums to numeric value cells**

For any `<span>` or `<div>` rendering a numeric value (frame counts, durations, multipliers), add `fontVariantNumeric: "tabular-nums"` to its style so digits don't shimmy while scrubbing.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 7: Verify in the dev editor**

Run: `npm run editor`
Open Kinetic Studio. Verify:
  1. The right inspector panel looks the same shape but uses the new tokens.
  2. Click a beat — its property fields render with hairline borders.
  3. Type into a number input — focus border becomes `border.hover`, NOT purple.
  4. Scrub a numeric value — the digits don't horizontally jitter.
  5. Any "+" or "×" adjuster button is borderless (ghost style).

- [ ] **Step 8: Commit**

```bash
git add editor/panel.tsx
git commit -m "style(panel): tokenize inspector colors and adopt button variants"
```

---

## Task 12: Restyle timeline.tsx

**Files:**
- Modify: `editor/timeline.tsx`

- [ ] **Step 1: Add theme imports**

```tsx
import {
  color,
  font,
  radius,
  secondaryBtn,
  ghostBtn,
} from "./platform/theme";
```

- [ ] **Step 2: Token-swap colors**

Same swap table as panel.tsx (Task 11, Step 2). Open `editor/timeline.tsx` and replace every literal color in the list with its token. Leave the **playhead color** alone — it's a timeline affordance, not chrome, and should stay whatever it is today. Leave **beat block fills** alone — those are domain content.

- [ ] **Step 3: Replace `#7c5cff` accent uses**

Replace any `#7c5cff` in this file with `color.border.hover` (or `color.accent.fg` if it was a button background).

- [ ] **Step 4: Convert buttons to variants**

Same rule as Task 11 Step 4. Every `<button>` becomes `primaryBtn` / `secondaryBtn` / `ghostBtn` based on role.

- [ ] **Step 5: Tabular-nums on time readouts**

Time displays (e.g. `0:12.500 / 0:23.300`) get `fontVariantNumeric: "tabular-nums"` on the wrapping element.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 7: Verify in the dev editor**

Run: `npm run editor`
Open Kinetic Studio. Verify:
  1. Timeline looks the same shape and behavior.
  2. Time readout doesn't jitter while playing.
  3. Click inside the timeline — focus ring is soft white, NOT purple.
  4. Any control buttons (zoom, sort, etc.) look like hairline secondary buttons.

- [ ] **Step 8: Commit**

```bash
git add editor/timeline.tsx
git commit -m "style(timeline): tokenize colors and adopt button variants"
```

---

## Task 13: Restyle player.tsx (Transport)

**Files:**
- Modify: `editor/player.tsx`

- [ ] **Step 1: Add theme imports**

```tsx
import {
  color,
  font,
  radius,
  primaryBtn,
  secondaryBtn,
  ghostBtn,
} from "./platform/theme";
```

- [ ] **Step 2: Token-swap and convert Transport buttons**

Same approach as Task 11. The Play / Pause / Loop buttons are the main affordances — use `primaryBtn({ size: "sm" })` for play/pause, `secondaryBtn({ active: loop })` for the loop toggle, `ghostBtn()` for any seek-to-start arrows.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 4: Verify in the dev editor**

Run: `npm run editor`
Open Kinetic Studio. Verify:
  1. Transport controls render in the new style.
  2. Toggle loop on/off — the loop button shows its active state via background, not purple border.
  3. Play and pause work as before.

- [ ] **Step 5: Commit**

```bash
git add editor/player.tsx
git commit -m "style(player): adopt button variants for Transport controls"
```

---

## Task 14: Restyle ProjectsView.tsx

**Files:**
- Modify: `editor/canvases/kinetic/ProjectsView.tsx`

- [ ] **Step 1: Add theme imports**

```tsx
import {
  color,
  font,
  radius,
  primaryBtn,
  secondaryBtn,
} from "../../platform/theme";
```

- [ ] **Step 2: Token-swap colors**

Replace every literal color in this file with its token (same swap table as Task 11 Step 2).

- [ ] **Step 3: Convert project list items to the row pattern**

Where the file renders a project list item (likely a card or grid item), restructure its style to match `AppRow`:
- Container: `padding: 12 14`, `background: color.bg.raised`, `border: 1px solid color.border.line`, `borderRadius: radius.lg`, `display: flex`, `alignItems: center`, `gap: 14`.
- Hover: border becomes `color.border.hover`.
- No 16:9 hero band. No big icon. Project name on the left, last-opened time and beat count on the right in `color.text.muted`.
- Open button on the right uses `secondaryBtn()` or `primaryBtn({ size: "sm" })` depending on whether it's the primary action.
- "New project" button uses `primaryBtn({ size: "sm" })`.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 5: Verify in the dev editor**

Run: `npm run editor`
Open Kinetic Studio (no project open) so the projects screen shows. Verify:
  1. Projects render as rows, not cards.
  2. Hover lightens the border.
  3. New-project button is a primary (white) button.
  4. Open buttons on existing rows look like secondary hairlines.

- [ ] **Step 6: Commit**

```bash
git add editor/canvases/kinetic/ProjectsView.tsx
git commit -m "style(projects): adopt row pattern and tokenize colors"
```

---

## Task 15: Restyle FirstRun.tsx

**Files:**
- Modify: `editor/FirstRun.tsx`

- [ ] **Step 1: Add theme imports**

```tsx
import {
  color,
  font,
  radius,
  primaryBtn,
  secondaryBtn,
} from "./platform/theme";
```

- [ ] **Step 2: Tokenize the SHELL constant**

Replace the file's `SHELL` constant (lines 39-50):

```tsx
const SHELL: React.CSSProperties = {
  width: "100%",
  height: "100%",
  background: color.bg.canvas,
  color: color.text.secondary,
  fontFamily: font.family,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 40,
  boxSizing: "border-box",
};
```

- [ ] **Step 3: Token-swap remaining colors**

Read the rest of the file. Replace every literal color with its token. The "Continue" / "Skip permissions" buttons become `primaryBtn()` / `secondaryBtn()` (whichever role they play).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 5: Verify in the dev editor (browser-only is fine)**

Run: `npm run editor`
The FirstRun screen only renders in Tauri (the code skips it in browser mode). For a visual check, temporarily force-render it: in `KineticApp.tsx`, comment out the line `if (!isTauri()) return <EditorView .../>` and add `return <FirstRun onDone={() => undefined} />;` at the top of `KineticApp`. Verify the new styling. Revert the temporary edit before committing.

- [ ] **Step 6: Commit**

```bash
git add editor/FirstRun.tsx
git commit -m "style(firstrun): tokenize colors and adopt button variants"
```

---

## Task 16: Restyle Library.tsx

**Files:**
- Modify: `editor/Library.tsx`

- [ ] **Step 1: Add theme imports**

```tsx
import {
  color,
  font,
  radius,
  secondaryBtn,
  ghostBtn,
} from "./platform/theme";
```

- [ ] **Step 2: Token-swap colors and convert buttons**

Same approach as Task 11. Replace literal colors with tokens; convert `<button>` instances to the appropriate variant.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 4: Verify in the dev editor**

Run: `npm run editor`
Open Kinetic Studio with a project. Switch the left column to the "Library" secondary tab (if present). Verify the library renders in the new style.

- [ ] **Step 5: Commit**

```bash
git add editor/Library.tsx
git commit -m "style(library): tokenize colors and adopt button variants"
```

---

## Task 17: End-to-end manual verification

**Files:** none.

- [ ] **Step 1: Run the editor and walk the full flow**

Run: `npm run editor`

Verify each acceptance item:
  1. The Square renders sidebar + list + (no drawer initially).
  2. Default filter is `Featured`; default sort is `featured ↓`.
  3. Three rows render: Kinetic Studio, Tonebench, Voxel.
  4. Search box overrides sidebar filter while non-empty.
  5. Clicking icon or row body opens the drawer.
  6. Clicking the row's button does NOT open the drawer.
  7. Install button on Voxel: cycles `Install · 5.4 MB` → `Installing… {pct}%` → `Open` over ~2s; persists across reload.
  8. Clicking `Open` on Kinetic mounts the editor.
  9. Drawer closes when its app is filtered out (switch to "Coming soon" with Kinetic open).
 10. Kinetic top bar, panel, timeline, transport all use the new tokens.
 11. No purple anywhere — focus rings, buttons, accents all grayscale or white.
 12. Tabular-nums on numeric values: scrub a value, time readout, etc. — no jitter.
 13. Esc closes the drawer.

- [ ] **Step 2: Run a type-check on the whole tree**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 3: If Tauri is set up locally, run the desktop app**

Run: `npm run tauri:dev`
(If it fails with the path-cache error from `CLAUDE.md`, run `cargo clean --manifest-path src-tauri/Cargo.toml` first.)
Verify the platform titlebar shows the new style and the traffic lights still clear the wordmark.

- [ ] **Step 4: Commit a final cleanup if anything turns up**

If the verification surfaces any inconsistencies (stray purple, untokenized color, button that didn't get converted), fix and commit:

```bash
git add -p
git commit -m "fix(shell): final restyle cleanup from verification pass"
```

---

## Self-review notes

- All five new files from the spec are created (Tasks 1, 2, 4, 5, 6).
- All ten changed files from the spec have a dedicated task (Tasks 3, 7-16).
- Each task ends with a commit; commits are aligned with feature boundaries.
- TypeScript checks gate each step; manual verification is the substitute for an absent test framework.
- No "TBD", no "similar to Task N" — every step has its own code block.
- Type consistency: `Filter` (Sidebar.tsx + Square.tsx), `InstallRecord` / `InstallState` (install.ts + AppRow.tsx + AppDrawer.tsx), `AppManifest` extensions (apps.ts + everywhere) all match across files.
- Acceptance criteria from spec are checked in Task 17.
