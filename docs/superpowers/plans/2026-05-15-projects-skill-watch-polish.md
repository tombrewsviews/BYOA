# Studio v2 — Projects, Skill, Watch & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the kinetic studio actually usable as a desktop tool: fix the bug where agent edits to `story.json` don't show in the UI, add resizable panels and a native color picker, introduce a projects home view with `~/KineticStudio/<project>` storage, and install a per-project agent skill so `claude` in the embedded terminal stays focused on `story.json` instead of running superpowers prompts.

**Architecture:** Four phases shipped sequentially.
- **A — File watch + conflict reconciliation.** `notify` watcher on `story.json` in Rust; on change, emit `story://changed`; React reloads; merge conflicts go back to the agent's PTY as a paste prompt.
- **B — UX polish.** Drag-handle resizable panels with localStorage persistence, transport moved below preview, native `<input type="color">` swatch (no custom popover).
- **C — Projects mode.** `AppShell` switches between `ProjectsView` and `EditorView`; Rust `AppState` gains `active_project`; story commands and PTY scope to it; new project / open folder flows; recents.
- **D — Agent skill.** Per-project `.kinetic-studio/skill.md` + `rc.zsh` writing a `claude` alias that injects `--append-system-prompt`.

**Tech Stack:** Tauri 2, Rust (notify, notify-debouncer-mini, trash, slug, serde, dashmap, portable-pty, uuid), React 19, TypeScript, Vite 6.

**Spec:** `docs/superpowers/specs/2026-05-15-projects-skill-watch-polish.md`

**Repo state at plan start:** HEAD = `828f9ed` (end of the Tauri migration). Working tree clean.

---

## File map

```
src-tauri/
  Cargo.toml                  + notify, notify-debouncer-mini, trash,
                                slug, tauri-plugin-dialog
  src/
    lib.rs                    AppState extended (active_project, home_dir);
                              new command registrations across phases
    story.rs                  reads/writes <active_project>/story.json
    pty.rs                    spawn with KINETIC_PROJECT env;
                              + pty_paste_prompt command
    projects.rs    NEW (C)    projects_list / projects_create /
                              project_open / project_close
    watch.rs       NEW (A)    spawn_watcher / shutdown_watcher
    skill.rs       NEW (D)    SKILL_TEMPLATE + RC_ZSH consts;
                              write_skill(project_path)
    seed.rs        NEW (C)    SEED_STORY const for new projects
  templates/
    skill.md       NEW (D)    agent skill body (included via include_str!)
    rc.zsh         NEW (D)    shell rc body (included via include_str!)
    seed-story.json NEW (C)   bundled starter story

editor/
  App.tsx                     phase A: external-change listener,
                              merge logic; phase B: transport position
                              & resize CSS vars; phase C: route to
                              AppShell
  AppShell.tsx   NEW (C)      mode switch: projects | editor
  ProjectsView.tsx NEW (C)    home view (cards, new, open folder)
  ProjectCard.tsx  NEW (C)    single card
  diff.ts          NEW (A)    story-shape diff helpers
  resize.ts        NEW (B)    divider-drag hook
  controls.tsx                phase B: ColorControl rewrite
  panel.tsx                   no change (ColorControl is a prop)
  terminal.tsx                phase D: shell env tweaks via Rust;
                              phase C: nothing
  player.tsx                  no change
  timeline.tsx                no change
  runtime.ts                  no change

package.json                  no new frontend deps in phases A/B
                              phase C: + @tauri-apps/plugin-dialog
README.md                     phase C/D additions
```

---

# Phase A — File watch + conflict reconciliation

The bug fix. After this phase, agent edits to story.json reflect in the UI within ~300 ms. The "agent says Done but UI is stale" complaint is gone.

## Task 1: Rust file-watcher module (no UI yet)

Add the `notify-debouncer-mini` dep and create `src-tauri/src/watch.rs` exposing `spawn(path, app)` that watches a file and emits `story://changed`. Not wired in yet.

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/watch.rs`

- [ ] **Step 1: Add deps**

Edit `/Users/parandykt/Remotion Tests/src-tauri/Cargo.toml`. In `[dependencies]`, append:

```toml
notify = "6"
notify-debouncer-mini = "0.4"
```

- [ ] **Step 2: Create `watch.rs`**

Write `/Users/parandykt/Remotion Tests/src-tauri/src/watch.rs`:

```rust
//! Filesystem watcher for the active project's story.json.
//!
//! Uses notify-debouncer-mini so the tmp+rename pattern used by
//! save_story doesn't double-fire. The watcher runs on its own
//! thread (debouncer-mini owns it); calling `shutdown` drops the
//! debouncer which stops the thread.

use std::path::PathBuf;
use std::time::Duration;

use notify_debouncer_mini::{
    new_debouncer, notify::RecursiveMode, DebounceEventResult, Debouncer,
};
use tauri::{AppHandle, Emitter};

pub type StoryWatcher = Debouncer<notify::RecommendedWatcher>;

pub fn spawn(path: PathBuf, app: AppHandle) -> Result<StoryWatcher, String> {
    let path_for_handler = path.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(200),
        move |res: DebounceEventResult| match res {
            Ok(events) => {
                if events.iter().any(|e| e.path == path_for_handler) {
                    let _ = app.emit::<()>("story://changed", ());
                }
            }
            Err(_) => {
                // Errors are non-fatal — most are transient. Don't
                // panic the watcher thread.
            }
        },
    )
    .map_err(|e| format!("watcher: {}", e))?;

    debouncer
        .watcher()
        .watch(&path, RecursiveMode::NonRecursive)
        .map_err(|e| format!("watch path: {}", e))?;

    Ok(debouncer)
}
```

- [ ] **Step 3: Register the module**

Edit `/Users/parandykt/Remotion Tests/src-tauri/src/lib.rs`. Add at the top with the other `mod` declarations:

```rust
mod watch;
```

(Keep `mod pty;` and `mod story;` already present.)

- [ ] **Step 4: Build**

```bash
cd "/Users/parandykt/Remotion Tests/src-tauri" && cargo check
```

Expected: compiles clean. First run downloads `notify` and `notify-debouncer-mini` (~30 s).

- [ ] **Step 5: Commit**

```bash
cd "/Users/parandykt/Remotion Tests"
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/src/watch.rs
git -c user.email=studio@local -c user.name="v2 Implementer" commit -m "feat(tauri): add story.json watcher module"
```

---

## Task 2: Wire the watcher into AppState + start it at startup

Phase A is shipping before projects mode (Phase C), so the watcher works against the hardcoded current-repo story.json. After Phase C the watcher will be (re)started on `project_open` instead. For now, it starts in `run()` on the resolved `project_root`.

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Extend AppState**

Edit `/Users/parandykt/Remotion Tests/src-tauri/src/lib.rs`. Replace the file with:

```rust
//! Tauri 2 entry: app state, command registration, plugin init.

mod pty;
mod story;
mod watch;

use std::path::PathBuf;
use std::sync::Mutex;

use dashmap::DashMap;

pub struct AppState {
    pub project_root: PathBuf,
    pub ptys: DashMap<String, pty::PtySession>,
    pub watcher: Mutex<Option<watch::StoryWatcher>>,
}

fn resolve_project_root() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir)
        .parent()
        .expect("src-tauri has a parent")
        .to_path_buf()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let project_root = resolve_project_root();
    let state = AppState {
        project_root: project_root.clone(),
        ptys: DashMap::new(),
        watcher: Mutex::new(None),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .setup(move |app| {
            let story_path = project_root.join("story.json");
            match watch::spawn(story_path, app.handle().clone()) {
                Ok(w) => {
                    let state = app.state::<AppState>();
                    *state.watcher.lock().unwrap() = Some(w);
                }
                Err(e) => {
                    eprintln!("[watch] startup failed: {}", e);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            story::save_story,
            story::load_story,
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

The key additions: `watcher: Mutex<Option<watch::StoryWatcher>>` on AppState, and a `.setup(...)` closure that spawns the watcher and stashes it. Stashing matters because dropping the debouncer stops the watcher thread.

- [ ] **Step 2: Build**

```bash
cd "/Users/parandykt/Remotion Tests/src-tauri" && cargo check
```

Expected: compiles clean.

- [ ] **Step 3: Commit**

```bash
cd "/Users/parandykt/Remotion Tests"
git add src-tauri/src/lib.rs
git -c user.email=studio@local -c user.name="v2 Implementer" commit -m "feat(tauri): start story.json watcher on app startup"
```

---

## Task 3: Story-diff utility (frontend)

A small typed module that computes the shape-aware diff used by the conflict reconciliation in Task 4. Pure functions, no React.

**File:**
- Create: `editor/diff.ts`

- [ ] **Step 1: Create the file**

Write `/Users/parandykt/Remotion Tests/editor/diff.ts`:

```ts
/**
 * Story-shape diff: compute the set of fields that differ between two
 * Story values, and merge per-field changes from two sides on top of a
 * common base.
 *
 * Why field-level (not deep JSON diff): the studio thinks about the
 * story in flat-ish fields the panel exposes. A "field" here is one of:
 *
 *   "bgColor" | "bgColor2" | "textColor" | "accentColor" | "accent2Color"
 *   "fontSize" | "glowIntensity" | "background"
 *   "beat:<i>:<key>"
 *   "beats:length"     (special — only differs if array lengths differ)
 *
 * The Panel UI maps each control to exactly one of these field keys, so
 * a per-field merge is faithful to user intent without needing array
 * reconciliation.
 */
import type { Story, Beat } from "../src/kinetic/schema";

export type FieldKey =
  | "bgColor"
  | "bgColor2"
  | "textColor"
  | "accentColor"
  | "accent2Color"
  | "fontSize"
  | "glowIntensity"
  | "background"
  | "beats:length"
  | `beat:${number}:${keyof Beat & string}`;

const STORY_SCALARS = [
  "bgColor",
  "bgColor2",
  "textColor",
  "accentColor",
  "accent2Color",
  "fontSize",
  "glowIntensity",
] as const;

const BEAT_KEYS: Array<keyof Beat & string> = [
  "text",
  "kind",
  "durationInSeconds",
  "easing",
  "direction",
  "dynamics",
  "staggerSeconds",
  "animateInPortion",
  "scale",
  "glow",
  "color",
  "shape",
];

const eq = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export const diffFields = (a: Story, b: Story): Set<FieldKey> => {
  const changed = new Set<FieldKey>();

  for (const k of STORY_SCALARS) {
    if (!eq(a[k], b[k])) changed.add(k);
  }
  if (!eq(a.background, b.background)) changed.add("background");
  if (a.beats.length !== b.beats.length) changed.add("beats:length");

  const minLen = Math.min(a.beats.length, b.beats.length);
  for (let i = 0; i < minLen; i++) {
    for (const key of BEAT_KEYS) {
      if (!eq(a.beats[i][key], b.beats[i][key])) {
        changed.add(`beat:${i}:${key}`);
      }
    }
  }
  return changed;
};

/**
 * Apply field-level changes from `from` onto `base`, but only for the
 * fields named in `fields`. Returns a new Story.
 */
export const applyFields = (
  base: Story,
  from: Story,
  fields: Set<FieldKey>,
): Story => {
  let next: Story = { ...base, beats: [...base.beats] };

  for (const f of fields) {
    if (f === "background") {
      next = { ...next, background: from.background };
    } else if (f === "beats:length") {
      next = { ...next, beats: [...from.beats] };
    } else if (f.startsWith("beat:")) {
      const [, idxStr, key] = f.split(":");
      const i = Number(idxStr);
      if (Number.isNaN(i) || i >= next.beats.length) continue;
      const k = key as keyof Beat;
      const updated: Beat = { ...next.beats[i], [k]: from.beats[i]?.[k] };
      next.beats = next.beats.map((b, idx) => (idx === i ? updated : b));
    } else {
      const k = f as (typeof STORY_SCALARS)[number];
      next = { ...next, [k]: from[k] } as Story;
    }
  }
  return next;
};

/** Read a field value from a story (for the conflict prompt text). */
export const readField = (s: Story, f: FieldKey): unknown => {
  if (f === "background") return s.background;
  if (f === "beats:length") return s.beats.length;
  if (f.startsWith("beat:")) {
    const [, idxStr, key] = f.split(":");
    const i = Number(idxStr);
    return s.beats[i]?.[key as keyof Beat];
  }
  return s[f as (typeof STORY_SCALARS)[number]];
};

/** Human-readable line for the conflict prompt. */
export const fieldLabel = (f: FieldKey): string => {
  if (f.startsWith("beat:")) {
    const [, idxStr, key] = f.split(":");
    return `beats[${idxStr}].${key}`;
  }
  if (f === "beats:length") return "beats (length)";
  return `story.${f}`;
};
```

- [ ] **Step 2: Type-check**

```bash
cd "/Users/parandykt/Remotion Tests" && npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add editor/diff.ts
git -c user.email=studio@local -c user.name="v2 Implementer" commit -m "feat(editor): add story-diff utility for conflict reconciliation"
```

---

## Task 4: Frontend external-change listener + merge

Wire `story://changed` into App.tsx. On each event: refetch, then either trivially apply (no local edits), auto-merge (no conflicts), or paste a conflict prompt into the active PTY.

**Files:**
- Modify: `editor/App.tsx`
- Modify: `src-tauri/src/pty.rs` — add `pty_paste_prompt` command
- Modify: `src-tauri/src/lib.rs` — register the new command
- Modify: `editor/terminal.tsx` — expose the active session id

### Step 1: Add a session-id store in terminal.tsx

The current `terminal.tsx` keeps `sessionId` inside the useEffect closure. We need App.tsx to know it so it can target the paste prompt. Use a module-level `Map<string, true>` keyed by session id — but the simpler approach: a tiny module-scope mutable `currentPtyId`.

Edit `/Users/parandykt/Remotion Tests/editor/terminal.tsx`. Find the line just under the imports (after the `import "xterm/css/xterm.css";` line). Add:

```ts
/**
 * Exposed for App.tsx so the merge-conflict flow can paste a prompt
 * into the live terminal. Single-pty-at-a-time, so a module mutable
 * is fine; refactor when multi-tab terminals arrive.
 */
let _activePtyId: string | null = null;
export const getActivePtyId = (): string | null => _activePtyId;
```

Then inside the `useEffect`, when `sessionId` is successfully assigned, add an assignment immediately after `sessionId = await invoke<string>("pty_open", ...)` succeeds:

```ts
sessionId = await invoke<string>("pty_open", { /* ... */ });
_activePtyId = sessionId;
```

And in the cleanup that pushes `pty_close`, clear it:

```ts
async () => {
  try {
    await invoke("pty_close", { id: sessionId });
  } catch {
    /* already gone — ignore */
  }
  if (_activePtyId === sessionId) _activePtyId = null;
},
```

- [ ] **Step 2: Add `pty_paste_prompt` Rust command**

Edit `/Users/parandykt/Remotion Tests/src-tauri/src/pty.rs`. Append the following command at the end of the file:

```rust
/// Inject text directly into a PTY's master side — the connected
/// shell sees it as if the user typed it. We do NOT append a newline;
/// the user reviews and presses Enter themselves so an in-flight agent
/// turn isn't interrupted.
#[tauri::command]
pub fn pty_paste_prompt(
    id: String,
    text: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = state
        .ptys
        .get(&id)
        .ok_or_else(|| format!("no pty session: {}", id))?;
    let mut writer = session.writer.lock().map_err(|e| e.to_string())?;
    writer
        .write_all(text.as_bytes())
        .map_err(|e| format!("write: {}", e))?;
    Ok(())
}
```

- [ ] **Step 3: Register the command**

Edit `/Users/parandykt/Remotion Tests/src-tauri/src/lib.rs`. In the `invoke_handler!` macro list, add `pty::pty_paste_prompt,` after `pty::pty_close,`. The block now reads:

```rust
.invoke_handler(tauri::generate_handler![
    story::save_story,
    story::load_story,
    pty::pty_open,
    pty::pty_write,
    pty::pty_resize,
    pty::pty_close,
    pty::pty_paste_prompt,
])
```

- [ ] **Step 4: Build Rust side**

```bash
cd "/Users/parandykt/Remotion Tests/src-tauri" && cargo check
```

Expected: clean.

- [ ] **Step 5: Add the external-change handler in App.tsx**

Edit `/Users/parandykt/Remotion Tests/editor/App.tsx`. Add this import near the other relative imports:

```tsx
import { diffFields, applyFields, fieldLabel, readField, type FieldKey } from "./diff";
import { getActivePtyId } from "./terminal";
```

Find the existing `useEffect` that calls `load()`. Immediately AFTER it (still inside the `App` function), add a new effect:

```tsx
useEffect(() => {
  if (!isTauri()) return;
  let unlisten: undefined | (() => void);

  void (async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");
    const off = await listen<void>("story://changed", async () => {
      if (!storyRef.current) return;
      try {
        const text = await invoke<string>("load_story");
        const fresh = storySchema.parse(JSON.parse(text));
        const inMem = storyRef.current;
        const saved = JSON.parse(savedJsonRef.current) as typeof fresh;

        const userChanges = diffFields(saved, inMem);
        const agentChanges = diffFields(saved, fresh);

        if (userChanges.size === 0) {
          setStory(fresh);
          setSavedJson(JSON.stringify(fresh));
          return;
        }

        const conflicts = new Set<FieldKey>();
        const nonConflicting = new Set<FieldKey>();
        for (const f of userChanges) {
          if (agentChanges.has(f)) conflicts.add(f);
          else nonConflicting.add(f);
        }

        const merged = applyFields(fresh, inMem, nonConflicting);
        setStory(merged);

        // Flush merged result so non-conflicting user edits are on disk.
        const mergedJson = JSON.stringify(merged, null, 2);
        try {
          await invoke("save_story", { json: mergedJson });
          setSavedJson(JSON.stringify(merged));
        } catch (e) {
          setError(`Auto-merge save failed: ${(e as Error).message}`);
        }

        if (conflicts.size > 0) {
          const lines = [...conflicts].map((f) => {
            const a = JSON.stringify(readField(merged, f));
            const b = JSON.stringify(readField(inMem, f));
            return `  - ${fieldLabel(f)}: ${a} → ${b}`;
          });
          const prompt =
            "Apply my changes on top of yours:\n" + lines.join("\n") + "\n";

          const ptyId = getActivePtyId();
          if (ptyId) {
            await invoke("pty_paste_prompt", { id: ptyId, text: prompt });
          } else {
            setError(
              "Conflicts detected but terminal is not open — copy from console: " +
                prompt,
            );
            console.warn("[merge] no active pty for prompt:", prompt);
          }
        }
      } catch (e) {
        setError(`External reload failed: ${(e as Error).message}`);
      }
    });
    unlisten = () => off();
  })();

  return () => {
    if (unlisten) unlisten();
  };
}, []);
```

This effect depends on two refs we don't have yet: `storyRef` and `savedJsonRef`. Add them at the top of the `App` function body, RIGHT AFTER the existing `useState` declarations and BEFORE the `useEffect` that loads the story:

```tsx
const storyRef = useRef<typeof story>(null);
const savedJsonRef = useRef("");

useEffect(() => {
  storyRef.current = story;
}, [story]);

useEffect(() => {
  savedJsonRef.current = savedJson;
}, [savedJson]);
```

The refs hold the latest values for the long-lived event listener closure (which is created once and shouldn't have `story`/`savedJson` in its deps — that would tear it down and re-create it on every keystroke).

If `useRef` isn't imported, add it to the existing React import. The file currently imports `useCallback, useEffect, useMemo, useRef, useState` — `useRef` should already be there.

- [ ] **Step 6: Verify types compile**

```bash
cd "/Users/parandykt/Remotion Tests" && npx tsc --noEmit
```

Expected: exit 0. If you get `Cannot find name 'storyRef'`, the refs went into the wrong scope — move them inside `App`.

- [ ] **Step 7: Manual desktop verification**

You cannot drive the GUI as the implementer agent. Note for the user:

After the commit, the user should:
1. `npm run tauri:dev`.
2. Open `story.json` in a separate editor; change `bgColor` to `"#ff0000"`; save.
3. Confirm the studio's `bg` swatch turns red within ~1 s.
4. Drag the `font size` slider (don't click Save). Then externally bump `bgColor2` to `"#00ff00"`. Confirm: `bg end` updates to green, font size stays at the dragged value, no terminal paste.
5. Drag font size again. Externally change `fontSize` to 100. Confirm: terminal pane gets a paste with `story.fontSize: 100 → <your value>`; the studio's font size shows 100 now; user can hit Enter in the terminal to send to agent.

- [ ] **Step 8: Commit**

```bash
cd "/Users/parandykt/Remotion Tests"
git add editor/App.tsx editor/terminal.tsx src-tauri/src/pty.rs src-tauri/src/lib.rs
git -c user.email=studio@local -c user.name="v2 Implementer" commit -m "feat(editor): reload story on external change with conflict reconciliation"
```

---

# Phase B — UX polish

Three small visible changes. Each is its own task so they're easy to revert independently.

## Task 5: Move transport bar below preview

**File:**
- Modify: `editor/App.tsx`

- [ ] **Step 1: Move the JSX**

In `/Users/parandykt/Remotion Tests/editor/App.tsx`, find the preview-pane block (the div with `gridColumn: "2"`, `gridRow: "1"`). It currently has children in this order:
1. `<Transport ... />`
2. `<PlayerStage ... />`
3. The "N beats · Xs · 1080×1920" caption div.

Reorder to:
1. `<PlayerStage ... />`
2. The caption div.
3. `<Transport ... />`

The Transport block is unchanged in props or styling. Just move it.

- [ ] **Step 2: Type-check**

```bash
cd "/Users/parandykt/Remotion Tests" && npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add editor/App.tsx
git -c user.email=studio@local -c user.name="v2 Implementer" commit -m "feat(editor): move transport bar below preview"
```

---

## Task 6: Resizable panel dividers

CSS-variable-driven column widths with two drag handles. Widths persist in localStorage.

**Files:**
- Create: `editor/resize.ts`
- Modify: `editor/App.tsx`

- [ ] **Step 1: Create `resize.ts`**

Write `/Users/parandykt/Remotion Tests/editor/resize.ts`:

```ts
/**
 * Divider-drag hook for resizable side panels.
 *
 * Reads/writes a CSS custom property on `document.documentElement` so
 * the grid template picks up changes without a React re-render of
 * the panes. Persists to localStorage.
 *
 * Constraints are clamped during drag so the middle (preview/timeline)
 * column never shrinks below `minMiddle`.
 */
import { useEffect } from "react";

export type Side = "left" | "right";

type Opts = {
  side: Side;
  storageKey: string;
  cssVar: string;       // e.g. "--col-terminal"
  defaultPx: number;
  minPx: number;
  maxPx: number;
};

export const usePersistedColumnWidth = ({
  storageKey,
  cssVar,
  defaultPx,
  minPx,
  maxPx,
}: Opts) => {
  useEffect(() => {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    const initial = Number.isFinite(parsed)
      ? Math.max(minPx, Math.min(maxPx, parsed))
      : defaultPx;
    document.documentElement.style.setProperty(cssVar, `${initial}px`);
  }, [storageKey, cssVar, defaultPx, minPx, maxPx]);
};

/**
 * Begin a drag. Call from onMouseDown on the divider element. Returns
 * a cleanup that you typically don't need (mouseup auto-cleans).
 */
export const beginColumnDrag = (
  e: React.MouseEvent,
  opts: Opts,
): void => {
  e.preventDefault();
  const startX = e.clientX;
  const startPx = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue(opts.cssVar) ||
      `${opts.defaultPx}`,
    10,
  );

  const sign = opts.side === "left" ? 1 : -1;

  const onMove = (ev: MouseEvent) => {
    const delta = (ev.clientX - startX) * sign;
    const next = Math.max(opts.minPx, Math.min(opts.maxPx, startPx + delta));
    document.documentElement.style.setProperty(opts.cssVar, `${next}px`);
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    const finalPx = Number.parseInt(
      getComputedStyle(document.documentElement)
        .getPropertyValue(opts.cssVar)
        .trim(),
      10,
    );
    if (Number.isFinite(finalPx)) {
      localStorage.setItem(opts.storageKey, String(finalPx));
    }
  };

  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
};
```

- [ ] **Step 2: Convert App.tsx grid columns to CSS variables**

In `/Users/parandykt/Remotion Tests/editor/App.tsx`, find the outer shell `<div>` styled with `gridTemplateColumns: "360px 1fr 320px"`. Change to:

```tsx
gridTemplateColumns: "var(--col-terminal, 360px) 1fr var(--col-properties, 320px)",
```

- [ ] **Step 3: Add the hook calls + divider elements**

Near the top of `App` (with the other state), import and call the hook:

```tsx
import { beginColumnDrag, usePersistedColumnWidth } from "./resize";
```

Inside `App`, near the other hooks:

```tsx
usePersistedColumnWidth({
  side: "left",
  storageKey: "studio.col.terminal",
  cssVar: "--col-terminal",
  defaultPx: 360,
  minPx: 200,
  maxPx: 800,
});
usePersistedColumnWidth({
  side: "right",
  storageKey: "studio.col.properties",
  cssVar: "--col-properties",
  defaultPx: 320,
  minPx: 200,
  maxPx: 600,
});
```

Then in the grid JSX, add two divider divs. Place the LEFT divider as a new grid child positioned over the seam between col 1 and col 2; same for the RIGHT divider between col 2 and col 3. The cleanest way is to put them inside the col-1 and col-3 cells with absolute positioning on their right/left edges:

In the Terminal cell `<div>`, add as the FIRST child:

```tsx
<div
  onMouseDown={(e) =>
    beginColumnDrag(e, {
      side: "left",
      storageKey: "studio.col.terminal",
      cssVar: "--col-terminal",
      defaultPx: 360,
      minPx: 200,
      maxPx: 800,
    })
  }
  style={{
    position: "absolute",
    top: 0,
    bottom: 0,
    right: -2,
    width: 4,
    cursor: "col-resize",
    zIndex: 10,
  }}
/>
```

Also add `position: "relative"` to the Terminal cell's style if it isn't already there.

In the Properties cell `<div>`, add as the FIRST child:

```tsx
<div
  onMouseDown={(e) =>
    beginColumnDrag(e, {
      side: "right",
      storageKey: "studio.col.properties",
      cssVar: "--col-properties",
      defaultPx: 320,
      minPx: 200,
      maxPx: 600,
    })
  }
  style={{
    position: "absolute",
    top: 0,
    bottom: 0,
    left: -2,
    width: 4,
    cursor: "col-resize",
    zIndex: 10,
  }}
/>
```

Also add `position: "relative"` to the Properties cell's style.

- [ ] **Step 4: Type-check**

```bash
cd "/Users/parandykt/Remotion Tests" && npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add editor/App.tsx editor/resize.ts
git -c user.email=studio@local -c user.name="v2 Implementer" commit -m "feat(editor): drag-to-resize side panels with persisted widths"
```

---

## Task 7: Native color picker (drop the custom popover)

**Files:**
- Modify: `editor/controls.tsx`

- [ ] **Step 1: Find and replace the ColorControl component**

Open `/Users/parandykt/Remotion Tests/editor/controls.tsx`. Find the exported `ColorControl` component (it has its own popover and a `<input type="color">` inside). Replace the ENTIRE component (everything from `export const ColorControl ...` through its closing `};`) with:

```tsx
export const ColorControl: React.FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="pick color"
        style={{
          width: 22,
          height: 22,
          border: "1px solid #2e2e3c",
          borderRadius: 4,
          padding: 0,
          background: "transparent",
          cursor: "pointer",
        }}
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        style={{
          flex: 1,
          background: "#1c1c26",
          border: "1px solid #2e2e3c",
          borderRadius: 5,
          color: "#e4e4ee",
          fontSize: 11,
          padding: "3px 6px",
          fontFamily: "ui-monospace, Menlo, monospace",
        }}
      />
    </div>
  );
};
```

If the file has internal helper components used only by the old ColorControl (a popover wrapper, click-outside hook, etc), they're now unused — delete them. If they're used by other exported controls, leave them.

- [ ] **Step 2: Type-check**

```bash
cd "/Users/parandykt/Remotion Tests" && npx tsc --noEmit
```

Expected: exit 0. If errors say "X is declared but never used", remove those declarations.

- [ ] **Step 3: Commit**

```bash
git add editor/controls.tsx
git -c user.email=studio@local -c user.name="v2 Implementer" commit -m "feat(editor): use native color picker (single click)"
```

---

# Phase C — Projects mode

The biggest phase. Introduces `~/KineticStudio/<project>` storage, a projects home view, and per-project scoping of all backend commands. After this phase, the user picks or creates a project on launch instead of being dropped into a single hardcoded repo.

## Task 8: Backend — projects module + AppState gains active_project

**Files:**
- Modify: `src-tauri/Cargo.toml` — add `trash`, `slug`
- Create: `src-tauri/src/projects.rs`
- Create: `src-tauri/src/seed.rs`
- Create: `src-tauri/templates/seed-story.json`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/story.rs` — read from `active_project`
- Modify: `src-tauri/src/pty.rs` — spawn cwd = `active_project`

- [ ] **Step 1: Add deps**

In `/Users/parandykt/Remotion Tests/src-tauri/Cargo.toml`, append to `[dependencies]`:

```toml
trash = "5"
slug = "0.1"
chrono = { version = "0.4", features = ["serde"] }
```

- [ ] **Step 2: Bundle the seed story**

Copy the current repo's story.json into the templates directory as the seed:

```bash
cp "/Users/parandykt/Remotion Tests/story.json" "/Users/parandykt/Remotion Tests/src-tauri/templates/seed-story.json"
```

(Create the `templates/` directory first if it doesn't exist: `mkdir -p src-tauri/templates`.)

- [ ] **Step 3: Create `src-tauri/src/seed.rs`**

```rust
//! Bundled starter content for new projects.

pub const SEED_STORY: &str = include_str!("../templates/seed-story.json");
```

- [ ] **Step 4: Create `src-tauri/src/projects.rs`**

```rust
//! Project lifecycle commands.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::seed::SEED_STORY;
use crate::watch;
use crate::AppState;

#[derive(Serialize, Deserialize, Clone)]
pub struct ProjectMeta {
    pub name: String,
    pub path: String,
    pub beats: usize,
    pub last_opened: String,
}

pub struct ActiveProject {
    pub path: PathBuf,
    pub _watcher: watch::StoryWatcher,
}

fn home_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join("KineticStudio"))
        .unwrap_or_else(|| PathBuf::from(".").join("KineticStudio"))
}

fn recents_path() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".kinetic-studio").join("recents.json"))
        .unwrap_or_else(|| PathBuf::from(".kinetic-studio/recents.json"))
}

fn read_recents() -> std::collections::HashMap<String, String> {
    fs::read_to_string(recents_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_recents(map: &std::collections::HashMap<String, String>) {
    if let Some(parent) = recents_path().parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(map) {
        let _ = fs::write(recents_path(), json);
    }
}

fn count_beats(story_path: &Path) -> usize {
    fs::read_to_string(story_path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("beats").and_then(|b| b.as_array()).map(|a| a.len()))
        .unwrap_or(0)
}

#[tauri::command]
pub fn projects_list() -> Result<Vec<ProjectMeta>, String> {
    let home = home_dir();
    fs::create_dir_all(&home).map_err(|e| format!("mkdir home: {}", e))?;

    let recents = read_recents();
    let mut out: Vec<ProjectMeta> = vec![];

    for entry in fs::read_dir(&home).map_err(|e| format!("readdir: {}", e))? {
        let entry = entry.map_err(|e| format!("entry: {}", e))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let story = path.join("story.json");
        if !story.exists() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown")
            .to_string();
        let path_str = path.to_string_lossy().to_string();
        let last_opened = recents
            .get(&path_str)
            .cloned()
            .unwrap_or_else(|| {
                fs::metadata(&path)
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| {
                        chrono::DateTime::<Utc>::from(t)
                            .to_rfc3339()
                            .into()
                    })
                    .unwrap_or_else(|| Utc::now().to_rfc3339())
            });
        out.push(ProjectMeta {
            name,
            path: path_str,
            beats: count_beats(&story),
            last_opened,
        });
    }
    out.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    Ok(out)
}

#[tauri::command]
pub fn projects_create(name: String) -> Result<ProjectMeta, String> {
    let home = home_dir();
    fs::create_dir_all(&home).map_err(|e| format!("mkdir home: {}", e))?;

    let base_slug = slug::slugify(if name.trim().is_empty() {
        "untitled"
    } else {
        &name
    });
    let mut dir = home.join(&base_slug);
    let mut n = 2;
    while dir.exists() {
        dir = home.join(format!("{}-{}", base_slug, n));
        n += 1;
    }
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir project: {}", e))?;
    fs::write(dir.join("story.json"), SEED_STORY)
        .map_err(|e| format!("write story: {}", e))?;
    fs::create_dir_all(dir.join(".kinetic-studio"))
        .map_err(|e| format!("mkdir meta: {}", e))?;

    let display_name = if name.trim().is_empty() {
        "Untitled".into()
    } else {
        name
    };

    let path_str = dir.to_string_lossy().to_string();

    Ok(ProjectMeta {
        name: display_name,
        path: path_str,
        beats: count_beats(&dir.join("story.json")),
        last_opened: Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub fn project_open(
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ProjectMeta, String> {
    let path_buf = PathBuf::from(&path);
    let story = path_buf.join("story.json");
    if !story.exists() {
        return Err("no story.json in folder".into());
    }
    fs::read_to_string(&story).map_err(|e| format!("read story: {}", e))?;

    let watcher = watch::spawn(story.clone(), app.clone())
        .map_err(|e| format!("watcher: {}", e))?;

    let mut active = state.active_project.lock().unwrap();
    *active = Some(ActiveProject {
        path: path_buf.clone(),
        _watcher: watcher,
    });
    drop(active);

    let path_str = path_buf.to_string_lossy().to_string();
    let mut recents = read_recents();
    let now = Utc::now().to_rfc3339();
    recents.insert(path_str.clone(), now.clone());
    write_recents(&recents);

    let name = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let meta = ProjectMeta {
        name,
        path: path_str,
        beats: count_beats(&story),
        last_opened: now,
    };
    let _ = app.emit::<ProjectMeta>("project://opened", meta.clone());
    Ok(meta)
}

#[tauri::command]
pub fn project_close(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    *state.active_project.lock().unwrap() = None;
    let _ = app.emit::<()>("project://closed", ());
    Ok(())
}

#[tauri::command]
pub fn project_reveal(path: String) -> Result<(), String> {
    // macOS: open the folder in Finder. Best-effort.
    let _ = std::process::Command::new("open").arg(&path).spawn();
    Ok(())
}

#[tauri::command]
pub fn project_delete(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| format!("trash: {}", e))
}
```

This requires `dirs` for `home_dir()`. Add it to Cargo.toml:

```toml
dirs = "5"
```

(In the same edit step as `trash`, `slug`, `chrono`.)

- [ ] **Step 5: Update `src-tauri/src/lib.rs`**

Replace the file contents with:

```rust
//! Tauri 2 entry: app state, command registration, plugin init.

mod projects;
mod pty;
mod seed;
mod story;
mod watch;

use std::sync::Mutex;

use dashmap::DashMap;

pub struct AppState {
    pub active_project: Mutex<Option<projects::ActiveProject>>,
    pub ptys: DashMap<String, pty::PtySession>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        active_project: Mutex::new(None),
        ptys: DashMap::new(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            projects::projects_list,
            projects::projects_create,
            projects::project_open,
            projects::project_close,
            projects::project_reveal,
            projects::project_delete,
            story::save_story,
            story::load_story,
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_paste_prompt,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

The `project_root` field and `.setup(...)` watcher startup are GONE — the watcher now starts on `project_open`.

- [ ] **Step 6: Update `src-tauri/src/story.rs` to use active_project**

Replace `/Users/parandykt/Remotion Tests/src-tauri/src/story.rs` with:

```rust
//! story.json read/write commands. All writes are atomic (tmp + rename).
//!
//! Operates on the currently-active project. Errors if no project is
//! open.

use std::path::PathBuf;
use tauri::State;

use crate::AppState;

fn active_path(state: &AppState) -> Result<PathBuf, String> {
    state
        .active_project
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|p| p.path.clone())
        .ok_or_else(|| "no active project".into())
}

#[tauri::command]
pub fn save_story(
    json: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| format!("invalid story json: {}", e))?;

    let root = active_path(&state)?;
    let target: PathBuf = root.join("story.json");
    let tmp: PathBuf = root.join("story.json.tmp");

    let body = if json.ends_with('\n') {
        json
    } else {
        format!("{}\n", json)
    };

    std::fs::write(&tmp, body.as_bytes())
        .map_err(|e| format!("write tmp: {}", e))?;
    std::fs::rename(&tmp, &target)
        .map_err(|e| format!("rename: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn load_story(state: State<'_, AppState>) -> Result<String, String> {
    let root = active_path(&state)?;
    std::fs::read_to_string(root.join("story.json"))
        .map_err(|e| format!("read: {}", e))
}
```

- [ ] **Step 7: Update `src-tauri/src/pty.rs` to use active_project as cwd**

In `/Users/parandykt/Remotion Tests/src-tauri/src/pty.rs`, find the `pty_open` function. Where it currently calls:

```rust
cmd.cwd(&state.project_root);
```

replace with:

```rust
let project_path = state
    .active_project
    .lock()
    .map_err(|e| e.to_string())?
    .as_ref()
    .map(|p| p.path.clone())
    .ok_or_else(|| "no active project".to_string())?;
cmd.cwd(&project_path);
```

- [ ] **Step 8: Build**

```bash
cd "/Users/parandykt/Remotion Tests/src-tauri" && cargo check
```

Expected: clean. Likely warnings about `dirs::home_dir` being deprecated — ignore (the replacement requires more code; this is fine).

- [ ] **Step 9: Commit**

```bash
cd "/Users/parandykt/Remotion Tests"
git add src-tauri/
git -c user.email=studio@local -c user.name="v2 Implementer" commit -m "feat(tauri): introduce active project model + projects commands"
```

---

## Task 9: Frontend ProjectsView + AppShell mode switch

The home screen and the shell that switches between it and the editor.

**Files:**
- Create: `editor/AppShell.tsx`
- Create: `editor/ProjectsView.tsx`
- Modify: `editor/main.tsx` (or wherever App is mounted) — actually unchanged; App.tsx renders AppShell
- Modify: `editor/App.tsx` — renamed to `EditorView` internally, exported behind AppShell

The simplest restructure: split `App.tsx` into two pieces. Move the existing editor body into a new `EditorView` component; have `App` be the AppShell that decides which to render.

- [ ] **Step 1: Add the tauri-plugin-dialog crate (for Open Folder)**

In `/Users/parandykt/Remotion Tests/src-tauri/Cargo.toml`:

```toml
tauri-plugin-dialog = "2"
```

In `/Users/parandykt/Remotion Tests/src-tauri/src/lib.rs`, in the `tauri::Builder::default()` chain, add the plugin init right after the `tauri_plugin_shell::init()`:

```rust
.plugin(tauri_plugin_dialog::init())
```

Then build:

```bash
cd "/Users/parandykt/Remotion Tests/src-tauri" && cargo check
```

- [ ] **Step 2: Add the frontend dialog package**

```bash
cd "/Users/parandykt/Remotion Tests"
npm install @tauri-apps/plugin-dialog
```

- [ ] **Step 3: Refactor App.tsx into App + EditorView**

This is the most invasive single edit in the plan. Do it carefully.

Open `/Users/parandykt/Remotion Tests/editor/App.tsx`. Currently it exports `const App: React.FC = () => { /* big body */ }`.

Rename the existing export to `EditorView`. Add a NEW `App` at the top that decides between the two views based on a small piece of state.

Concretely:

1. Add an import at the top:
   ```tsx
   import { ProjectsView } from "./ProjectsView";
   ```
2. Change the existing line `export const App: React.FC = () => {` to:
   ```tsx
   const EditorView: React.FC<{
     project: ProjectMeta;
     onClose: () => void;
   }> = ({ project, onClose }) => {
   ```
3. The existing body uses `story`/`selection`/etc state — leave it intact, but:
   - Where the existing code says it's loading from `/story.json` or `load_story`, that still works because `load_story` reads from active_project. So no change there.
   - The header / chrome should now show the project name. In the JSX returned by the body, find the four-pane grid root `<div>`. Just before it, add a thin header bar like:
     ```tsx
     <div
       style={{
         display: "flex",
         alignItems: "center",
         gap: 8,
         padding: "6px 12px",
         background: "#0a0a10",
         borderBottom: "1px solid #232330",
         fontSize: 12,
         color: "#8b8b9a",
       }}
     >
       <button
         onClick={onClose}
         style={{
           background: "transparent",
           border: "1px solid #2e2e3c",
           borderRadius: 4,
           color: "#e4e4ee",
           fontSize: 11,
           padding: "3px 8px",
           cursor: "pointer",
         }}
       >
         ← Projects
       </button>
       <span style={{ color: "#e4e4ee", fontWeight: 600 }}>{project.name}</span>
       <span style={{ marginLeft: "auto" }}>{project.path}</span>
     </div>
     ```
   - Wrap the existing four-pane grid + the new header in a single fragment so EditorView's return is `<div style={{ display: "flex", flexDirection: "column", height: "100vh" }}><Header /><Grid /></div>`. Adjust the existing root grid's `height: "100vh"` to `height: 0` + `flex: 1`. Or simpler: leave 100vh on the grid and let it overflow under the header — pick whatever's cleanest at edit time. Pragmatically: change the outer grid's height to `flex: 1, minHeight: 0` and wrap.
4. Add the new App export at the BOTTOM of App.tsx (after EditorView):
   ```tsx
   export const App: React.FC = () => {
     const [project, setProject] = useState<ProjectMeta | null>(null);

     // Listen for project events emitted by Rust.
     useEffect(() => {
       if (!isTauri()) return;
       let off: undefined | (() => void);
       void (async () => {
         const { listen } = await import("@tauri-apps/api/event");
         const unOpened = await listen<ProjectMeta>("project://opened", (e) => {
           setProject(e.payload);
         });
         const unClosed = await listen<null>("project://closed", () => {
           setProject(null);
         });
         off = () => {
           unOpened();
           unClosed();
         };
       })();
       return () => {
         if (off) off();
       };
     }, []);

     if (!isTauri()) {
       // Browser mode keeps the old single-project behaviour.
       return (
         <EditorView
           project={{
             name: "Browser dev",
             path: "(browser mode)",
             beats: 0,
             lastOpened: new Date().toISOString(),
           }}
           onClose={() => undefined}
         />
       );
     }

     if (project) {
       return (
         <EditorView
           key={project.path}
           project={project}
           onClose={async () => {
             const { invoke } = await import("@tauri-apps/api/core");
             await invoke("project_close");
           }}
         />
       );
     }
     return <ProjectsView />;
   };
   ```
5. Add a `ProjectMeta` type import at the top:
   ```tsx
   import type { ProjectMeta } from "./ProjectsView";
   ```

The `key={project.path}` is important — when the user switches projects, the EditorView state (selection, story, etc) resets.

- [ ] **Step 4: Create `ProjectsView.tsx`**

Write `/Users/parandykt/Remotion Tests/editor/ProjectsView.tsx`:

```tsx
/**
 * Home view: lists projects under ~/KineticStudio, supports creating
 * new projects, opening an arbitrary folder, and basic context-menu
 * actions per card.
 */
import React, { useEffect, useState } from "react";

export type ProjectMeta = {
  name: string;
  path: string;
  beats: number;
  lastOpened: string;
};

const fmtAgo = (iso: string) => {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const ms = Math.max(0, now - then);
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
};

export const ProjectsView: React.FC = () => {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const list = await invoke<ProjectMeta[]>("projects_list");
      setProjects(list);
    } catch (e) {
      setError(`Failed to list projects: ${(e as Error).message}`);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const openProject = async (path: string) => {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("project_open", { path });
    } catch (e) {
      setError(`Open failed: ${(e as Error).message}`);
    }
  };

  const createProject = async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const meta = await invoke<ProjectMeta>("projects_create", {
        name: newName,
      });
      setNewName("");
      await openProject(meta.path);
    } catch (e) {
      setError(`Create failed: ${(e as Error).message}`);
    }
  };

  const openFolder = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true });
    if (typeof picked === "string") {
      await openProject(picked);
    }
  };

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#08080c",
        color: "#e4e4ee",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        padding: 40,
        boxSizing: "border-box",
        overflowY: "auto",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 22 }}>Kinetic Studio</h1>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 24,
          marginBottom: 24,
        }}
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New project name"
          onKeyDown={(e) => {
            if (e.key === "Enter") void createProject();
          }}
          style={{
            flex: 1,
            maxWidth: 320,
            background: "#1c1c26",
            border: "1px solid #2e2e3c",
            borderRadius: 6,
            color: "#e4e4ee",
            fontSize: 13,
            padding: "8px 12px",
          }}
        />
        <button
          onClick={() => void createProject()}
          style={{
            background: "#7c5cff",
            color: "white",
            border: "none",
            borderRadius: 6,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + New project
        </button>
        <button
          onClick={() => void openFolder()}
          style={{
            background: "#1c1c26",
            color: "#e4e4ee",
            border: "1px solid #2e2e3c",
            borderRadius: 6,
            padding: "8px 16px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Open folder…
        </button>
      </div>

      {error && (
        <div
          style={{
            background: "#3a1c20",
            color: "#ff8b8b",
            padding: "8px 12px",
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 16,
        }}
      >
        {projects.map((p) => (
          <button
            key={p.path}
            onClick={() => void openProject(p.path)}
            style={{
              textAlign: "left",
              background: "#14141c",
              border: "1px solid #232330",
              borderRadius: 10,
              padding: 16,
              color: "#e4e4ee",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
            <div
              style={{
                fontSize: 11,
                color: "#6b6b80",
                marginTop: 4,
              }}
            >
              {p.beats} beats · {fmtAgo(p.lastOpened)}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "#4b4b5a",
                marginTop: 8,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {p.path}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
```

- [ ] **Step 5: Type-check**

```bash
cd "/Users/parandykt/Remotion Tests" && npx tsc --noEmit
```

Expected: exit 0. Fix any issues — the most likely is the `ProjectMeta` import path (it's in `ProjectsView.tsx`).

- [ ] **Step 6: Commit**

```bash
git add editor/ProjectsView.tsx editor/App.tsx src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs package.json package-lock.json
git -c user.email=studio@local -c user.name="v2 Implementer" commit -m "feat(editor): projects home view + active-project routing"
```

---

## Task 10: Hide / disable the studio chrome until a project opens

Sanity pass: ensure file-watch, terminal, etc. don't try to run when no project is open. Mostly handled by the AppShell switch (ProjectsView and EditorView are different components), but some edge cases need explicit guarding.

**Files:**
- Modify: `editor/App.tsx`
- Modify: `editor/terminal.tsx`

- [ ] **Step 1: Guard the external-change listener**

The `story://changed` listener was added in Task 4 with `useEffect(() => { if (!isTauri()) return; ...`. Move it INTO `EditorView` if it isn't already (it should be, since it lives inside the old `App` body which is now `EditorView`). The listener now only registers when a project is open, which is what we want.

- [ ] **Step 2: Verify terminal mounts under EditorView only**

`<Terminal />` is rendered inside the four-pane grid which is inside EditorView. Good — terminal only mounts after a project is open. The `pty_open` call inside `terminal.tsx` will succeed because the Rust side now uses `active_project` for cwd.

- [ ] **Step 3: tsc + commit if any changes**

```bash
cd "/Users/parandykt/Remotion Tests" && npx tsc --noEmit
```

If you didn't actually change anything (because Task 9's refactor already put the listener in the right place), skip the commit and proceed to Task 11.

If you did change things:

```bash
git add editor/App.tsx editor/terminal.tsx
git -c user.email=studio@local -c user.name="v2 Implementer" commit -m "chore(editor): scope listeners and terminal to active project"
```

---

# Phase D — Agent skill

Per-project `.kinetic-studio/skill.md` + a `rc.zsh` that aliases `claude` to inject the skill into its system prompt. Written on `project_open` and `projects_create`.

## Task 11: Skill + rc.zsh templates baked into the binary

**Files:**
- Create: `src-tauri/templates/skill.md`
- Create: `src-tauri/templates/rc.zsh`
- Create: `src-tauri/src/skill.rs`
- Modify: `src-tauri/src/lib.rs` — register module
- Modify: `src-tauri/src/projects.rs` — call `skill::write` from create/open

- [ ] **Step 1: Write `skill.md` template**

Create `/Users/parandykt/Remotion Tests/src-tauri/templates/skill.md`:

```markdown
# Kinetic Studio — agent operating manual

You are running inside the Kinetic Studio desktop editor. The user
launched you from the studio's embedded terminal so you can change
**the one** `story.json` in this directory.

## Hard rules

- The story file is `./story.json`. Edit it directly with the Write
  tool. Do NOT search other directories for "background" or similar
  generic terms.
- Do NOT invoke `superpowers:using-superpowers`,
  `superpowers:brainstorming`, `superpowers:writing-plans`, or any
  other superpowers skill. This is a direct-edit workflow.
- Do NOT ask the user to clarify which background, which beat, etc.,
  unless the request is genuinely ambiguous against the schema below.
  "Make the background more yellow" means edit `bgColor` (and likely
  `bgColor2`) in `story.json`. Just do it.
- When you're done, finish with a one-line summary. No long
  explanations.

## The schema

`story.json` shape:

```jsonc
{
  "bgColor":       "#hex",      // base background
  "bgColor2":      "#hex",      // gradient end / second color
  "textColor":     "#hex",
  "accentColor":   "#hex",
  "accent2Color":  "#hex",
  "fontSize":      160,         // 40..400
  "glowIntensity": 1,           // 0..2
  "background": {
    "kind":        "gradient" | "shader" | "image" | "video",
    "shaderStyle": "aurora" | "flowField" | "mesh",
    "motion":      0.5,         // 0..1
    "src":         "..."        // for image/video
  },
  "beats": [
    {
      "text":             "every",
      "kind":             "reveal" | "morph" | "generativeFill",
      "durationInSeconds": 1.4,
      "easing":            "p3.out" | "p3.inOut" | "p4.out" | "spring",
      "direction":         "up" | "down" | "left" | "right" | "scale",
      "dynamics":          0.5,
      "staggerSeconds":    0.085,
      "animateInPortion":  0.75,
      "scale":             1.45,
      "glow":              0,
      "color":             "#hex"
    }
  ]
}
```

## How edits reach the UI

The studio watches `story.json`. When you write it, the UI reloads
within ~300 ms. You don't need to tell the user to refresh.

## Conflict prompts

If the user pastes a message like:

```
Apply my changes on top of yours:
  - story.bgColor: "#2a1a05" → "#ffaa00"
  - beats[2].dynamics: 0.5 → 0.85
```

…that means they edited the same fields you did while you were
working. Their values win for those fields; apply the listed
changes on top of the current `story.json` and re-save.
```

- [ ] **Step 2: Write `rc.zsh` template**

Create `/Users/parandykt/Remotion Tests/src-tauri/templates/rc.zsh`:

```bash
# Sourced by the Kinetic Studio terminal before handing control to zsh.
# Wraps `claude` so it always launches with the project's agent skill
# as an appended system prompt.

if [ -n "$KINETIC_PROJECT" ] && [ -f "$KINETIC_PROJECT/.kinetic-studio/skill.md" ]; then
  alias claude='command claude --append-system-prompt "$(cat "$KINETIC_PROJECT/.kinetic-studio/skill.md")"'
fi
```

- [ ] **Step 3: Create `src-tauri/src/skill.rs`**

```rust
//! Per-project agent skill: writes skill.md and rc.zsh into
//! <project>/.kinetic-studio/ on every project_open and
//! projects_create. Idempotent overwrite keeps the skill in sync if
//! the studio binary updates.

use std::fs;
use std::path::Path;

pub const SKILL_TEMPLATE: &str = include_str!("../templates/skill.md");
pub const RC_ZSH: &str = include_str!("../templates/rc.zsh");

pub fn write(project_path: &Path) -> std::io::Result<()> {
    let meta_dir = project_path.join(".kinetic-studio");
    fs::create_dir_all(&meta_dir)?;
    fs::write(meta_dir.join("skill.md"), SKILL_TEMPLATE)?;
    fs::write(meta_dir.join("rc.zsh"), RC_ZSH)?;
    Ok(())
}
```

- [ ] **Step 4: Register in lib.rs**

In `/Users/parandykt/Remotion Tests/src-tauri/src/lib.rs`, add at the top with the other module declarations:

```rust
mod skill;
```

- [ ] **Step 5: Call `skill::write` from `projects_create` and `project_open`**

Edit `/Users/parandykt/Remotion Tests/src-tauri/src/projects.rs`:

In `projects_create`, immediately AFTER the line `fs::create_dir_all(dir.join(".kinetic-studio")).map_err(...)?;`, add:

```rust
crate::skill::write(&dir).map_err(|e| format!("write skill: {}", e))?;
```

In `project_open`, immediately AFTER the watcher is spawned and BEFORE the `state.active_project.lock()` line, add:

```rust
crate::skill::write(&path_buf).map_err(|e| format!("write skill: {}", e))?;
```

- [ ] **Step 6: Build**

```bash
cd "/Users/parandykt/Remotion Tests/src-tauri" && cargo check
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
cd "/Users/parandykt/Remotion Tests"
git add src-tauri/
git -c user.email=studio@local -c user.name="v2 Implementer" commit -m "feat(tauri): write per-project agent skill + rc.zsh on open/create"
```

---

## Task 12: Modify pty_open to source rc.zsh and set KINETIC_PROJECT

**Files:**
- Modify: `src-tauri/src/pty.rs`

- [ ] **Step 1: Wire env + source the rc.zsh**

In `/Users/parandykt/Remotion Tests/src-tauri/src/pty.rs`, find `pty_open`. In the block that builds the `CommandBuilder`:

Current shape (after Task 8 edits):
```rust
let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
let mut cmd = CommandBuilder::new(&shell);
cmd.arg("-l");
let project_path = state
    .active_project
    .lock()
    // ...
    .ok_or_else(|| "no active project".to_string())?;
cmd.cwd(&project_path);
for (k, v) in std::env::vars() {
    cmd.env(k, v);
}
```

Replace with:

```rust
let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
let project_path = state
    .active_project
    .lock()
    .map_err(|e| e.to_string())?
    .as_ref()
    .map(|p| p.path.clone())
    .ok_or_else(|| "no active project".to_string())?;
let project_str = project_path.to_string_lossy().to_string();
let rc_path = project_path.join(".kinetic-studio").join("rc.zsh");

let mut cmd = CommandBuilder::new(&shell);
cmd.cwd(&project_path);

// Inherit env so `claude` finds ~/.claude credentials.
for (k, v) in std::env::vars() {
    cmd.env(k, v);
}
// Studio scope hints.
cmd.env("KINETIC_PROJECT", &project_str);
cmd.env("KINETIC_STUDIO", "1");

// If zsh AND the rc file exists, source it before going interactive.
let shell_name = std::path::Path::new(&shell)
    .file_name()
    .and_then(|n| n.to_str())
    .unwrap_or("");
if shell_name == "zsh" && rc_path.exists() {
    let rc_str = rc_path.to_string_lossy().to_string();
    cmd.arg("-c");
    cmd.arg(format!("source \"{}\"; exec zsh -i", rc_str));
} else {
    cmd.arg("-l");
}
```

- [ ] **Step 2: Build**

```bash
cd "/Users/parandykt/Remotion Tests/src-tauri" && cargo check
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd "/Users/parandykt/Remotion Tests"
git add src-tauri/src/pty.rs
git -c user.email=studio@local -c user.name="v2 Implementer" commit -m "feat(tauri): source per-project rc.zsh in studio terminal (claude alias)"
```

---

## Task 13: README — projects + skill

**File:**
- Modify: `README.md`

- [ ] **Step 1: Add a "Projects" section after the "Desktop app" section**

Insert:

```markdown
## Projects (the home view)

`npm run tauri:dev` opens a projects home screen. Each project is a
folder under `~/KineticStudio/` containing `story.json`. Click a card
to open the editor; the title bar shows a `← Projects` button to come
back.

- **+ New project** — creates `~/KineticStudio/<slug>/` with a starter
  `story.json` and a `.kinetic-studio/` metadata folder.
- **Open folder…** — pick any folder containing `story.json` (handy
  for projects stored outside the home folder, e.g. inside a git
  repo).

Recently-opened ordering is tracked in `~/.kinetic-studio/recents.json`.

### Agent skill

Every project gets `.kinetic-studio/skill.md` written automatically.
The studio's terminal sources `.kinetic-studio/rc.zsh` before handing
control to your shell, which aliases `claude` to inject the skill as
an `--append-system-prompt`. So when you type `claude` inside the
studio, the agent already knows: edit `story.json` here, no superpowers
detours.

The skill is rewritten on every `project_open`, so binary updates that
change the template propagate the next time you open the project.

Non-zsh shells skip the alias. Run `claude --append-system-prompt @./
.kinetic-studio/skill.md` manually.
```

- [ ] **Step 2: Commit**

```bash
cd "/Users/parandykt/Remotion Tests"
git add README.md
git -c user.email=studio@local -c user.name="v2 Implementer" commit -m "docs: projects + agent skill"
```

---

# Phase E — Final smoke + audit (single task, no phase letter)

## Task 14: Final verification

This is a verification pass, not implementation. The implementer reports findings; no code changes.

- [ ] **Step 1: Type-check**

```bash
cd "/Users/parandykt/Remotion Tests" && npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 2: Rust check**

```bash
cd "/Users/parandykt/Remotion Tests/src-tauri" && cargo check
```
Expected: clean.

- [ ] **Step 3: Browser smoke**

```bash
cd "/Users/parandykt/Remotion Tests"
npm run editor &
EP=$!
sleep 5
curl -sf -o /dev/null -w "EDITOR=%{http_code}\n" http://localhost:5174
kill $EP 2>/dev/null
wait $EP 2>/dev/null
```
Expected: `EDITOR=200`. In browser mode the home view should be skipped (fallback path renders EditorView with a stub project).

- [ ] **Step 4: Other entry points**

```bash
# Studio
npm run studio &
SP=$!
sleep 6
curl -sf -o /dev/null -w "STUDIO=%{http_code}\n" http://localhost:3000 || \
  curl -sf -o /dev/null -w "STUDIO=%{http_code}\n" http://localhost:3001
kill $SP 2>/dev/null
wait $SP 2>/dev/null

# Render
mkdir -p out
npx remotion render KineticStory out/_v2_smoketest.mp4 --frames=0-10
ls -la out/_v2_smoketest.mp4 && echo "RENDER OK" || echo "RENDER FAIL"
rm -f out/_v2_smoketest.mp4
```

- [ ] **Step 5: Audit file presence**

Confirm present:
- `editor/AppShell.tsx` (note: per Task 9 we kept `App` inside `App.tsx` as the shell — so AppShell.tsx is OPTIONAL. If it's missing, that's fine as long as `App.tsx` does the mode switch.)
- `editor/ProjectsView.tsx`
- `editor/diff.ts`
- `editor/resize.ts`
- `src-tauri/src/projects.rs`
- `src-tauri/src/watch.rs`
- `src-tauri/src/skill.rs`
- `src-tauri/src/seed.rs`
- `src-tauri/templates/skill.md`
- `src-tauri/templates/rc.zsh`
- `src-tauri/templates/seed-story.json`

- [ ] **Step 6: Recommendation for the user**

Produce a short report with:
- All command results
- File audit table
- A summary of what the user should now manually verify in `npm run tauri:dev`:
  1. Home view appears.
  2. Create a project; the editor opens.
  3. In the terminal, type `claude`; verify the prompt shows the studio skill is loaded (e.g., `claude --print 'what skill am I running'` or similar).
  4. Edit `story.json` externally; UI reloads within 1 s.
  5. Edit a slider, then externally change a DIFFERENT field; verify auto-merge.
  6. Edit a slider, then externally change the SAME field; verify the conflict prompt is pasted into the terminal.
  7. Drag the divider between Terminal and Preview; reload the app; width persists.
  8. Click a color swatch; the macOS Colors panel opens immediately.
  9. Transport bar sits below the preview, above the timeline.
  10. Click `← Projects`; the home view returns; reopening the project reloads the same story.

---

## Self-review notes

**Spec coverage:**
- Bug fix (agent edits invisible) → Tasks 1–4.
- Resizable panels → Task 6.
- Per-project skill → Tasks 11–12.
- Projects-first home → Tasks 8–10.
- Move transport above timeline → Task 5.
- Agent didn't apply changes → same root cause as the bug fix → Tasks 1–4.
- Color picker opens system Colors panel directly → Task 7.

**Type / name consistency:**
- `ProjectMeta` is exported from `ProjectsView.tsx` (frontend) and serialized identically from `projects.rs` (backend). Field names match: `name`, `path`, `beats`, `lastOpened` (camelCase via serde rename if needed — `ProjectMeta` in Rust uses `last_opened`, Tauri's invoke layer auto-camelCases on the way to JS, so the TS type stays `lastOpened`). Make sure to confirm this — if Tauri 2 doesn't auto-convert, add `#[serde(rename_all = "camelCase")]` to the Rust struct.
- `Selection` type — unchanged from phase 1, still in `App.tsx`.
- `FieldKey` — only used by `diff.ts` and `App.tsx`.

**Placeholder scan:** None. Every step has the full code or full command. The two known integration risks (Tauri 2 serde casing, WebKit color input rendering) are flagged with mitigations inline.

**Cross-phase consistency:**
- Phase A's watcher starts in `lib.rs:run()` setup() — but Phase C deletes that and starts it on `project_open`. The order in this plan is: Task 2 adds the startup-time watcher, Task 8 replaces it with the project-scoped one. The plan calls this out explicitly in Task 8 Step 5.
- Phase A's hardcoded `project_root` (Task 2) is replaced by `active_project` in Phase C (Task 8). Story commands and PTY commands change signature/internals; the plan walks through each change.

**Open implementation watch-outs:**
- `dirs::home_dir()` is deprecated; use it anyway (replacement requires `directories` crate). If a future Rust update breaks it, swap to `std::env::var("HOME")` mac-side.
- Tauri 2's invoke args casing: most likely camelCase on JS / snake_case on Rust auto-translation just works, but if `projects_create({ name })` errors with "missing field", switch to `{ name: name }` (no-op) or audit the rename_all attribute.
- The `--append-system-prompt` flag is Claude Code CLI specific. If the user's `claude` is a different tool, the alias breaks. Acceptable — the studio is a Claude-first tool.
