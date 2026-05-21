# Kinetic Studio batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a batch of seven editor changes: typography controls + new bundled fonts, MP4 export, and four UI polish tweaks, plus a design-system research doc.

**Architecture:** All rendering already supports per-beat font family + variable axes; we surface them in the panel. MP4 export shells out to the local Remotion CLI, streaming progress events exactly like the existing yt-dlp flow in `video.rs`. UI tweaks are direct edits to existing components.

**Tech Stack:** React 19 (inline styles, no Tailwind), Tauri 2 (Rust commands), Remotion 4, Zod schema, Vitest + jsdom, xterm.js.

---

## File structure

- `src/kinetic/schema.ts` — extend `fontFamilySchema` enum (Task 6).
- `src/kinetic/glyphs.ts` — add registry + axis bounds for new fonts (Task 6).
- `public/fonts/*.ttf` — new bundled font files (Task 6).
- `editor/typography-axes.ts` — NEW pure helpers for axis clamp + static/animate (Task 1).
- `editor/__tests__/typography-axes.test.ts` — NEW unit tests (Task 1).
- `vitest.config.ts` — widen include to pick up the new test dir (Task 1).
- `editor/panel.tsx` — Typography sections (Task 1 + 6 dropdown).
- `src-tauri/src/video.rs` — `export_video` command (Task 5).
- `src-tauri/src/lib.rs` — register `export_video` (Task 5).
- `editor/canvases/kinetic/KineticApp.tsx` — header path link (Task 2), Chat label (Task 4), Export button + progress (Task 5).
- `editor/terminal.tsx` — hide scrollbar (Task 3).
- `editor/agent-chat/SessionToolbar.tsx` — remove agent/path line (Task 4).
- `docs/design-systems-recommendation.md` — NEW research doc (Task 7).

Execution order below is sequenced for low-risk-first: tweaks, then typography, then fonts, then export, then research.

---

## Task 1: Typography panel controls (pure helpers first)

The renderer already reads `beat.fontFamily`, `beat.axes` (`{wght,wdth,slnt}` each a `[start,end]` tuple), and `story.fontFamily`. The panel must surface them. We extract pure helpers so axis clamping is unit-tested.

**Files:**
- Create: `editor/typography-axes.ts`
- Create: `editor/__tests__/typography-axes.test.ts`
- Modify: `vitest.config.ts`
- Modify: `editor/panel.tsx`

- [ ] **Step 1: Widen vitest include**

Modify `vitest.config.ts` `include` array to add the new dir:

```ts
    include: [
      "editor/agent-chat/__tests__/**/*.test.{ts,tsx}",
      "editor/__tests__/**/*.test.{ts,tsx}",
    ],
```

- [ ] **Step 2: Write the failing test for axis helpers**

Create `editor/__tests__/typography-axes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  clampAxis,
  axisSupported,
  setAxisStatic,
  setAxisRange,
} from "../typography-axes";

describe("clampAxis", () => {
  it("clamps a value into the font's bounds", () => {
    expect(clampAxis(2000, "wght", "RobotoFlex")).toBe(1000);
    expect(clampAxis(50, "wght", "RobotoFlex")).toBe(100);
    expect(clampAxis(400, "wght", "RobotoFlex")).toBe(400);
  });
  it("pins to the single supported value for static axes", () => {
    expect(clampAxis(700, "wdth", "InterVF")).toBe(100);
    expect(clampAxis(0, "wght", "SpaceGrotesk")).toBe(700);
  });
});

describe("axisSupported", () => {
  it("is false when min===max for that axis", () => {
    expect(axisSupported("wdth", "InterVF")).toBe(false);
    expect(axisSupported("wght", "RobotoFlex")).toBe(true);
    expect(axisSupported("slnt", "Recursive")).toBe(true);
  });
});

describe("setAxisStatic / setAxisRange", () => {
  const base = { wght: [700, 700], wdth: [100, 100], slnt: [0, 0] } as const;
  it("setAxisStatic writes [v,v] clamped", () => {
    expect(setAxisStatic(base, "wght", 5000, "RobotoFlex").wght).toEqual([1000, 1000]);
  });
  it("setAxisRange writes [start,end] clamped", () => {
    expect(setAxisRange(base, "wght", 100, 900, "RobotoFlex").wght).toEqual([100, 900]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- typography-axes`
Expected: FAIL — module `../typography-axes` not found.

- [ ] **Step 4: Implement the pure helpers**

Create `editor/typography-axes.ts`:

```ts
/**
 * Pure helpers for the panel's typography controls. The schema stores each
 * variable-font axis as a [start, end] tuple (animated across the beat).
 * The panel edits these as either a single static value ([v, v]) or an
 * animated range ([start, end]). Clamping uses the per-family bounds the
 * renderer already enforces (FONT_AXIS_BOUNDS in glyphs.ts).
 */
import { FONT_AXIS_BOUNDS } from "../src/kinetic/glyphs";
import type { FontFamily, AxisRanges } from "../src/kinetic/schema";

export type AxisKey = "wght" | "wdth" | "slnt";

export const axisBounds = (
  axis: AxisKey,
  family: FontFamily,
): [number, number] => FONT_AXIS_BOUNDS[family][axis];

export const clampAxis = (
  value: number,
  axis: AxisKey,
  family: FontFamily,
): number => {
  const [min, max] = axisBounds(axis, family);
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
};

/** An axis with a single supported value (min===max) can't be varied. */
export const axisSupported = (axis: AxisKey, family: FontFamily): boolean => {
  const [min, max] = axisBounds(axis, family);
  return max > min;
};

export const setAxisStatic = (
  axes: AxisRanges,
  axis: AxisKey,
  value: number,
  family: FontFamily,
): AxisRanges => {
  const v = clampAxis(value, axis, family);
  return { ...axes, [axis]: [v, v] };
};

export const setAxisRange = (
  axes: AxisRanges,
  axis: AxisKey,
  start: number,
  end: number,
  family: FontFamily,
): AxisRanges => ({
  ...axes,
  [axis]: [clampAxis(start, axis, family), clampAxis(end, axis, family)],
});

/** True when the stored tuple's two ends differ — i.e. it's animated. */
export const isAxisAnimated = (axes: AxisRanges, axis: AxisKey): boolean =>
  axes[axis][0] !== axes[axis][1];
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- typography-axes`
Expected: PASS (all assertions green).

- [ ] **Step 6: Add the per-beat Typography section to panel.tsx**

Add these imports to `editor/panel.tsx` (after existing imports):

```ts
import type { FontFamily, AxisRanges } from "../src/kinetic/schema";
import {
  type AxisKey,
  axisBounds,
  axisSupported,
  clampAxis,
  setAxisStatic,
  setAxisRange,
  isAxisAnimated,
} from "./typography-axes";
```

Add a `FONT_FAMILIES` const near the other const arrays (KINDS etc.):

```ts
const FONT_FAMILIES = [
  "SpaceGrotesk",
  "RobotoFlex",
  "Recursive",
  "InterVF",
  "Fraunces",
  "BricolageGrotesque",
  "InstrumentSans",
  "Archivo",
] as const;
```

Add a local `AxisControl` component above `BeatEditor`:

```tsx
const AxisControl: React.FC<{
  label: string;
  axis: AxisKey;
  axes: AxisRanges;
  family: FontFamily;
  onChange: (axes: AxisRanges) => void;
}> = ({ label, axis, axes, family, onChange }) => {
  const supported = axisSupported(axis, family);
  const [min, max] = axisBounds(axis, family);
  const animated = isAxisAnimated(axes, axis);
  const [start, end] = axes[axis];
  const step = axis === "slnt" ? 0.5 : 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Row label={label}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={start}
          disabled={!supported}
          onChange={(e) =>
            onChange(
              animated
                ? setAxisRange(axes, axis, Number(e.target.value), end, family)
                : setAxisStatic(axes, axis, Number(e.target.value), family),
            )
          }
          style={{ flex: 1, accentColor: color.text.primary, height: 4, opacity: supported ? 1 : 0.4 }}
        />
        <span style={{ width: 52, textAlign: "right", fontSize: 11, color: color.text.dim }}>
          {axis === "slnt" ? start.toFixed(1) : Math.round(start)}
        </span>
      </Row>
      {supported && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 88 }}>
          <label style={{ fontSize: 10, color: color.text.muted, display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={animated}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? setAxisRange(axes, axis, start, clampAxis(max, axis, family), family)
                    : setAxisStatic(axes, axis, start, family),
                )
              }
            />
            animate
          </label>
          {animated && (
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={end}
              onChange={(e) =>
                onChange(setAxisRange(axes, axis, start, Number(e.target.value), family))
              }
              style={{ flex: 1, accentColor: color.accent?.fg ?? color.text.primary, height: 4 }}
            />
          )}
        </div>
      )}
    </div>
  );
};
```

Then inside `BeatEditor`'s returned `<Section>`, after the `color`/`blend`
rows (before the morph/video/image conditionals), insert a Typography group.
Compute the effective family at the top of `BeatEditor` after the `if (!beat)`
guard:

```tsx
  const family: FontFamily = beat.fontFamily ?? fallbackFontFamily;
```

(Will require passing `fallbackFontFamily` into `BeatEditor` — add it to the
props and pass `story.fontFamily` from `Panel`.)

Insert these rows:

```tsx
      <Row label="font">
        <Dropdown
          value={beat.fontFamily ?? fallbackFontFamily}
          options={FONT_FAMILIES}
          onChange={(v) => onChange({ fontFamily: v as FontFamily })}
        />
      </Row>
      <AxisControl
        label="weight"
        axis="wght"
        axes={beat.axes}
        family={family}
        onChange={(axes) => onChange({ axes })}
      />
      <AxisControl
        label="width"
        axis="wdth"
        axes={beat.axes}
        family={family}
        onChange={(axes) => onChange({ axes })}
      />
      <AxisControl
        label="slant"
        axis="slnt"
        axes={beat.axes}
        family={family}
        onChange={(axes) => onChange({ axes })}
      />
```

- [ ] **Step 7: Thread fallbackFontFamily through BeatEditor**

Change `BeatEditor`'s props type to add `fallbackFontFamily: FontFamily;`
and update the `Panel` call site (currently passes `fallbackTextColor`) to
also pass `fallbackFontFamily={story.fontFamily}`.

- [ ] **Step 8: Add story-level font dropdown**

In `StoryEditor`, inside the "Palette & background" `<Section>`, add as the
first row:

```tsx
        <Row label="font">
          <Dropdown
            value={story.fontFamily}
            options={FONT_FAMILIES}
            onChange={(v) => patchStory({ fontFamily: v as Story["fontFamily"] })}
          />
        </Row>
```

- [ ] **Step 9: Typecheck + test**

Run: `npx tsc --noEmit -p tsconfig.json` (expect no new errors from panel.tsx/typography-axes.ts)
Run: `npm run test`
Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add editor/typography-axes.ts editor/__tests__/typography-axes.test.ts vitest.config.ts editor/panel.tsx
git commit -m "feat(studio): typography controls — font family + variable axes in panel"
```

---

## Task 2: Header path opens Finder

**Files:** Modify `editor/canvases/kinetic/KineticApp.tsx` (~line 567-577).

- [ ] **Step 1: Make the path span a clickable reveal button**

Replace the `<span>{project.path}</span>` block (the one with `marginLeft: "auto"`) with a clickable element. Browser mode (path `"(browser mode)"`) stays non-clickable:

```tsx
          <span
            onClick={() => {
              if (!isTauri()) return;
              void (async () => {
                try {
                  const { invoke } = await import("@tauri-apps/api/core");
                  await invoke("project_reveal", { path: project.path });
                } catch {
                  /* best-effort */
                }
              })();
            }}
            title={isTauri() ? "Reveal in Finder" : undefined}
            style={{
              marginLeft: "auto",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              cursor: isTauri() ? "pointer" : "default",
              textDecoration: "none",
            }}
            onMouseEnter={(e) => {
              if (isTauri()) e.currentTarget.style.textDecoration = "underline";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.textDecoration = "none";
            }}
          >
            {project.path}
          </span>
```

- [ ] **Step 2: Verify build + manual**

Run: `npx tsc --noEmit -p tsconfig.json`
Manual (after `npm run tauri:dev`): click the path → Finder opens the folder.

- [ ] **Step 3: Commit**

```bash
git add editor/canvases/kinetic/KineticApp.tsx
git commit -m "feat(studio): clicking the project path reveals the folder in Finder"
```

---

## Task 3: Hide the white terminal scrollbar

**Files:** Modify `editor/terminal.tsx`.

- [ ] **Step 1: Inject scoped scrollbar CSS once**

In `terminal.tsx`, add a module-level style injector that runs once. Near the
top (after imports), add:

```ts
/** Hide xterm's native viewport scrollbar (a bright bar over the dark UI).
 *  Scrolling via wheel/keys still works — we only hide the visual track. */
const SCROLLBAR_STYLE_ID = "kinetic-terminal-scrollbar-style";
const ensureScrollbarStyle = () => {
  if (typeof document === "undefined") return;
  if (document.getElementById(SCROLLBAR_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = SCROLLBAR_STYLE_ID;
  el.textContent = `
[data-terminal-root] .xterm-viewport { scrollbar-width: none; }
[data-terminal-root] .xterm-viewport::-webkit-scrollbar { width: 0; height: 0; }
`;
  document.head.appendChild(el);
};
```

Then call `ensureScrollbarStyle();` as the first line inside the `useEffect`
(before `if (!hostRef.current) return;`).

- [ ] **Step 2: Verify manually**

Run `npm run tauri:dev`, scroll the terminal with the wheel — content scrolls,
no white bar.

- [ ] **Step 3: Commit**

```bash
git add editor/terminal.tsx
git commit -m "fix(studio): hide xterm's white scrollbar in the terminal pane"
```

---

## Task 4: Chat toolbar cleanup + Chat label shows agent

**Files:** Modify `editor/agent-chat/SessionToolbar.tsx`, `editor/canvases/kinetic/KineticApp.tsx`.

- [ ] **Step 1: Remove the agent/path line from SessionToolbar**

Replace `SessionToolbar.tsx`'s body so only the Clear button remains
(right-aligned). Keep the `Props` interface as-is (callers still pass
`agentLabel`/`cwd` — unused now, but removing them ripples; keep them):

```tsx
import React from "react";

interface Props {
  agentLabel: string;
  cwd: string;
  onEndSession: () => void;
  sessionAlive: boolean;
}

export const SessionToolbar: React.FC<Props> = ({
  onEndSession,
  sessionAlive,
}) => {
  if (!sessionAlive) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        padding: "6px 10px",
        borderBottom: "1px solid #2a2a36",
        background: "#0e0e16",
      }}
    >
      <button
        onClick={onEndSession}
        style={{
          padding: "3px 8px",
          borderRadius: 4,
          border: "1px solid #3a3a48",
          background: "transparent",
          color: "#cdcdd8",
          cursor: "pointer",
          fontFamily: "system-ui, -apple-system, Helvetica Neue, sans-serif",
          fontSize: 12,
        }}
      >
        Clear
      </button>
    </div>
  );
};
```

- [ ] **Step 2: Chat toggle label shows agent name**

In `KineticApp.tsx`, the Chat toggle button currently renders the text `Chat`.
Replace its child with the agent-suffixed label. The button is the second of
the two toggle buttons (~line 742-756). Change its inner text from `Chat` to:

```tsx
                  {`Chat · ${agentLabelFor(defaultAgentId ?? "claude")}`}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit -p tsconfig.json`

- [ ] **Step 4: Commit**

```bash
git add editor/agent-chat/SessionToolbar.tsx editor/canvases/kinetic/KineticApp.tsx
git commit -m "feat(studio): chat label shows current agent; drop redundant toolbar line"
```

---

## Task 5: MP4 export

**Files:** Modify `src-tauri/src/video.rs`, `src-tauri/src/lib.rs`, `editor/canvases/kinetic/KineticApp.tsx`.

- [ ] **Step 1: Add `export_video` Rust command**

In `src-tauri/src/video.rs`, add after `download_youtube`. It resolves the
active project, finds the Remotion CLI (project-local
`node_modules/.bin/remotion`, else `npx remotion`), spawns a render of the
`KineticStory` composition with the project's `story.json` as props, writing
to `<project>/export-N.mp4`. Streams progress like yt-dlp.

```rust
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub id: String,
    pub line: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportDone {
    pub id: String,
    pub path: String,
}

/// Directory containing remotion.config.ts + the composition (the app/repo
/// root). The render must run from here so Remotion finds its entrypoint.
/// In dev this is the current working directory of the Tauri process; in a
/// bundled app the composition is shipped as resources. For the BYOA spike
/// we resolve the repo root via the current exe's ancestors looking for
/// remotion.config.ts, falling back to CARGO_MANIFEST_DIR's parent.
fn remotion_root(app: &AppHandle) -> Result<PathBuf, String> {
    // Bundled: resources dir holds the composition.
    if let Ok(res) = app
        .path()
        .resolve("", tauri::path::BaseDirectory::Resource)
    {
        if res.join("remotion.config.ts").exists() {
            return Ok(res);
        }
    }
    // Dev: walk up from the manifest dir to find remotion.config.ts.
    let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for _ in 0..4 {
        if dir.join("remotion.config.ts").exists() {
            return Ok(dir);
        }
        if let Some(parent) = dir.parent() {
            dir = parent.to_path_buf();
        } else {
            break;
        }
    }
    Err("could not locate remotion.config.ts (render root)".into())
}

#[tauri::command]
pub fn export_video(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    let project = active_path(&state)?;
    let story = project.join("story.json");
    if !story.exists() {
        return Err(format!("story.json not found in {}", project.display()));
    }
    let root = remotion_root(&app)?;
    let out = unique_assets_path(&project, "export.mp4");

    let id = uuid::Uuid::new_v4().to_string();
    let id_for_thread = id.clone();
    let app_for_thread = app.clone();
    let out_path = out.to_string_lossy().to_string();
    let out_done = out_path.clone();

    thread::spawn(move || {
        // Prefer project-local remotion bin; fall back to npx.
        let local_bin = root.join("node_modules/.bin/remotion");
        let (program, base_args): (PathBuf, Vec<String>) = if local_bin.exists() {
            (local_bin, vec!["render".into()])
        } else {
            (PathBuf::from("npx"), vec!["remotion".into(), "render".into()])
        };

        let mut cmd = Command::new(&program);
        cmd.current_dir(&root)
            .args(&base_args)
            .arg("KineticStory")
            .arg(&out_path)
            .arg(format!("--props={}", story.to_string_lossy()))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = app_for_thread.emit(
                    "video://export-error",
                    ExportProgress { id: id_for_thread.clone(), line: format!("spawn failed: {}", e) },
                );
                return;
            }
        };

        let stdout = child.stdout.take().expect("piped");
        let stderr = child.stderr.take().expect("piped");
        let a1 = app_for_thread.clone();
        let i1 = id_for_thread.clone();
        let a2 = app_for_thread.clone();
        let i2 = id_for_thread.clone();

        let h1 = thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = a1.emit("video://export-progress", ExportProgress { id: i1.clone(), line });
            }
        });
        let h2 = thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let _ = a2.emit("video://export-progress", ExportProgress { id: i2.clone(), line });
            }
        });
        let _ = h1.join();
        let _ = h2.join();

        match child.wait() {
            Ok(s) if s.success() && Path::new(&out_done).exists() => {
                let _ = app_for_thread.emit(
                    "video://export-done",
                    ExportDone { id: id_for_thread, path: out_done },
                );
            }
            Ok(s) => {
                let _ = app_for_thread.emit(
                    "video://export-error",
                    ExportProgress { id: id_for_thread.clone(), line: format!("remotion exited {}", s) },
                );
            }
            Err(e) => {
                let _ = app_for_thread.emit(
                    "video://export-error",
                    ExportProgress { id: id_for_thread.clone(), line: format!("wait failed: {}", e) },
                );
            }
        }
    });

    Ok(id)
}
```

- [ ] **Step 2: Register the command**

In `src-tauri/src/lib.rs`, add `video::export_video,` to the
`generate_handler!` list (next to the other `video::` entries).

- [ ] **Step 3: Build the Rust side**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: compiles (warnings ok). If `active_path`/`unique_assets_path` are
private, they're in the same module, so visible — no change needed.

- [ ] **Step 4: Add the Export button + progress to the editor header**

In `KineticApp.tsx`'s `EditorView`, add export state near the other useState
hooks:

```tsx
  const [exporting, setExporting] = useState<string | null>(null); // last progress line, or null
  const exportIdRef = useRef<string | null>(null);
```

Add a handler (near `shellActions` useMemo or above the return):

```tsx
  const onExport = useCallback(() => {
    if (!isTauri() || exportIdRef.current) return;
    setExporting("starting render…");
    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");
      let offProg: undefined | (() => void);
      let offDone: undefined | (() => void);
      let offErr: undefined | (() => void);
      const cleanup = () => {
        offProg?.(); offDone?.(); offErr?.();
        exportIdRef.current = null;
      };
      try {
        const id = await invoke<string>("export_video");
        exportIdRef.current = id;
        offProg = await listen<{ id: string; line: string }>(
          "video://export-progress",
          (e) => { if (e.payload.id === id) setExporting(e.payload.line); },
        );
        offDone = await listen<{ id: string; path: string }>(
          "video://export-done",
          async (e) => {
            if (e.payload.id !== id) return;
            setExporting(null);
            cleanup();
            try {
              await invoke("project_reveal", { path: e.payload.path });
            } catch { /* best-effort */ }
          },
        );
        offErr = await listen<{ id: string; line: string }>(
          "video://export-error",
          (e) => {
            if (e.payload.id !== id) return;
            setExporting(null);
            setError(`Export failed: ${e.payload.line}`);
            cleanup();
          },
        );
      } catch (e) {
        setExporting(null);
        setError(`Export failed to start: ${(e as Error).message}`);
        cleanup();
      }
    })();
  }, []);
```

Add the button in the header, before the path span (after the project name
span at ~line 567):

```tsx
          {isTauri() && (
            <button
              onClick={onExport}
              disabled={exporting !== null}
              style={{ ...secondaryBtn({ active: exporting !== null }), cursor: exporting ? "default" : "pointer" }}
              title="Render this composition to an MP4"
            >
              {exporting ? "Exporting…" : "Export"}
            </button>
          )}
```

Add a transient progress line under the header (reusing error-banner style),
right after the `{error && (...)}` block:

```tsx
        {exporting && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              background: color.bg.raised,
              borderBottom: `1px solid ${color.border.line}`,
              color: color.text.muted,
              fontSize: font.size.sm,
              fontFamily: "ui-monospace, monospace",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              flex: "0 0 auto",
            }}
          >
            <span>⏳ {exporting}</span>
          </div>
        )}
```

- [ ] **Step 5: Build/typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Run: `cargo build --manifest-path src-tauri/Cargo.toml`

- [ ] **Step 6: Manual end-to-end**

`npm run tauri:dev`, open a project, click Export. Watch the progress line;
on completion Finder opens showing `export.mp4`. Play it — matches the editor.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/video.rs src-tauri/src/lib.rs editor/canvases/kinetic/KineticApp.tsx
git commit -m "feat(studio): export the composition to MP4 via Remotion"
```

---

## Task 6: Bundle four more variable fonts

**Files:** `public/fonts/*.ttf` (new), `src/kinetic/schema.ts`, `src/kinetic/glyphs.ts`.

- [ ] **Step 1: Download the variable TTFs into public/fonts/**

Fetch the official variable TTFs (SIL OFL). Use these source URLs (Google
Fonts GitHub raw, which serve the variable `[axes].ttf`):

```bash
cd public/fonts
curl -L -o Fraunces.ttf "https://github.com/google/fonts/raw/main/ofl/fraunces/Fraunces%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf"
curl -L -o BricolageGrotesque.ttf "https://github.com/google/fonts/raw/main/ofl/bricolagegrotesque/BricolageGrotesque%5Bopsz%2Cwdth%2Cwght%5D.ttf"
curl -L -o InstrumentSans.ttf "https://github.com/google/fonts/raw/main/ofl/instrumentsans/InstrumentSans%5Bwdth%2Cwght%5D.ttf"
curl -L -o Archivo.ttf "https://github.com/google/fonts/raw/main/ofl/archivo/Archivo%5Bwdth%2Cwght%5D.ttf"
cd ../..
```

Verify each file is a real TTF (not an HTML 404):

```bash
file public/fonts/Fraunces.ttf public/fonts/BricolageGrotesque.ttf public/fonts/InstrumentSans.ttf public/fonts/Archivo.ttf
```

Expected: each reported as "TrueType Font" / "OpenType font". If any is HTML
or tiny (<10 KB), the URL changed — find the current variable TTF on Google
Fonts' repo and retry before proceeding.

- [ ] **Step 2: Extend the schema enum**

In `src/kinetic/schema.ts`, change `fontFamilySchema`:

```ts
export const fontFamilySchema = z
  .enum([
    "SpaceGrotesk",
    "RobotoFlex",
    "Recursive",
    "InterVF",
    "Fraunces",
    "BricolageGrotesque",
    "InstrumentSans",
    "Archivo",
  ])
  .describe("Typeface");
```

- [ ] **Step 3: Add registry + axis bounds in glyphs.ts**

In `FONT_REGISTRY` add:

```ts
  Fraunces: { file: "fonts/Fraunces.ttf", cssFamily: "FrauncesKinetic" },
  BricolageGrotesque: { file: "fonts/BricolageGrotesque.ttf", cssFamily: "BricolageGrotesqueKinetic" },
  InstrumentSans: { file: "fonts/InstrumentSans.ttf", cssFamily: "InstrumentSansKinetic" },
  Archivo: { file: "fonts/Archivo.ttf", cssFamily: "ArchivoKinetic" },
```

In `FONT_AXIS_BOUNDS` add (real ranges from each font's axis registration):

```ts
  Fraunces: { wght: [100, 900], wdth: [100, 100], slnt: [0, 0] }, // opsz/SOFT/WONK present but we vary wght
  BricolageGrotesque: { wght: [200, 800], wdth: [75, 100], slnt: [0, 0] },
  InstrumentSans: { wght: [400, 700], wdth: [75, 100], slnt: [0, 0] },
  Archivo: { wght: [100, 900], wdth: [62, 125], slnt: [0, 0] },
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors (the panel's `FONT_FAMILIES` already lists these keys).

- [ ] **Step 5: Manual font verification**

`npm run tauri:dev`, select a beat, switch font to each new family, confirm
it renders (no blank/box glyphs) and the weight slider changes the look.
opentype.js must parse each for the morph beat — if a font throws on parse,
note it; static rendering still works for non-morph beats.

- [ ] **Step 6: Commit**

```bash
git add public/fonts/Fraunces.ttf public/fonts/BricolageGrotesque.ttf public/fonts/InstrumentSans.ttf public/fonts/Archivo.ttf src/kinetic/schema.ts src/kinetic/glyphs.ts
git commit -m "feat(studio): bundle Fraunces, Bricolage Grotesque, Instrument Sans, Archivo variable fonts"
```

---

## Task 7: Design-system research doc

**Files:** Create `docs/design-systems-recommendation.md`.

- [ ] **Step 1: Research and write the doc**

Produce `docs/design-systems-recommendation.md` covering Radix UI / shadcn-ui,
Base UI (MUI headless), Ark UI (Chakra headless), Mantine, and Park UI.
For each: component coverage (dropdown, slider, drawer, dialog, tabs, tooltip,
combobox, etc.), styling model (headless vs styled), theming approach, bundle
footprint, React 19 support, and migration cost from the current inline-style
approach (see `editor/platform/theme.ts`, `editor/controls.tsx`). Constraints
to weigh: Tauri Chromium webview (modern CSS fine), dark dense pro-tool look,
no Tailwind today. End with a single recommendation and a phased adoption
path that reuses the existing `theme.ts` tokens. Include links to each
library's docs and component catalog.

- [ ] **Step 2: Commit**

```bash
git add docs/design-systems-recommendation.md
git commit -m "docs: design-system / component-library recommendation"
```

---

## Final verification

- [ ] Run `npm run test` — all green.
- [ ] Run `npx tsc --noEmit -p tsconfig.json` — no new errors.
- [ ] Run `cargo build --manifest-path src-tauri/Cargo.toml` — compiles.
- [ ] Manual smoke in `npm run tauri:dev`: typography sliders, font switch,
      export, Finder reveal, terminal scroll (no white bar), chat label, chat
      toolbar.
