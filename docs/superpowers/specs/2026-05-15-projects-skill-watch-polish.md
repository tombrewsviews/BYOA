# Studio v2 — Projects mode, agent skill, file-watch, UX polish

**Date:** 2026-05-15
**Status:** Design — ready for implementation plan

Scope: combine four loosely-coupled features the user surfaced after the
Tauri shell migration landed. They share enough state (project root,
file-watch needs the project root, skill needs the project root, save
flow needs to merge with watch) to belong in one spec, but each could be
implemented in its own phase.

## Problem statements

1. **The agent edits `story.json` but the UI doesn't refresh.** Today
   `App.tsx` only loads `story.json` on mount. When the agent in the
   embedded terminal edits the file, React state still holds the old
   values, so the user sees stale colors / no preview update.

2. **There's only one project.** The app is hard-coded to one repo —
   the directory containing `src-tauri/`. To support "I have many
   kinetic videos", we need a project picker and per-project file
   roots.

3. **The agent has no idea it's running inside the studio.** The
   embedded terminal launches `claude`; the agent then loads
   `superpowers:using-superpowers` and starts asking which background
   the user wants ("Editor UI? Kinetic video? TypographyDemo?") because
   it has no project-specific context. Output: confusion, wrong files
   touched.

4. **Layout is rigid.** Three fixed-width columns. No way to make the
   terminal wider when working with the agent, or to make the preview
   bigger when designing.

5. **Transport bar sits visually above the preview but conceptually
   belongs to the timeline.** Move it.

6. **Color picker indirection.** Clicking the color swatch opens a
   custom swatch popover. Clicking the popover's preview rectangle
   opens the macOS Colors panel. Two clicks to reach a picker the user
   wants on the first click.

7. **Agent says "Done" but story.json on disk reflects the change —
   the UI just didn't show it.** Same root cause as (1).

## Goals

- Agent writes to `story.json` → UI updates within ~300 ms.
- New "Projects" home screen on launch; pick or create a project to
  enter the editor.
- Inside a project's terminal, `claude` launches with a system prompt
  that scopes it to that project and tells it to stay out of
  `superpowers:*`.
- Panel dividers drag to resize; widths persist across sessions.
- Transport bar moves below the preview, above the timeline.
- Color swatch opens the native Colors panel directly.

## Non-goals

- Cross-project search, tag/folder organisation, sharing, sync.
- Multi-window (one studio window for one project at a time; opening
  another project replaces the current one).
- Renaming projects from the UI (do it from Finder — we just
  re-discover next launch).
- A full conflict-resolution UI. We hand merge conflicts to the agent.
- Skill updates over-the-air. The skill template is baked into the
  binary and written once per project.

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Rust (src-tauri/)                                              │
│                                                                 │
│  AppState                                                       │
│    home_dir                  ~/KineticStudio                    │
│    active_project: Mutex<Option<ProjectHandle>>                 │
│    ptys: DashMap<id, PtySession>                                │
│                                                                 │
│  Commands                                                       │
│    projects_list      → Vec<ProjectMeta>                        │
│    projects_create    → ProjectMeta                             │
│    project_open       → set active, start watcher               │
│    project_close      → stop watcher                            │
│    load_story         → reads <active>/story.json               │
│    save_story         → writes <active>/story.json              │
│    pty_open           → spawns shell in <active>                │
│      ... (pty_write/resize/close unchanged)                     │
│                                                                 │
│  Events                                                         │
│    story://changed     emitted by file-watcher                  │
│    project://opened    emitted on project_open                  │
│    project://closed    emitted on project_close                 │
├─────────────────────────────────────────────────────────────────┤
│  React (editor/)                                                │
│                                                                 │
│  AppShell.tsx                                                   │
│    ├── ProjectsView  (active when no project)                   │
│    └── EditorView    (active when project open)                 │
│                                                                 │
│  Both views read from a small "session" store (project meta).   │
└─────────────────────────────────────────────────────────────────┘
```

## 1. Projects mode

### Storage layout

```
~/KineticStudio/
  Sprout Story/
    story.json
    .kinetic-studio/
      skill.md              ← agent system prompt
  Brand Reel/
    story.json
    .kinetic-studio/skill.md
  Untitled/
    story.json
    .kinetic-studio/skill.md
```

Discovery: `projects_list` reads `~/KineticStudio/*`, filters to
directories containing `story.json`, sorts by mtime descending. Returns
`{ name, path, last_opened }`.

`last_opened` is read from `~/.kinetic-studio/recents.json` (a flat
`{ path: iso8601 }` map). Writes happen on `project_open`. If the
recents file doesn't exist, default to directory mtime.

### New project flow

1. User clicks `+ New Project` in the home view.
2. Inline input appears. User types a name; default is "Untitled".
3. Frontend calls `projects_create({ name })`.
4. Rust:
   - Slugifies name to a safe directory name (lowercase, hyphens, ASCII).
   - If `~/KineticStudio/<slug>` exists, append `-2`, `-3`, etc.
   - Creates the directory.
   - Writes a seed `story.json` (the same content currently shipped in
     the repo's `story.json`, hardcoded as a string constant in Rust).
   - Writes `.kinetic-studio/skill.md` (template — see §3).
   - Returns the new `ProjectMeta`.
5. Frontend immediately calls `project_open` on it.

### Open project flow

1. User clicks a project card.
2. Frontend calls `project_open({ path })`.
3. Rust:
   - Reads `<path>/story.json` (validate it parses as JSON; surface
     errors to UI).
   - Refreshes `.kinetic-studio/skill.md` from the baked template
     (idempotent overwrite — keeps the skill in sync if the binary
     updates).
   - Sets `AppState.active_project`.
   - Starts a `notify` watcher on `<path>/story.json`.
   - Updates `recents.json`.
   - Emits `project://opened` with the meta.
4. Frontend switches `<EditorView>`.

### Close / back

The editor's title bar gets a small back button (`← Projects`) that
calls `project_close`. Rust stops the watcher, clears
`active_project`, emits `project://closed`. Frontend switches back to
`<ProjectsView>`.

### Open from disk

Secondary action: `Open Folder…` button on the home view. Calls
`tauri::dialog::open` (or its v2 plugin equivalent) for folder
selection. Calls `project_open` with the chosen path. If the folder has
no `story.json`, the open call returns an error; UI shows a toast.

### Home view UI

```
┌─────────────────────────────────────────────────────────┐
│  Kinetic Studio                                         │
│                                                         │
│  Projects               [+ New project] [Open folder…]  │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Sprout Story │  │ Brand Reel   │  │ Untitled     │   │
│  │ 5 beats      │  │ 8 beats      │  │ 1 beat       │   │
│  │ 2h ago       │  │ Yesterday    │  │ 3d ago       │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────┘
```

Cards: name, beat count (from parsed story.json — read once at list
time), last-opened relative time. Click → opens. Right-click → minimal
context menu: Reveal in Finder, Delete (with confirm; moves to Trash
via `trash` crate, never `rm -rf`).

## 2. File-watch + conflict reconciliation

### Watcher

Rust `notify::recommended_watcher()` on `<active>/story.json`. Debounce
200 ms (atomic writes do tmp + rename, which fires two events). On any
debounced event, read the file and emit `story://changed`.

The watcher is owned by `AppState`; `project_open` starts it,
`project_close` drops it. Replacing it with a new watcher on a new
project is safe via `Mutex<Option<Debouncer>>`.

### Frontend reload

`useEffect` in `App.tsx`:

```ts
useEffect(() => {
  const unlisten = await listen<void>("story://changed", () => {
    void handleExternalChange();
  });
  return () => unlisten();
}, []);
```

`handleExternalChange()`:

1. Read fresh story via `invoke("load_story")`.
2. If `!localDirty` (no pending user edits) → just `setStory(fresh)`,
   `setSavedJson(JSON.stringify(fresh))`.
3. If `localDirty`:
   - Compute three things:
     - `savedSnapshot` — the `savedJson` we already track (last known
       on-disk state).
     - `userPending` — the diff between `story` (in-memory) and
       `savedSnapshot` (what the user changed).
     - `agentChanges` — the diff between `fresh` and `savedSnapshot`
       (what the agent changed).
   - For each field changed by `userPending`:
     - If `agentChanges` did NOT touch the same field → it's a
       non-conflicting field. Apply the user's value on top of
       `fresh`.
     - If `agentChanges` DID touch the same field → conflict on that
       field.
   - Produce a **merged** story (start from `fresh`, overlay
     non-conflicting user fields).
   - If conflict set is empty → save the merged story (calls
     `save_story` immediately to flush); set state to merged; no
     prompt.
   - If conflict set is non-empty:
     1. Save the merged story (so non-conflicting user changes are
        preserved on disk).
     2. Set state to the merged story.
     3. Compute a human-readable list of conflicts:
        `"story.bgColor: \"#2a1a05\" → \"#ffaa00\"\nbeats[2].dynamics: 0.5 → 0.85"`
        Each line shows the user's intended value (agent value is the
        new "before").
     4. Call a new `pty_paste_prompt({ id, text })` command that writes
        the following directly into the active terminal session:
        ```
        Apply my changes on top of yours:
          - story.bgColor: "#2a1a05" → "#ffaa00"
          - beats[2].dynamics: 0.5 → 0.85
        ```
        followed by a newline (Enter is NOT sent — user can review and
        hit Enter themselves; this avoids accidentally interrupting an
        in-flight agent turn).
     5. Show a toast: "Conflicts pasted into terminal — review and
        send."

### Diff representation

Diff is computed by `serde_json::Value` walks:

- Top-level story scalars: `bgColor`, `bgColor2`, `textColor`,
  `accentColor`, `accent2Color`, `fontSize`, `glowIntensity`.
- `background` object as a unit (any change to `kind`, `shaderStyle`,
  `src`, `motion` is one field: `background`).
- `beats[i]` per index, per field: `kind`, `durationInSeconds`,
  `easing`, `direction`, `dynamics`, `staggerSeconds`,
  `animateInPortion`, `scale`, `glow`, `color`.

If `beats.length` differs between user and agent, treat it as a single
conflict on `beats` (no array reconciliation — agents own structure).

### Picking which PTY to paste into

The frontend tracks the active PTY session id (already returned by
`pty_open`; store it in a ref the moment `pty_open` resolves). If no
PTY is open, skip the paste step and instead set the conflict text into
a small "Pending merge" banner in the editor with a `Copy to clipboard`
button.

## 3. Per-project agent skill

### What gets written

Each project's `.kinetic-studio/skill.md` is the same template, written
verbatim on `project_open` and `project_create`. Template is a const
`&str` in Rust (so we can revise it in one place and ship via a new
binary).

Template (final wording can be tuned, but this is the intended shape):

````markdown
# Kinetic Studio — agent operating manual

You are running inside the Kinetic Studio desktop editor. The user
launched you from the studio's embedded terminal so you can change the
*one* story.json in this directory.

## Hard rules

- The story file is at `./story.json`. Edit it directly with the Write
  tool. Do NOT search other directories for "background" or similar
  generic terms.
- Do NOT invoke `superpowers:using-superpowers`, `brainstorming`,
  `writing-plans`, or any superpowers skill. This is a direct-edit
  workflow.
- Do NOT ask the user to clarify which background, which beat, etc.
  unless the request is ambiguous in a way the schema makes
  ambiguous. "Make the background more yellow" means edit `bgColor`,
  `bgColor2` (and arguably accents) in `story.json`. Just do it.
- When you are done, end with a one-line summary. No long
  explanations.

## The schema

`story.json` shape (Zod source: `src/kinetic/schema.ts` — IF that path
exists in this project; otherwise the template here is authoritative):

```jsonc
{
  "bgColor":      "#hex",       // base background
  "bgColor2":     "#hex",       // gradient end / second color
  "textColor":    "#hex",
  "accentColor":  "#hex",
  "accent2Color": "#hex",
  "fontSize":     160,           // 40..400
  "glowIntensity": 1,            // 0..2
  "background": {
    "kind": "gradient" | "shader" | "image" | "video",
    "shaderStyle": "aurora" | "flowField" | "mesh",
    "motion": 0.5,               // 0..1
    "src": "..."                 // for image/video
  },
  "beats": [
    {
      "text": "every",
      "kind": "reveal" | "morph" | "generativeFill",
      "durationInSeconds": 1.4,
      "easing": "p3.out" | "p3.inOut" | "p4.out" | "spring",
      "direction": "up" | "down" | "left" | "right" | "scale",
      "dynamics": 0.5,
      "staggerSeconds": 0.085,
      "animateInPortion": 0.75,
      "scale": 1.45,
      "glow": 0,
      "color": "#hex"
    }
  ]
}
```

## How edits reach the UI

The studio watches `story.json`. When you write it, the UI reloads
within ~300 ms. You do not need to tell the user to refresh.

## Conflict prompt

If the user types `Apply my changes on top of yours: ...` followed by a
list of property=value lines, that means the user edited the same
properties you just did while you were working. Their values win for
those properties; merge them into `story.json` and re-save.
````

### Why claude --append-system-prompt

We override the terminal's `claude` invocation so it always launches
with this system prompt. From `pty_open`, after spawning the shell, we
don't run `claude` automatically — the user types it. But we install a
zsh alias into the spawned shell's environment:

```
KINETIC_PROJECT=/Users/tom/KineticStudio/Sprout Story
alias claude='command claude --append-system-prompt "$(cat \"$KINETIC_PROJECT/.kinetic-studio/skill.md\")"'
```

`pty_open` sets these in the spawned shell's env by writing them to
`SHELL_INIT` arguments or — cleaner — by passing them as `env` entries
to `CommandBuilder` and the skill aliases get sourced from a
`.kinetic-studio/rc.zsh` snippet we also write. The shell auto-sources
`~/.zshrc`, which by Tauri convention we don't touch. Instead:

- Set env var `KINETIC_PROJECT` in the PTY's `env`.
- Set env var `KINETIC_STUDIO=1` (so the skill template can read it via
  `$KINETIC_STUDIO` if it wants to detect).
- Write `<project>/.kinetic-studio/rc.zsh` containing the alias above
  (idempotent overwrite each `project_open`).
- Tell the user (in the README and skill template) to source this
  file: actually no — we'll spawn the shell with
  `cmd.arg("-c").arg("source <path>/.kinetic-studio/rc.zsh; exec zsh -i")`.
  That sources our rc THEN replaces the shell with an interactive
  session that keeps the alias.

Trade-off: we depend on zsh. If the user has bash or fish as `$SHELL`,
we fall back to spawning their shell without the alias and the studio
shows a banner: "Your shell is `bash`; `claude` won't be wrapped with
the studio skill. Run `claude --append-system-prompt @./
.kinetic-studio/skill.md` manually." No automated path for non-zsh.

### Why per-project (not a global skill)

- Travels with the project if the user copies it elsewhere.
- Survives studio updates because the studio rewrites it on every
  `project_open`.
- Doesn't pollute `~/.claude/skills/` globally.

## 4. Resizable panels

CSS Grid columns become CSS variables on the shell:

```css
:root {
  --col-terminal: 360px;
  --col-properties: 320px;
}
.shell { grid-template-columns: var(--col-terminal) 1fr var(--col-properties); }
```

Two drag handles:

- Between Terminal and Preview/Timeline column.
- Between Preview/Timeline column and Properties.

Each handle is a 4px-wide `<div>` with `cursor: col-resize`. On
`mousedown` it captures pointer events; `mousemove` updates the
relevant CSS variable on `:root`; `mouseup` releases and writes the
value to localStorage. On mount, `App.tsx` reads localStorage and
pre-sets the variables.

Constraints: min 200px each side column; min 400px middle column.
Clamp during drag.

No vertical resize between preview and timeline — the timeline is a
fixed-height row driven by content. (Could add later; out of scope.)

## 5. Transport position

Move the four buttons (Start / Play / Pause / End) from above the
`<PlayerStage>` to between `<PlayerStage>` and `<Timeline>` — i.e., in
the same column as Preview, but in a new flex row stuck to the bottom
of the Preview cell (above the Timeline cell).

Existing JSX in `App.tsx`:

```tsx
<div /* preview cell */>
  <Transport ... />     {/* delete from here */}
  <PlayerStage ... />
  <div>{N beats · ...}</div>
</div>
<div /* timeline cell */>
  <Timeline ... />
</div>
```

Becomes:

```tsx
<div /* preview cell */>
  <PlayerStage ... />
  <div>{N beats · ...}</div>
  <Transport ... />     {/* new position */}
</div>
<div /* timeline cell */>
  <Timeline ... />
</div>
```

Same `<Transport>` component, no API change. Padding around it
adjusts.

## 6. Color picker auto-open

The current `<ColorControl>` opens a custom popover when the swatch is
clicked, and the popover contains a preview rectangle whose `<input
type="color">` is what actually shows the system Colors panel.

Change: drop the custom popover. The swatch itself becomes an
`<input type="color" />` styled as a tile. Clicking it directly invokes
the OS picker.

```tsx
<input
  type="color"
  value={value}
  onChange={(e) => onChange(e.target.value)}
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
```

Note: `<input type="color">` styling is partially OS-controlled.
WebKit (Tauri's webview on macOS) renders the swatch as a small block;
we set `width`/`height` and rely on the default rendering for the
swatch. If the result looks ugly we wrap with a `<label>` that hides
the input and shows a div-styled swatch — but try the simple form
first.

The hex code text input next to the swatch stays exactly as today.

## State model summary

```ts
// Frontend (editor/)
type AppMode =
  | { kind: "projects" }
  | { kind: "editor"; project: ProjectMeta };

type ProjectMeta = {
  name: string;        // display name
  path: string;        // absolute path
  beats: number;       // for the card
  lastOpened: string;  // ISO
};

// Studio state (only when mode.kind === "editor")
type EditorState = {
  story: Story | null;
  savedJson: string;            // last known on-disk JSON
  selection: Selection;
  localDirty: boolean;          // derived from story !== savedJson
  pendingMerge: ConflictBatch | null;  // null = no conflict surfaced
};
```

```rust
// Backend (src-tauri/)
pub struct AppState {
    pub home_dir: PathBuf,                    // ~/KineticStudio
    pub active_project: Mutex<Option<ActiveProject>>,
    pub ptys: DashMap<String, PtySession>,
}

pub struct ActiveProject {
    pub path: PathBuf,
    pub watcher: notify_debouncer::Debouncer<...>,
}
```

## File map

```
src-tauri/
  Cargo.toml                         +notify, +notify-debouncer-mini, +trash, +slug
  src/
    lib.rs                           AppState gains home_dir + active_project;
                                     more command registration
    projects.rs       NEW            projects_list, projects_create,
                                     project_open, project_close
    story.rs                         load_story/save_story now read from
                                     AppState.active_project
    pty.rs                           env additions (KINETIC_PROJECT etc);
                                     +pty_paste_prompt
    skill.rs          NEW            const SKILL_TEMPLATE: &str =
                                     include_str!("../templates/skill.md")
    seed.rs           NEW            const SEED_STORY: &str = include_str!(...)
  templates/
    skill.md          NEW            the skill content (per §3)
    rc.zsh            NEW            shell rc with claude alias
    seed-story.json   NEW            starter story for new projects

editor/
  shell/
    AppShell.tsx      NEW            mode switch
    projects/
      ProjectsView.tsx                NEW
      ProjectCard.tsx                 NEW
      NewProjectForm.tsx              NEW
    editor/
      EditorView.tsx                  NEW (mostly the old App.tsx body)
  App.tsx                            shrinks: now just renders AppShell
  diff.ts             NEW            story-diff utility for §2
  resize.ts           NEW            divider-drag hook
  ColorControl.tsx                   simplified to native picker (§6)
  panel.tsx                          uses simplified ColorControl
  timeline.tsx                       no change
  player.tsx                         no change
  terminal.tsx                       reads activeProject path from a
                                     small session context (to pass to
                                     pty_open implicitly via Rust state)
  runtime.ts                         unchanged
```

## Implementation phases

The plan will split this into these phases — implementable
sequentially, each landable on its own:

- **Phase A — File-watch (the bug fix).** Watch story.json, emit
  event, frontend reloads. Conflict reconciliation included. ~3-4
  tasks. Unblocks day-to-day use.
- **Phase B — UX polish (small, parallel-safe).** Move transport,
  resizable panels, native color picker. ~3 tasks.
- **Phase C — Projects mode.** All of §1, including the home view,
  per-project save/load, the back button. ~6-8 tasks.
- **Phase D — Agent skill.** §3 — skill template + rc.zsh + shell
  alias plumbing. ~2 tasks.

A and B can ship before C — they don't depend on the projects model
(the "active project" is just the current Tauri repo). C is the big
refactor. D is small and lands last because it depends on C's
per-project directory.

## Open implementation questions for the planner

- `notify`'s API on macOS uses FSEvents, which is event-coalescing.
  `notify-debouncer-mini` is the standard wrapper; verify it's still
  the right pick in Tauri 2's tokio version.
- Whether to use `tauri-plugin-dialog` or write our own for the
  `Open Folder…` button. `tauri-plugin-dialog` is the obvious answer;
  add it.
- The skill template references `src/kinetic/schema.ts`. For a fresh
  project under `~/KineticStudio/`, that path doesn't exist. The
  template handles this by saying "IF that path exists in this
  project; otherwise the template here is authoritative." Acceptable.
