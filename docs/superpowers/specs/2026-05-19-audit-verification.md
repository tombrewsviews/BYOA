# Audit verification (after Phase B)

This doc validates §7.4 criterion #1 of the BYOA spike spec:
"the audit's 'shell' pile makes structural sense without kinetic
typography." After Phase B's refactor (B1–B5), the on-disk state
should match the audit's labels for the load-bearing seams.

## What Phase B did

Five commits on master:

- **B1** — removed dead `save_story` / `load_story` Tauri-command aliases (`src-tauri/src/doc.rs`, `src-tauri/src/lib.rs`).
- **B2** — moved `editor/ProjectsView.tsx` → `editor/canvases/kinetic/ProjectsView.tsx`.
- **B3** — moved `editor/history.ts` → `editor/canvases/kinetic/history.ts`; promoted `HistoryHandle<Doc>` and `HistoryEntry<Doc>` types into `editor/shell.ts` so shell-side consumers (`UndoMenu.tsx`, `canvas.ts`) remain doc-agnostic.
- **B4** — moved `editor/diff.ts` → `editor/canvases/kinetic/diff.ts`. Field-key reconciliation algorithm was hard-coded to the kinetic Story schema; no shell-reusable core to split out yet.
- **B5** — split `src-tauri/src/skill.rs` into generator (`pub struct SkillBundle` + `pub fn write`) and kinetic payload (`src-tauri/src/canvases/kinetic.rs` exporting `pub const BUNDLE: SkillBundle`). Added `fn skill_bundle()` to the `Canvas` trait. Adding a second canvas's skill is now mechanical.

## Verification

### `src-tauri/src/` (shell pile)

Current contents:

```
agents.rs
canvas.rs
canvases
doc.rs
lib.rs
main.rs
preview.rs
projects.rs
prompt_mode.rs
pty.rs
selection.rs
settings.rs
skill.rs
video.rs
watch.rs
window_state.rs
```

Of these, all should be domain-agnostic substrate per §5.1 of the audit EXCEPT `video.rs`, which is audit-labelled "app" but still at shell level (see Known exceptions below). The new `canvases/` subdirectory is the per-canvas module home introduced in B5; its contents are app-specific by design.

### `src-tauri/src/canvases/` (per-canvas Rust modules)

Current contents:

```
kinetic.rs
mod.rs
```

This directory was created in B5. It holds the kinetic canvas's skill bundle plus the module declaration. Per audit §5.1, this is the correct location for canvas-specific Rust code.

### `editor/` (shell pile)

Current contents (excluding the `dist/` build output):

```
AddImage.tsx
AddVideo.tsx
App.tsx
canvas.ts
canvases
controls.tsx
FirstRun.tsx
index.html
library
Library.tsx
main.tsx
panel.tsx
PerfOverlay.tsx
platform
player.tsx
PromptModeBar.tsx
resize.ts
runtime.ts
selection.ts
shell.ts
StarterCard.tsx
terminal.tsx
timeline.tsx
UndoMenu.tsx
```

After B2/B3/B4: `ProjectsView.tsx`, `history.ts`, and `diff.ts` are NO LONGER at this level — confirmed they appear in `editor/canvases/kinetic/` (see below). The audit also labels several files at this level "app" that have NOT been moved yet (see Known exceptions).

### `editor/canvases/kinetic/` (kinetic app pile)

Current contents:

```
diff.ts
history.ts
index.tsx
KineticApp.tsx
ProjectsView.tsx
```

After Phase B, this directory contains: the pre-existing `index.tsx` and `KineticApp.tsx`, plus `ProjectsView.tsx` (moved in B2), `history.ts` (moved in B3), and `diff.ts` (moved in B4). All five are audit-labelled "app" and now live where the audit expected them to.

## Known exceptions (deferred relocation)

The audit labels several files "app" that Phase B does NOT move, because doing so doesn't change the spike's validation outcomes and the moves are rote work that can happen in a follow-up:

**`src-tauri/src/`:**

- `video.rs` — audit-labelled "app" (§5.1). YouTube download + video import; KineticType-specific. Move when a second canvas exists and we know what shape "media import" should take.

**`editor/` (kinetic UI files still at shell level):**

- `panel.tsx` — kinetic properties panel.
- `timeline.tsx` — kinetic timeline.
- `player.tsx` — kinetic preview player.
- `controls.tsx` — kinetic transport bar.
- `Library.tsx` — kinetic library.
- `library/` — kinetic library entries + previews.
- `StarterCard.tsx` — kinetic empty-state card.
- `AddImage.tsx`, `AddVideo.tsx` — kinetic media insertion.

These are tracked technical debt. They don't affect Phase C's Pillar 3 tracer or the spike's verdict.

## Conclusion

After Phase B, the load-bearing seam between shell and kinetic-app is real in code. The six files §5.7 finding #1 called out as needing surgery have been split or moved (B1 deleted dead code; B2/B3/B4 moved files into `canvases/kinetic/`; B5 split skill.rs along the SkillBundle/canvas-impl line). The remaining audit-labelled "app" files at the `editor/` root and `src-tauri/src/video.rs` are explicitly deferred as documented above.

§7.4 criterion #1 is satisfied for the load-bearing seams. The rest is mechanical relocation deferred past the spike.
