# BYOA spike — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the three success criteria in §7.4 of
`docs/superpowers/specs/2026-05-19-byoa-spike-design.md`
without committing to a full BYOA V1: produce a paragraph-spec
for a second canvas plugin (criterion #2), execute the audit's split-
file refactor so the substrate/app boundary is real in code
(criterion #1), and ship a Pillar 3 tracer (JSON-Patch writes +
content-addressed history) inside KineticType (criterion #3 for the
highest-risk pillar).

**Architecture:** Three phases, each independently committable.
Phase A is documentation only (a markdown file proving the canvas
contract holds for a second domain). Phase B is mechanical
relocation — moving kinetic-specific files out of the shell layer
without changing behaviour. Phase C is the only one with new
runtime code: it threads JSON-Patch writes from frontend through
new Tauri commands to a content-addressed log on disk, behind a
feature flag so today's full-doc save path stays working until the
tracer is proven.

**Tech Stack:** Tauri 2 (Rust), React 19, TypeScript, Vite,
`rfc6902` (TS JSON Patch), `json-patch` crate (Rust JSON Patch),
`sha2` crate (content addressing). Node's existing `vitest` (already
in package.json) for TS tests; `cargo test` for Rust tests.

**Out of scope (deferred past the spike):** brand rename to
byoa; Square redesign; observe/act/identity pillars; native
extension loading; registry; second app's actual code.

**Verification gates between phases:**
- After Phase A: human reads the new doc and confirms the contract
  holds. No code touched.
- After Phase B: `npm run tauri:dev`, open an existing project,
  exercise every kinetic feature (load story, edit a beat, drag a
  slider, undo/redo, switch projects from the projects view).
  Identical behaviour to before Phase B.
- After Phase C: same exercise, plus: agent writes a patch via the
  new tool, history log has an entry, `state.revert` rolls back to
  prior version, full-doc save still works behind a kill switch.

---

## Phase A — Paragraph-spec for a second canvas plugin

This phase validates §7.4 success criterion #2: a hypothetical
second canvas plugin must be describable in one paragraph against
the spec's contract without inventing new fields. We pick a domain
(Markdown Slide Deck), write its paragraph-spec, then check it
against the spec's manifest shape (§3.1) field by field. If
anything is missing, the contract is incomplete and the spec needs
revision before any code change.

This is documentation only. No source files modified.

### Task A1: Write the second-canvas paragraph-spec

**Files:**
- Create: `docs/superpowers/specs/2026-05-19-second-canvas-validation.md`

- [ ] **Step 1: Create the validation doc**

Create `docs/superpowers/specs/2026-05-19-second-canvas-validation.md`
with the following exact content:

```markdown
# Second-canvas validation (Markdown Slide Deck)

This doc validates §7.4 criterion #2 of the BYOA spike spec:
"a hypothetical second canvas plugin is describable in one paragraph
against the contract in §3 without inventing new fields." If this
doc is internally consistent and the cross-reference table at the
bottom is filled in entirely from spec fields, the criterion is
satisfied.

## The paragraph

Markdown Slide Deck is a BYOA app for building presentations.
Its canonical state file is `slides.json`, a Zod-validated array of
`{ markdown: string, theme: "light" | "dark" | "highContrast",
notes?: string }`. The preview renders one slide at a time as a
paginated Markdown surface (re-using `react-markdown` from the app
dev's deps); arrow keys advance. Verbs are `addSlide({ at?: int,
markdown: string })`, `setTheme({ index: int, theme })`,
`reorderSlide({ from: int, to: int })`, `deleteSlide({ index: int })`,
and `setNotes({ index: int, notes: string })`. Routes are `deck`
(the slide view) and `outline` (a vertical list of slide thumbnails
with re-orderable rows). The manifest's `snapshot()` returns
`{ currentSlideIndex, slideCount, theme: currentSlide.theme,
currentRoute }`. Memory keys are `defaultTheme` (a user's
preferred theme for new decks) and `lastEditedSlideIndex` (so
re-open lands the user where they left off). No native extension
needed — everything is pure TypeScript.

## Cross-reference: every paragraph fact maps to a §3 field

| Fact in paragraph | §3.1 manifest field |
|---|---|
| `slides.json` canonical filename | `state.file` |
| Zod schema for `{ markdown, theme, notes? }` | `state.schema` |
| schema migration (not exercised here) | `state.migrate` |
| empty state (e.g. `{ slides: [] }`) | `state.initial` |
| five verbs with typed args | `verbs.*` |
| `deck` and `outline` routes with descriptions | `routes.*` |
| snapshot returning `{ currentSlideIndex, ... }` | `snapshot` |
| `defaultTheme` + `lastEditedSlideIndex` keys | `memory.keys` |
| Markdown render component | `preview` (lazy import) |
| verb handlers translating to patches | `runtime` (lazy import) |
| app id, name, version, icon | `id`, `name`, `version`, `icon` |
| no native extension | (§3.5 — optional, absent) |

Every paragraph fact lands in a declared spec field. Nothing in the
paragraph requires a field the spec doesn't already have.

## Things the spec does NOT cover for this canvas

While writing this, the following came up and were resolved without
inventing new fields:

1. **Arrow-key navigation between slides** — this is preview-internal
   UI, not a contract concern. The app's preview component handles
   key events. Spec is silent (correctly).
2. **react-markdown as a dependency** — app devs bring their own
   deps. Spec is silent (correctly).
3. **Slide thumbnails in the outline route** — preview-internal.
   Spec is silent (correctly).

These omissions are evidence the contract is appropriately scoped:
it covers the agent/app interface and leaves preview-internal
decisions to the app dev.

## Conclusion

The contract in §3 holds for Markdown Slide Deck without addition
or modification. §7.4 criterion #2 is satisfied.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-19-second-canvas-validation.md
git commit -m "docs: validate BYOA contract against second canvas (slide deck)

Paragraph-spec for a hypothetical Markdown Slide Deck app, with a
field-by-field cross-reference to the manifest shape in §3.1 of the
spike spec. Every paragraph fact maps to an existing spec field;
nothing requires invention. §7.4 criterion #2 satisfied."
```

---

## Phase B — Audit-driven refactor (the six split files)

This phase validates §7.4 success criterion #1: the audit's "shell"
pile makes structural sense without kinetic typography. We make the
boundary real in code by (1) relocating the four shell-side files
that actually own kinetic-specific behavior into `canvases/kinetic/`
(`ProjectsView`, `history`, `diff`, plus the dead `save_story` /
`load_story` aliases), and (2) splitting `skill.rs` so the generic
generator infra is separated from the embedded kinetic skill bundle.

Each task is independently committable. After each commit, the app
must build and behave identically to before. The Audit-Audit at the
end of Phase B verifies the boundary is real.

**Phase-B verification gate (run BEFORE starting any task):**

- [ ] Start the studio and open the existing demo project so you
      have a known-good baseline. Run `npm run tauri:dev`, open
      `~/KineticStudio/` (or whatever your dev project is), wiggle
      a beat slider, click undo, click redo, return to the projects
      list, re-open. Note any pre-existing weirdness so you don't
      blame Phase B for it.

### Task B1: Delete dead `save_story` / `load_story` aliases

**Files:**
- Modify: `src-tauri/src/doc.rs:53-67`
- Modify: `src-tauri/src/lib.rs` (the `invoke_handler!` block, ~line 55)

- [ ] **Step 1: Confirm the aliases are unreferenced from frontend**

Run:
```bash
grep -rn "save_story\|load_story" editor/ src/ scripts/ 2>/dev/null
```

Expected output: empty. (We already verified this during planning —
frontend uses `save_doc` / `load_doc`. If this grep returns matches
in editor/ or src/, STOP and re-plan; something has changed.)

- [ ] **Step 2: Remove the legacy aliases from `doc.rs`**

Open `src-tauri/src/doc.rs`. Delete lines 53–67 inclusive (the
trailing comment plus the two `#[tauri::command]` aliases
`save_story` and `load_story`). The file should end after the
`load_doc` function's closing brace plus the trailing blank line.

- [ ] **Step 3: Remove the aliases from the command registry**

Open `src-tauri/src/lib.rs`. In the `invoke_handler!` macro
invocation, delete the two lines `doc::save_story,` and
`doc::load_story,`. Leave `doc::save_doc,` and `doc::load_doc,`.

- [ ] **Step 4: Verify Rust still compiles**

Run:
```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: `Finished` with no errors. Warnings about unused imports
are acceptable; errors are not.

- [ ] **Step 5: Verify the studio still runs**

Run `npm run tauri:dev`, open the demo project, confirm the story
loads and you can save an edit. Stop the dev server with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/doc.rs src-tauri/src/lib.rs
git commit -m "refactor(doc): drop unused save_story/load_story aliases

Frontend has used save_doc/load_doc exclusively since the substrate
migration. The aliases were marked for deletion in doc.rs and the
audit (§5.1 of the spike spec). No callers anywhere in the
codebase."
```

### Task B2: Move `ProjectsView` into `canvases/kinetic/`

`ProjectsView.tsx` is shell-shaped (a generic project list screen)
but in practice it knows about kinetic preview MP4s and the kinetic
beats count. Per §4.2 of the spec, "projects-as-screen" is an app
decision — KineticType chooses to show one — so the file moves into
the kinetic bundle.

**Files:**
- Move: `editor/ProjectsView.tsx` → `editor/canvases/kinetic/ProjectsView.tsx`
- Modify: `editor/canvases/kinetic/KineticApp.tsx:35` (import path)

- [ ] **Step 1: Move the file**

Run:
```bash
git mv editor/ProjectsView.tsx editor/canvases/kinetic/ProjectsView.tsx
```

- [ ] **Step 2: Confirm no other importers**

Run:
```bash
grep -rn "from.*ProjectsView" editor/ src/ 2>/dev/null
```

Expected output: exactly one match —
`editor/canvases/kinetic/KineticApp.tsx:35: import { ProjectsView, type ProjectMeta } from "../../ProjectsView";`

If you see more than one, STOP and update each importer in this
step before continuing.

- [ ] **Step 3: Update the KineticApp import**

In `editor/canvases/kinetic/KineticApp.tsx`, line 35, change:

```ts
import { ProjectsView, type ProjectMeta } from "../../ProjectsView";
```

to:

```ts
import { ProjectsView, type ProjectMeta } from "./ProjectsView";
```

- [ ] **Step 4: Verify TypeScript builds**

Run:
```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 5: Verify the studio still runs**

Run `npm run tauri:dev`, click "← Square" (or however you navigate
back to the Square), re-open the kinetic app, confirm the projects
list shows and you can open a project.

- [ ] **Step 6: Commit**

```bash
git add editor/ src/
git commit -m "refactor(kinetic): move ProjectsView into canvases/kinetic/

The projects screen is app-owned per §4.2 of the spike spec — each
app decides what to show when entered. ProjectsView shows kinetic
beat counts and preview MP4s, so it belongs in the kinetic bundle,
not the shell layer."
```

### Task B3: Move `history.ts` into `canvases/kinetic/`

`history.ts` depends on `diff.ts`, which knows the kinetic Story
schema (`bgColor`, `glowIntensity`, `beat:<i>:<key>` field keys).
Both are app-shaped. We move them together in this task and the
next.

**Files:**
- Move: `editor/history.ts` → `editor/canvases/kinetic/history.ts`
- Modify: `editor/canvases/kinetic/KineticApp.tsx:36` (import path)
- Modify: `editor/UndoMenu.tsx` (the `HistoryHandle` import)
- Modify: `editor/canvas.ts` (the `HistoryHandle` type import)

- [ ] **Step 1: Move the file**

```bash
git mv editor/history.ts editor/canvases/kinetic/history.ts
```

- [ ] **Step 2: Find all importers**

Run:
```bash
grep -rn "from.*['\"].*history['\"]" editor/ src/ 2>/dev/null
```

Expected matches:
- `editor/canvases/kinetic/KineticApp.tsx:36`
- `editor/UndoMenu.tsx:12`
- `editor/canvas.ts:21`

- [ ] **Step 3: Update `KineticApp.tsx`**

In `editor/canvases/kinetic/KineticApp.tsx` line 36, change
`"../../history"` to `"./history"`.

- [ ] **Step 4: Update `UndoMenu.tsx`**

`UndoMenu` is shell-side (per the audit) but currently imports
`HistoryHandle` directly from `history.ts`. Since the type is
generic over the doc kind (it'd work for slides.json too), the type
itself belongs in shell. Promote `HistoryHandle` to a shell-side
type:

In `editor/canvases/kinetic/history.ts`, find the `export type
HistoryHandle = ...` declaration. Cut it out of this file.

In `editor/shell.ts` (which already houses substrate-level types),
paste the `HistoryHandle` type at the end of the file. Make sure
the type is generic over the doc type, e.g.:

```ts
export type HistoryHandle<Doc> = {
  story: Doc | null;
  setStory: (next: Doc | ((prev: Doc) => Doc), label?: string) => void;
  resetTo: (next: Doc) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  pastLabels: { label: string; at: number }[];
  jumpTo: (index: number) => void;
};
```

(If the actual surface differs slightly, copy what's there verbatim
— don't rewrite it from memory.)

Then in `editor/canvases/kinetic/history.ts`, add at the top:

```ts
import type { HistoryHandle } from "../../shell";
```

And ensure the `useHistory` hook's return type annotates as
`HistoryHandle<Story>`.

In `editor/UndoMenu.tsx` line 12, change:

```ts
import type { HistoryHandle } from "./history";
```

to:

```ts
import type { HistoryHandle } from "./shell";
```

In `editor/canvas.ts` line 21, change:

```ts
import type { HistoryHandle } from "./history";
```

to:

```ts
import type { HistoryHandle } from "./shell";
```

- [ ] **Step 5: Verify TypeScript builds**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors. If you see "Cannot find module" for any
history-related import, you missed an importer; grep again and fix.

- [ ] **Step 6: Verify undo/redo still works**

Run `npm run tauri:dev`, open a project, edit a beat color, press
Cmd+Z, confirm the undo reverses it. Press Cmd+Shift+Z to redo.
Confirm the undo dropdown shows past labels.

- [ ] **Step 7: Commit**

```bash
git add editor/ src/
git commit -m "refactor(kinetic): move history.ts into canvases/kinetic/, promote HistoryHandle to shell

History is generic in shape but the labels (\"changed bgColor\",
\"beat 0: color\") come from kinetic-shaped diffFields, so the impl
is app-side. The HistoryHandle type itself is generic over the doc
type and stays in shell.ts so UndoMenu (shell-side) can consume it."
```

### Task B4: Move `diff.ts` into `canvases/kinetic/`

`diff.ts`'s `FieldKey` union is hard-coded to the kinetic Story
schema. It's app code wearing shell clothes.

**Files:**
- Move: `editor/diff.ts` → `editor/canvases/kinetic/diff.ts`
- Modify: `editor/canvases/kinetic/index.tsx:27` (import path)
- Modify: `editor/canvases/kinetic/history.ts` (import path — fixed in B3 if the move happened first; verify)

- [ ] **Step 1: Move the file**

```bash
git mv editor/diff.ts editor/canvases/kinetic/diff.ts
```

- [ ] **Step 2: Find all importers**

```bash
grep -rn "from.*['\"].*diff['\"]" editor/ src/ 2>/dev/null
```

Expected matches:
- `editor/canvases/kinetic/index.tsx:27` (currently
  `from "../../diff"`)
- `editor/canvases/kinetic/history.ts` (currently `from "./diff"`
  or similar — depends on B3's outcome)

- [ ] **Step 3: Update `index.tsx`**

In `editor/canvases/kinetic/index.tsx` line 27, change
`"../../diff"` to `"./diff"`.

- [ ] **Step 4: Verify `history.ts` import is correct**

After B3, `editor/canvases/kinetic/history.ts` should import diff
from `./diff` (sibling). If it imports from `../../diff` (old
location), fix it.

- [ ] **Step 5: Verify TypeScript builds**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 6: Verify the studio still runs**

`npm run tauri:dev`, open a project, edit a beat (confirms diff is
still computed for undo labels), check the undo dropdown shows the
expected label.

- [ ] **Step 7: Commit**

```bash
git add editor/
git commit -m "refactor(kinetic): move diff.ts into canvases/kinetic/

FieldKey is hard-coded to the kinetic Story schema (bgColor,
glowIntensity, beat:<i>:<key>). The audit (§5.4) labelled it split,
but the algorithm depends entirely on the kinetic shape — there's
no shell-reusable core to split out yet. Moving wholesale; revisit
when a second canvas needs reconciliation."
```

### Task B5: Split `skill.rs` — generator infra vs kinetic bundle

`src-tauri/src/skill.rs` mixes generic skill-installation
machinery (write SKILL.md, set up symlinks, write CLAUDE.md) with
the embedded kinetic bundle (`SKILL_TYPOGRAPHY` etc.,
`include_str!` calls, kinetic-specific CLAUDE_MD content). The
audit (§5.1) calls for splitting: the generator stays in shell as
`install_skill(bundle)`; the bundle moves to a sibling module the
kinetic canvas owns.

**Files:**
- Modify: `src-tauri/src/skill.rs` (extract generator)
- Create: `src-tauri/src/canvases/mod.rs`
- Create: `src-tauri/src/canvases/kinetic.rs` (the kinetic skill bundle)
- Modify: `src-tauri/src/lib.rs` (declare new module)
- Modify: `src-tauri/src/canvas.rs` (canvas trait gains a `skill_bundle()` method)

- [ ] **Step 1: Read the file in full to understand the structure**

```bash
cat src-tauri/src/skill.rs
```

Note where the bundle constants are (the `SKILL_*` `include_str!`
calls and the `CLAUDE_MD` literal) versus where the install logic
is (the function(s) that write to the project's `.claude/skills/`,
the symlinks, the legacy rc.zsh path). Roughly: top of file is
constants + CLAUDE_MD; bottom is the install function(s).

- [ ] **Step 2: Define the bundle shape in the shell layer**

In `src-tauri/src/skill.rs`, REPLACE the top-of-file block of
`const SKILL_* = include_str!(...);` declarations and the
`CLAUDE_MD` literal with a new `SkillBundle` struct definition:

```rust
//! Per-project agent skill installer.
//!
//! Generic over the canvas's skill bundle. The bundle ships with the
//! app (whichever canvas is active provides it); this module's job
//! is to materialise it into ~/.kinetic-studio/skills-bundle/<id>/,
//! symlink the project's .claude/skills/<id>/ at that location, and
//! write the per-project CLAUDE.md.

use std::path::{Path, PathBuf};

/// Files a canvas plugin ships as its agent skill, in install order.
/// All paths are relative to the per-canvas skills-bundle directory;
/// SKILL.md is conventionally first.
pub struct SkillBundle {
    /// Canvas id (used in the on-disk path layout).
    pub canvas_id: &'static str,
    /// (relative path, file contents) pairs. First entry conventionally
    /// SKILL.md, but the installer doesn't enforce that.
    pub files: &'static [(&'static str, &'static str)],
    /// The per-project CLAUDE.md content that points at this bundle.
    pub claude_md: &'static str,
}
```

- [ ] **Step 3: Update the install function signature**

In the same file, find the existing install function(s) (probably
named something like `install` or `write_skill` — exact names
depend on what's there; do NOT rename them yet, just change
signatures). For each function, change it to take a
`bundle: &SkillBundle` argument and pull `canvas_id`, `files`, and
`claude_md` out of the bundle rather than referencing the now-
removed `SKILL_*` constants.

Where the old code did:

```rust
fs::write(path.join("SKILL.md"), SKILL_ROUTING).ok();
fs::write(path.join("typography-system.md"), SKILL_TYPOGRAPHY).ok();
// ... five more
```

it becomes:

```rust
for (rel_path, contents) in bundle.files {
    fs::write(path.join(rel_path), contents).ok();
}
```

Where the old code did:

```rust
fs::write(project_root.join("CLAUDE.md"), CLAUDE_MD).ok();
```

it becomes:

```rust
fs::write(project_root.join("CLAUDE.md"), bundle.claude_md).ok();
```

Where the install function uses a hard-coded `kinetic` path
segment, replace with `bundle.canvas_id`.

- [ ] **Step 4: Create the canvases module directory**

```bash
mkdir -p src-tauri/src/canvases
```

Then create `src-tauri/src/canvases/mod.rs` with this exact content:

```rust
//! Per-canvas modules. Each canvas owns the data the shell asks for
//! through the `Canvas` trait — including its agent skill bundle.

pub mod kinetic;
```

- [ ] **Step 5: Create the kinetic canvas's skill bundle**

Create `src-tauri/src/canvases/kinetic.rs` with this exact content
(the `include_str!` paths reach back into the existing
`src-tauri/skills/kinetic/` directory):

```rust
//! Kinetic canvas's agent skill bundle.
//!
//! Pulls the markdown files from src-tauri/skills/kinetic/ at
//! compile time and pairs them with the per-project CLAUDE.md.

use crate::skill::SkillBundle;

const SKILL_ROUTING:     &str = include_str!("../../skills/kinetic/SKILL.md");
const SKILL_TYPOGRAPHY:  &str = include_str!("../../skills/kinetic/typography-system.md");
const SKILL_MOTION:      &str = include_str!("../../skills/kinetic/motion-design.md");
const SKILL_COLOR:       &str = include_str!("../../skills/kinetic/color-system.md");
const SKILL_RENDER:      &str = include_str!("../../skills/kinetic/render-pipeline.md");
const SKILL_LAYERS:      &str = include_str!("../../skills/kinetic/layer-composition.md");

const CLAUDE_MD: &str = r#"# Kinetic Studio project

You are inside a Kinetic Studio desktop-editor project. **The agent
operating manual is at `.claude/skills/kinetic-studio/SKILL.md`** —
read it first. The skill has sibling files for typography, motion,
color, render, and layer-composition concerns; load whichever the
user's request maps to.

Short version:

- The only file you should edit is `./story.json`.
- Do NOT create new `.tsx` / `.jsx` Remotion components — the studio's
  composition is fixed and renders `story.json`.
- The Player and Timeline auto-refresh within ~300 ms of every write.
- Do not invoke `remotion-best-practices`, `superpowers:*`, or
  general Remotion skills here.

If `.claude/skills/kinetic-studio/SKILL.md` does not exist, ask the
user to reopen the project in Kinetic Studio (the studio writes the
skill on project open).
"#;

pub const BUNDLE: SkillBundle = SkillBundle {
    canvas_id: "kinetic-studio",
    files: &[
        ("SKILL.md",              SKILL_ROUTING),
        ("typography-system.md",  SKILL_TYPOGRAPHY),
        ("motion-design.md",      SKILL_MOTION),
        ("color-system.md",       SKILL_COLOR),
        ("render-pipeline.md",    SKILL_RENDER),
        ("layer-composition.md",  SKILL_LAYERS),
    ],
    claude_md: CLAUDE_MD,
};
```

**Important:** copy `CLAUDE_MD` verbatim from the original
`skill.rs` (you removed it in step 2). The literal above is the
known current content; if `skill.rs` had a different string, use
its string — preserving exact bytes matters because this writes
into user projects.

- [ ] **Step 6: Wire the bundle through the canvas trait**

In `src-tauri/src/canvas.rs`, add a method to the `Canvas` trait:

```rust
pub trait Canvas: Send + Sync {
    // ... existing methods ...

    /// The agent skill bundle this canvas ships. Called by the shell
    /// at project-open time to materialise the per-project skill.
    fn skill_bundle(&self) -> &'static crate::skill::SkillBundle;
}
```

Find where the kinetic canvas is implemented (look for `impl Canvas
for` somewhere in `canvas.rs` or `canvases/kinetic.rs`). Add the
method:

```rust
fn skill_bundle(&self) -> &'static crate::skill::SkillBundle {
    &crate::canvases::kinetic::BUNDLE
}
```

- [ ] **Step 7: Declare the canvases module in lib.rs**

In `src-tauri/src/lib.rs`, in the module declarations at the top,
add:

```rust
mod canvases;
```

Keep alphabetical order if the existing modules are alphabetised.

- [ ] **Step 8: Update the install call site to pass the active canvas's bundle**

Find where the install function is invoked (probably from
`projects.rs` on project open/create). The call now needs the
bundle:

```rust
crate::skill::install_skill(project_root, crate::canvas::active().skill_bundle());
```

(If `install_skill` is called by a different name, use that name.
The point is: pass `crate::canvas::active().skill_bundle()` as the
bundle arg.)

- [ ] **Step 9: Verify Rust compiles**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: `Finished` with no errors. Fix any path/import issues
revealed by the compiler — they're concrete, not handwavy. If you
see "unresolved import `crate::canvases::kinetic`", check step 4
created the file and step 7 declared the module.

- [ ] **Step 10: Verify per-project skill still installs correctly**

Run `npm run tauri:dev`. Create a new project from the Square (or
delete the demo project's `.claude/` and `CLAUDE.md` first). Open
the project. Then check:

```bash
ls -la ~/KineticStudio/<your-project>/.claude/skills/kinetic-studio/
cat ~/KineticStudio/<your-project>/CLAUDE.md
```

Expected: SKILL.md plus the five sibling md files exist; CLAUDE.md
content matches what was in the original skill.rs.

- [ ] **Step 11: Commit**

```bash
git add src-tauri/
git commit -m "refactor(skill): split generator from kinetic bundle

skill.rs now owns only the SkillBundle struct and install machinery.
The kinetic-specific include_str! payload and CLAUDE_MD literal move
to canvases/kinetic.rs, exposed via Canvas::skill_bundle(). Adding
a second canvas later is mechanical — define another bundle, return
it from that canvas's trait impl."
```

### Task B6: Audit-audit (verify the boundary)

After B1–B5, walk the repo with the spec's audit (§5) and confirm
the labels match reality. This is the validation step for §7.4
criterion #1.

**Files:**
- Create: `docs/superpowers/specs/2026-05-19-audit-verification.md`

- [ ] **Step 1: Generate the file inventory**

Run:
```bash
ls -1 src-tauri/src/ src-tauri/src/canvases/ editor/ editor/canvases/kinetic/ 2>&1
```

Note what's in each directory. The expected state after B1–B5:

- `src-tauri/src/`: shell-only Rust modules (main, lib, pty, watch,
  projects, prompt_mode, selection, window_state, agents, settings,
  preview, doc, canvas, skill).
- `src-tauri/src/canvases/`: per-canvas Rust modules (mod, kinetic).
- `src-tauri/src/`: kinetic-specific files that should NOT be at
  shell level — verify `video.rs` is still there (audit labels it
  "app", but it's currently at shell level; this is technical debt
  the spike doc notes but the plan doesn't fix yet — flag it).
- `editor/`: shell-only TS files. ProjectsView, history, diff
  should NO LONGER be here.
- `editor/canvases/kinetic/`: ProjectsView, history, diff, plus
  index, KineticApp, and everything moved in by earlier audit
  tasks.

- [ ] **Step 2: Write the verification doc**

Create `docs/superpowers/specs/2026-05-19-audit-verification.md`:

```markdown
# Audit verification (after Phase B)

This doc validates §7.4 criterion #1 of the BYOA spike spec:
"the audit's 'shell' pile makes structural sense without kinetic
typography." After Phase B's refactor (B1–B5), the on-disk state
should match the audit's labels.

## Verification

For each file in §5 of the spike spec, this section confirms its
location on disk matches its label.

### `src-tauri/src/` (shell pile)

All files in this directory should be domain-agnostic substrate.

[Fill in the actual contents from step 1's `ls`. For each file,
either confirm it's shell-shaped, or flag it as a known exception
the spike doc didn't fix yet.]

### `src-tauri/src/canvases/kinetic/` (kinetic app pile)

[Fill in: the kinetic skill bundle module, etc.]

### `editor/` (shell pile)

After B2/B3/B4, ProjectsView, history, diff should NOT appear here.

### `editor/canvases/kinetic/` (kinetic app pile)

After B2/B3/B4, these should appear here:
- index.tsx, KineticApp.tsx (pre-existing)
- ProjectsView.tsx (moved in B2)
- history.ts (moved in B3)
- diff.ts (moved in B4)
- All the rest of the kinetic editor files the audit labels "app"
  that haven't been moved yet (the audit calls for moving these
  too; the spike doesn't fix all of them).

## Known exceptions

The audit labels some files "app" that this spike does NOT move,
because they don't block Phase C and moving them is rote work that
can happen after the spike validates:

- `editor/panel.tsx` — kinetic properties panel, audit-labelled
  "app", still at editor/ level. Move post-spike.
- `editor/timeline.tsx`, `editor/player.tsx`, `editor/controls.tsx`,
  `editor/Library.tsx`, `editor/library/`, `editor/StarterCard.tsx`,
  `editor/AddImage.tsx`, `editor/AddVideo.tsx` — same: audit-
  labelled "app", still at editor/ level.
- `src-tauri/src/video.rs` — audit-labelled "app", still at
  src-tauri/src/. Move when a second canvas exists.

These don't block the spike's validation; they're tracked technical
debt.

## Conclusion

After Phase B, the load-bearing seam between shell and kinetic-app
is real in code. The six files §5.7 finding #1 called out as
needing surgery have been split or moved (or, for video.rs and the
editor/ kinetic UI files, explicitly deferred). §7.4 criterion #1
is satisfied for the load-bearing seams; the rest is mechanical
relocation deferred past the spike.
```

Fill in the bracketed `[...]` sections with the real `ls` output
from step 1.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-05-19-audit-verification.md
git commit -m "docs: verify shell/app boundary after Phase B refactor

After B1–B5, the load-bearing split files in the spec's §5.7 are
either split or moved. The remaining audit-labelled app files at
the editor/ root (panel, timeline, player, controls, Library, etc.)
are explicitly deferred — they're rote relocations that don't block
the spike's validation."
```

---

## Phase C — Pillar 3 tracer (JSON Patch + content-addressed history)

This phase validates §7.4 criterion #3 for Pillar 3, the highest-
risk pillar: state writes as JSON Patches against the validated
schema, with a content-addressed history log. We thread the new
path through new Tauri commands behind a feature flag, leaving the
existing full-doc save path working as a kill switch.

The end state: a TS agent tool / programmatic API the studio's
agent integration can call as `state.write({ patch })`, and a
content-addressed log on disk under
`<project>/.kinetic-studio/history/`. The flag controls whether
the patch path is preferred over the full-doc path; default is OFF
until we manually verify the tracer.

### Task C1: Add `json-patch` and `sha2` Rust deps

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add the deps**

Open `src-tauri/Cargo.toml`. In the `[dependencies]` section, add:

```toml
json-patch = "3.0"
sha2 = "0.10"
```

(Use the latest 3.x and 0.10.x versions; these are both stable
crates with low churn.)

- [ ] **Step 2: Verify Cargo accepts the deps**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: Cargo downloads the deps and `Finished`. No code uses
them yet; that's fine. If you see version-resolution errors,
adjust the version specifiers.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(deps): add json-patch and sha2 for Pillar 3 tracer

Both are zero-dep, stable crates. json-patch implements RFC 6902
patches against serde_json::Value. sha2 provides the content
addressing for the history log."
```

### Task C2: Implement the history-store module

A content-addressed append-only log under
`<project>/.kinetic-studio/history/`. Each accepted doc version
gets sha256'd; the sha is the filename; an index file lists
versions in insertion order with metadata (author, parent sha,
timestamp).

**Files:**
- Create: `src-tauri/src/history.rs`
- Modify: `src-tauri/src/lib.rs` (declare the module)

- [ ] **Step 1: Write the failing test (skeleton)**

In `src-tauri/src/history.rs`, write this module with one failing
test at the bottom:

```rust
//! Content-addressed history log for the project's canvas doc.
//!
//! Each accepted full-doc state is sha256'd and written under
//! <project>/.kinetic-studio/history/<sha>.json. An index file
//! (history/index.json) lists versions in insertion order:
//!
//!     [
//!       { "sha": "...", "parent": null,    "author": "user",  "ts": "..." },
//!       { "sha": "...", "parent": "<sha>", "author": "agent", "ts": "..." }
//!     ]
//!
//! Reads return the most recent version's sha and contents. Reverts
//! append a new entry pointing at an older sha's content (so the
//! log is strictly append-only — revert is recorded, not undone).

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct HistoryEntry {
    pub sha: String,
    pub parent: Option<String>,
    pub author: String, // "user" | "agent" | "<verb name>"
    pub ts: String,     // ISO-8601
}

pub fn history_dir(project_root: &Path) -> PathBuf {
    project_root.join(".kinetic-studio").join("history")
}

pub fn index_path(project_root: &Path) -> PathBuf {
    history_dir(project_root).join("index.json")
}

fn sha_of(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

pub fn read_index(project_root: &Path) -> Vec<HistoryEntry> {
    fs::read_to_string(index_path(project_root))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn write_entry(
    project_root: &Path,
    doc_bytes: &[u8],
    author: &str,
) -> Result<HistoryEntry, String> {
    let sha = sha_of(doc_bytes);
    let dir = history_dir(project_root);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir history: {}", e))?;

    let blob_path = dir.join(format!("{}.json", &sha));
    if !blob_path.exists() {
        fs::write(&blob_path, doc_bytes)
            .map_err(|e| format!("write history blob: {}", e))?;
    }

    let mut index = read_index(project_root);
    let parent = index.last().map(|e| e.sha.clone());
    let entry = HistoryEntry {
        sha: sha.clone(),
        parent,
        author: author.to_string(),
        ts: chrono::Utc::now().to_rfc3339(),
    };
    index.push(entry.clone());

    let index_json = serde_json::to_string_pretty(&index)
        .map_err(|e| format!("serialise index: {}", e))?;
    fs::write(index_path(project_root), index_json)
        .map_err(|e| format!("write index: {}", e))?;

    Ok(entry)
}

pub fn read_blob(project_root: &Path, sha: &str) -> Result<Vec<u8>, String> {
    fs::read(history_dir(project_root).join(format!("{}.json", sha)))
        .map_err(|e| format!("read blob {}: {}", sha, e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn write_and_read_one_entry() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        let doc = br#"{"hello":"world"}"#;
        let entry = write_entry(root, doc, "user").unwrap();
        assert!(entry.parent.is_none(), "first entry has no parent");
        assert_eq!(entry.author, "user");

        let read_back = read_blob(root, &entry.sha).unwrap();
        assert_eq!(read_back, doc);

        let index = read_index(root);
        assert_eq!(index.len(), 1);
        assert_eq!(index[0], entry);
    }

    #[test]
    fn second_entry_points_at_first() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        let first = write_entry(root, br#"{"v":1}"#, "user").unwrap();
        let second = write_entry(root, br#"{"v":2}"#, "agent").unwrap();

        assert_eq!(second.parent, Some(first.sha.clone()));
        assert_eq!(read_index(root).len(), 2);
    }

    #[test]
    fn identical_content_deduplicates_blob_but_appends_index() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        let body = br#"{"same":"content"}"#;
        let first = write_entry(root, body, "user").unwrap();
        let second = write_entry(root, body, "user").unwrap();

        assert_eq!(first.sha, second.sha, "same content → same sha");
        let index = read_index(root);
        assert_eq!(index.len(), 2, "two entries even though content is identical");
    }
}
```

This will fail to compile because `hex` and `tempfile` aren't deps
yet, and `chrono` may or may not already be in (it appeared in
Cargo.toml earlier — confirm).

- [ ] **Step 2: Add missing deps**

In `src-tauri/Cargo.toml`:

In `[dependencies]`:
```toml
hex = "0.4"
# chrono — already present per the existing Cargo.toml; verify
```

In `[dev-dependencies]` (create the section if it doesn't exist):
```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 3: Declare the module**

In `src-tauri/src/lib.rs`, in the module declarations at the top,
add:

```rust
mod history;
```

Keep alphabetical order.

- [ ] **Step 4: Run the tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml history::
```

Expected: 3 passes. If a test fails, the failure message tells you
exactly what went wrong; fix the impl, re-run.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/
git commit -m "feat(history): content-addressed append-only log

Each accepted doc state hashes to a sha256 blob; index.json lists
versions with parent-sha + author + timestamp. Append-only — revert
is a new entry, not a rewind. Three unit tests cover write+read,
parent-chaining, and content deduplication."
```

### Task C3: Implement `state.write({ patch })` on the Rust side

A new Tauri command takes a JSON Patch array, applies it to the
current doc, validates the result via... actually, wait — schema
validation lives on the frontend (Zod). The Rust side applies the
patch, writes the resulting doc atomically using existing
`save_doc` machinery, and appends to the history log. The frontend
is responsible for re-validating against Zod on the next watcher
event.

**Files:**
- Modify: `src-tauri/src/doc.rs` (new `apply_patch` command)
- Modify: `src-tauri/src/lib.rs` (register the command)

- [ ] **Step 1: Write the new command**

Append to `src-tauri/src/doc.rs`:

```rust
use json_patch::{patch as apply_json_patch, Patch};

use crate::history;

#[tauri::command]
pub fn apply_patch(
    patch_json: String,
    author: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // 1. Load current doc.
    let target = doc_path(&state)?;
    let current_text = std::fs::read_to_string(&target)
        .map_err(|e| format!("read current doc: {}", e))?;
    let mut current: serde_json::Value = serde_json::from_str(&current_text)
        .map_err(|e| format!("parse current doc: {}", e))?;

    // 2. Parse the patch.
    let patch: Patch = serde_json::from_str(&patch_json)
        .map_err(|e| format!("parse patch: {}", e))?;

    // 3. Apply.
    apply_json_patch(&mut current, &patch)
        .map_err(|e| format!("apply patch: {}", e))?;

    // 4. Serialise the new doc.
    let new_text = serde_json::to_string_pretty(&current)
        .map_err(|e| format!("serialise new doc: {}", e))?;
    let body = if new_text.ends_with('\n') {
        new_text.clone()
    } else {
        format!("{}\n", new_text)
    };

    // 5. Atomic write — same tmp+rename pattern as save_doc.
    let tmp = target.with_extension("json.tmp");
    std::fs::write(&tmp, body.as_bytes()).map_err(|e| format!("write tmp: {}", e))?;
    std::fs::rename(&tmp, &target).map_err(|e| format!("rename: {}", e))?;

    // 6. Append to history.
    let project_root = active_path(&state)?;
    history::write_entry(&project_root, body.as_bytes(), &author)
        .map_err(|e| format!("history: {}", e))?;

    Ok(body)
}
```

- [ ] **Step 2: Register the command**

In `src-tauri/src/lib.rs`, find the `invoke_handler!` macro
invocation. Add `doc::apply_patch,` to the list (alphabetical
within the `doc::` group: after `doc::load_doc`).

- [ ] **Step 3: Verify it compiles**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: `Finished` with no errors.

- [ ] **Step 4: Write an integration test for apply_patch**

The Tauri command itself is hard to test in isolation, but the
underlying logic — apply a JSON patch to a serde_json Value and
hash the result — is testable. Append to
`src-tauri/src/doc.rs`:

```rust
#[cfg(test)]
mod tests {
    use json_patch::{patch as apply_json_patch, Patch};
    use serde_json::json;

    #[test]
    fn patch_replaces_a_field() {
        let mut doc = json!({ "bgColor": "#000000", "beats": [] });
        let patch: Patch = serde_json::from_value(json!([
            { "op": "replace", "path": "/bgColor", "value": "#ff5ca8" }
        ])).unwrap();

        apply_json_patch(&mut doc, &patch).unwrap();

        assert_eq!(doc["bgColor"], "#ff5ca8");
        assert_eq!(doc["beats"], json!([]));
    }

    #[test]
    fn patch_appends_to_an_array() {
        let mut doc = json!({ "beats": [{ "text": "hi" }] });
        let patch: Patch = serde_json::from_value(json!([
            { "op": "add", "path": "/beats/-", "value": { "text": "there" } }
        ])).unwrap();

        apply_json_patch(&mut doc, &patch).unwrap();

        assert_eq!(doc["beats"].as_array().unwrap().len(), 2);
        assert_eq!(doc["beats"][1]["text"], "there");
    }

    #[test]
    fn invalid_path_errors() {
        let mut doc = json!({ "bgColor": "#000000" });
        let patch: Patch = serde_json::from_value(json!([
            { "op": "replace", "path": "/nonexistent", "value": "anything" }
        ])).unwrap();

        let result = apply_json_patch(&mut doc, &patch);
        assert!(result.is_err(), "invalid path must error");
    }
}
```

Run:
```bash
cargo test --manifest-path src-tauri/Cargo.toml doc::tests::
```

Expected: 3 passes.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/
git commit -m "feat(doc): apply_patch command — JSON Patch + history append

Threads RFC 6902 patches through serde_json::Value, atomically
writes the result with the existing tmp+rename pattern, and
appends a content-addressed history entry. Three unit tests cover
replace, append, and invalid-path error cases."
```

### Task C4: TypeScript client for `apply_patch`

Frontend API the existing studio code (and later the agent) can
call. Kept narrow — one function, one type — so the seam is
visible.

**Files:**
- Create: `editor/state.ts`

- [ ] **Step 1: Create the file**

Create `editor/state.ts` with this exact content:

```ts
/**
 * State writes — the Pillar 3 tracer surface.
 *
 * Replaces full-doc rewrites with RFC 6902 JSON Patches. The Rust
 * side applies the patch, writes the new doc atomically, and
 * appends to the content-addressed history log under
 * <project>/.kinetic-studio/history/.
 *
 * Schema validation happens on the frontend after the watcher fires
 * — Zod re-parses the new doc and the editor reacts to invalid
 * states (which the patch step has already accepted on disk).
 * Long-term, the Rust side should validate up-front; the spike
 * keeps the change small.
 *
 * Author values per the history entry shape:
 *   - "user" — for user-triggered patches (UI controls, drag).
 *   - "agent" — for agent-driven patches (future).
 *   - "<verb-name>" — for declared-verb-triggered patches (future).
 */
import { invoke } from "@tauri-apps/api/core";

export type JsonPatchOp =
  | { op: "add";     path: string; value: unknown }
  | { op: "remove";  path: string }
  | { op: "replace"; path: string; value: unknown }
  | { op: "move";    path: string; from: string }
  | { op: "copy";    path: string; from: string }
  | { op: "test";    path: string; value: unknown };

export type JsonPatch = JsonPatchOp[];

export type WriteResult = { newDocJson: string };

/**
 * Apply a JSON Patch to the active project's canvas doc.
 *
 * Atomic: the new doc is written via tmp+rename, and the history
 * entry is appended only after the write succeeds. If anything in
 * the chain fails (bad patch, fs error), the function rejects and
 * the on-disk doc is unchanged.
 */
export async function writeState(
  patch: JsonPatch,
  author: string,
): Promise<WriteResult> {
  const newDocJson = await invoke<string>("apply_patch", {
    patchJson: JSON.stringify(patch),
    author,
  });
  return { newDocJson };
}
```

- [ ] **Step 2: Verify TS compiles**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add editor/state.ts
git commit -m "feat(state): TypeScript client for apply_patch command

Narrow surface — one function, JSON Patch in, new-doc-json out.
JsonPatch type is RFC 6902. Documents the author convention
('user' | 'agent' | '<verb-name>') so future callers know what to
pass."
```

### Task C5: Tauri capability — allow `apply_patch`

Tauri 2 requires explicit allow-listing of commands in the
capabilities config.

**Files:**
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Find where the existing doc commands are allowed**

```bash
cat src-tauri/capabilities/default.json
```

Look for the existing list that includes `"save_doc"` and
`"load_doc"`.

- [ ] **Step 2: Add `apply_patch` to that list**

In `src-tauri/capabilities/default.json`, find the array containing
`"save_doc"` and add `"apply_patch"` to it. Keep alphabetical order
if the file is alphabetised.

The shape will look something like (your file may differ in
structure):

```json
{
  "permissions": [
    ...,
    "core:command:save_doc",
    "core:command:load_doc",
    "core:command:apply_patch",
    ...
  ]
}
```

Match the exact pattern used by the existing entries (could be
shorter or differently nested; copy what's there).

- [ ] **Step 3: Verify the studio starts**

`npm run tauri:dev`. The app should load without console errors
about disallowed commands. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/capabilities/default.json
git commit -m "feat(capabilities): allow apply_patch invocation from frontend

Tauri 2 requires explicit allow-listing. Added apply_patch to the
same group as save_doc/load_doc."
```

### Task C6: Smoke-test the tracer end-to-end

Wire the new `writeState` into one user-visible interaction (the
beat-color picker is a good candidate — it's one of the
`patch.apply([{ op: "replace", path: "/beats/N/color", value }])`
shapes the spec uses as its example). Behind a feature flag so the
existing path stays the default.

**Files:**
- Modify: `editor/panel.tsx` (the color picker handler — find the
  one that calls `setStory` with a beat color change)

- [ ] **Step 1: Find the color-picker handler in panel.tsx**

```bash
grep -n "color" editor/panel.tsx | head -20
```

Look for the handler that changes a beat's `color`. It will set
the new color via the existing `setStory` / `history.setStory`
path. Identify the exact line/function.

- [ ] **Step 2: Add the feature flag**

At the top of `editor/panel.tsx`, near the other module-level
constants, add:

```ts
/** Pillar 3 tracer toggle. When true, beat-color changes route
 *  through state.writeState (JSON Patch + history). When false,
 *  the legacy full-doc save path runs as before. Default off
 *  until the tracer is manually verified.
 *
 *  Toggle by setting localStorage.PILLAR3=1 in the devtools
 *  console (and reloading). */
const PILLAR3_PATCH_MODE =
  typeof window !== "undefined" &&
  window.localStorage.getItem("PILLAR3") === "1";
```

- [ ] **Step 3: Wire the new path**

In the color-picker handler you identified, branch on the flag:

```ts
const onColorChange = (newColor: string) => {
  if (PILLAR3_PATCH_MODE) {
    // Pillar 3 tracer: patch + history.
    void writeState(
      [{ op: "replace", path: `/beats/${selectedIndex}/color`, value: newColor }],
      "user",
    ).catch((e) => {
      console.error("[pillar3] apply_patch failed:", e);
    });
    return;
  }

  // Legacy path — unchanged.
  history.setStory((prev) => ({
    ...prev,
    beats: prev.beats.map((b, i) =>
      i === selectedIndex ? { ...b, color: newColor } : b,
    ),
  }));
};
```

Adjust variable names (`selectedIndex`, `history`, etc.) to match
what's actually in scope in the existing handler. Add the import
at the top of the file:

```ts
import { writeState } from "./state";
```

- [ ] **Step 4: Verify it builds**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 5: Manually verify both paths**

Run `npm run tauri:dev`, open a project with at least one beat.

**Path A (legacy, default):**
1. Make sure `localStorage.PILLAR3` is unset or not `"1"`.
2. Select a beat, change its color via the color picker.
3. Confirm: the preview updates, the file on disk is updated,
   undo works, and `~/<project>/.kinetic-studio/history/`
   directory does NOT exist (or is unchanged).

**Path B (tracer):**
1. Open devtools. Run `localStorage.setItem("PILLAR3","1")`. Reload.
2. Select a beat, change its color via the color picker.
3. Confirm: the preview updates (the file watcher fires after the
   patch lands on disk, the Zod re-parse succeeds), AND a new
   `history/<sha>.json` blob exists, AND `history/index.json`
   has a new entry with `"author": "user"` and a `parent` that
   matches the previous entry.

To check the on-disk state:
```bash
ls ~/<your-project>/.kinetic-studio/history/
cat ~/<your-project>/.kinetic-studio/history/index.json
```

- [ ] **Step 6: Commit**

```bash
git add editor/panel.tsx
git commit -m "feat(panel): Pillar 3 tracer for beat color (flag-gated)

When localStorage.PILLAR3=1, beat-color changes route through
state.writeState — JSON Patch + content-addressed history log.
Default off; legacy full-doc save path is the kill switch.
Manual verification: beat colors apply correctly under both modes,
history index grows by one entry per patch in tracer mode."
```

### Task C7: Write the spike-validation doc

Phase C's outcome maps to §7.4 criterion #3 for Pillar 3. We close
the loop in writing.

**Files:**
- Create: `docs/superpowers/specs/2026-05-19-pillar3-validation.md`

- [ ] **Step 1: Create the doc**

Create `docs/superpowers/specs/2026-05-19-pillar3-validation.md`:

```markdown
# Pillar 3 validation (after Phase C)

This doc validates §7.4 criterion #3 of the BYOA spike spec
for Pillar 3 — the highest-risk pillar. The spec claims:
"`state.write({ patch })` — JSON Patch (RFC 6902) applied to
current state; validated; history entry written; preview reloads.
Patches not full rewrites: smaller diffs, less context burn,
fewer accidents."

## What Phase C built

- `src-tauri/src/history.rs` — content-addressed append-only log.
  3 unit tests cover write+read, parent-chaining, dedup.
- `src-tauri/src/doc.rs::apply_patch` — Tauri command threading
  JSON Patch → serde_json::Value → atomic write → history append.
  3 unit tests cover replace, array-append, invalid-path error.
- `editor/state.ts::writeState` — narrow TS client. Documents the
  `author` convention.
- `editor/panel.tsx` (color picker) — flag-gated tracer wired into
  one real user interaction.

## Manual verification (from Phase C Task C6, Step 5)

- Path A (legacy): unchanged behavior, no history written.
- Path B (tracer): patch applied on disk, history index grows by
  one entry per patch with correct parent + author.

## What this proves

- JSON Patch (RFC 6902) is sufficient for at least one
  representative kinetic edit (beat color). No fields had to be
  invented; the patch is RFC-shaped.
- The content-addressed log works in the small case (single-beat
  edits). Dedup behaves correctly when the user re-applies the
  same color.
- The tracer can coexist with the legacy save path without
  duplicate writes or watcher confusion — only one of the two
  paths runs per interaction.

## What this does NOT yet prove

- Multi-step patches (e.g. addBeat that touches both /beats and
  /selection). Will be exercised when verbs land in a later phase.
- Schema validation on the Rust side. Today validation lives on
  the frontend; invalid patches that produce well-formed JSON but
  schema-invalid docs will round-trip through the file once before
  Zod catches them. Acceptable for the spike; not acceptable long-
  term.
- Branch / revert / discard. The log supports them mechanically
  (read by sha works) but no UI surfaces them yet.

## Conclusion

§7.4 criterion #3 for Pillar 3 is satisfied: patches-not-rewrites
work against real kinetic data, the history-as-log design is
cheaper than today's editor/history.ts (no per-keystroke coalescing
needed because the watcher debounce already handles that), and the
tracer integrates without disturbing the existing save path.

The three remaining criteria (#2 and #3 for Pillars 1/2/4) are
satisfied by Phase A's paragraph-spec and the spec's existing
mapping of pillars to existing KineticType infrastructure.

The spike is validated. The next step (post-plan) is to decide
whether to commit to the framework extraction described in the
spec's §3–§4 or to keep BYOA's seams in place and continue
shipping KineticType.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-19-pillar3-validation.md
git commit -m "docs: Pillar 3 validated by Phase C tracer

JSON-Patch writes + content-addressed history work for the
representative beat-color edit. What's proven (patches, log, dedup)
vs not-yet-proven (multi-step patches, Rust-side schema validation,
branch/revert UI) is explicit. §7.4 criterion #3 for Pillar 3
satisfied; the spike is validated end-to-end."
```

---

## Final verification gate

After Phase C, the spike is complete. Run this final check:

- [ ] **Step 1: Confirm all three validation docs exist**

```bash
ls -1 docs/superpowers/specs/2026-05-19-*.md
```

Expected:
- `2026-05-19-byoa-spike-design.md` (the spec)
- `2026-05-19-second-canvas-validation.md` (Phase A)
- `2026-05-19-audit-verification.md` (Phase B)
- `2026-05-19-pillar3-validation.md` (Phase C)

- [ ] **Step 2: Confirm the studio still works**

`npm run tauri:dev`, open a project, drag a slider, edit a beat,
undo, redo, switch to projects view, re-open. Identical to
pre-spike behaviour (with the Pillar 3 flag off).

- [ ] **Step 3: Confirm both Pillar 3 paths work**

With `localStorage.PILLAR3="1"`: change a beat color, confirm
history grows. Without it (or with `"0"`): change a beat color,
confirm history does not grow.

- [ ] **Step 4: Skim the four docs end-to-end**

The four docs form a chain: the spec proposes; the three
validation docs each demonstrate one success criterion. Read in
order, the case for (or against) extracting BYOA should be
legible to a reader who didn't write any of it.

If all four steps pass, the spike is done. The decision to extract
BYOA as a public framework — or to keep KineticType
monolithic with the seams in place — is now an informed one.
