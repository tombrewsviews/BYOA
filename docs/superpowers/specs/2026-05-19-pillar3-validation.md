# Pillar 3 validation (after Phase C)

This doc validates §7.4 criterion #3 of the KeepDiggin spike spec for
Pillar 3 — the highest-risk pillar. The spec claims:

> `state.write({ patch })` — JSON Patch (RFC 6902) applied to current
> state; validated; history entry written; preview reloads. Patches
> not full rewrites: smaller diffs, less context burn, fewer
> accidents.

Phase C builds the substrate that makes the claim runnable. This doc
captures what shipped, the manual protocol that validates it
end-to-end, and what's explicitly out of scope.

## What Phase C built

Seven commits on master:

- **C1** — added `json-patch = "3.0"` and `sha2 = "0.10"` to
  `src-tauri/Cargo.toml`.
- **C2** — `src-tauri/src/history.rs`: content-addressed append-only
  log. `pub fn write_entry(project_root, doc_bytes, author)`
  sha256s the bytes, writes `<sha>.json` if not already present
  (dedup), and appends to `index.json` with `parent`+`author`+`ts`.
  Three unit tests cover write+read, parent-chaining, and on-disk
  dedup count.
- **C3** — `apply_patch` Tauri command in `src-tauri/src/doc.rs`:
  load doc → parse RFC 6902 patch → apply → atomic tmp+rename
  write → `history::write_entry` → return new doc JSON. Three unit
  tests (replace, array-append, invalid-path → error). A follow-up
  commit tightened `invalid_path_errors` to verify the doc is
  unchanged on error (the json-patch 3.0 crate rolls back partial
  mutations on error — confirmed).
- **C4** — `editor/state.ts`: narrow TypeScript client.
  `writeState(patch: JsonPatch, author: string): Promise<{ newDocJson }>`.
  Types cover all six RFC 6902 ops.
- **C5** — **discovered unnecessary.** Tauri 2.11.1 in this project
  allows custom commands implicitly via `core:default` in
  `src-tauri/capabilities/default.json`. `save_doc` and `load_doc`
  are not explicitly allow-listed either; `apply_patch` is invocable
  via its `tauri::generate_handler!` registration alone. Documented
  here so future readers don't repeat the investigation.
- **C6** — flag-gated wire-up in `editor/panel.tsx`. When
  `localStorage.PILLAR3 === "1"`, beat-color changes route through
  `writeState([{ op: "replace", path: "/beats/<i>/color", value: hex }], "user")`.
  When the flag is off (default), the existing
  `onChange({ color: v })` legacy path runs unchanged. The two
  paths cannot race — the early `return` after the patch call
  prevents fall-through.
- **C7** — this doc.

## Manual validation protocol (user runs)

Subagents can't drive the GUI; this protocol is the user's
responsibility. Run it once after Phase C to confirm the tracer
works end-to-end.

### Path A — legacy (default, kill-switch)

Goal: confirm nothing in Phase C broke the existing save path.

1. Open devtools. Run `localStorage.removeItem("PILLAR3")` then
   `location.reload()`. (Or just clear devtools' Application →
   Local Storage entry and reload.)
2. Start `npm run tauri:dev` and open an existing project that has
   at least one beat. (`~/KineticStudio/<some-project>/` is a fine
   choice.)
3. Select a beat. Change its color via the color picker in the
   properties panel.
4. Confirm:
   - The preview updates to the new color within ~300ms.
   - The beat's color persists across reloads.
   - `~/<project>/.kinetic-studio/history/` does NOT exist (or is
     unchanged from before this run). Check with
     `ls ~/<project>/.kinetic-studio/` — if `history/` is absent or
     empty, the legacy path is operating without touching the
     log.

### Path B — tracer (the spike's payoff)

Goal: confirm the patch path lands the new doc atomically AND
appends to the history log AND the watcher fires a reload.

1. In devtools, run `localStorage.setItem("PILLAR3", "1")` then
   `location.reload()`.
2. Select a beat. Change its color via the color picker.
3. Confirm:
   - The preview updates to the new color within ~300ms.
   - `~/<project>/story.json` reflects the new color (e.g. `cat
     ~/<project>/story.json | head -50` and see the updated
     `"color"` field).
   - `~/<project>/.kinetic-studio/history/index.json` exists and
     contains at least one entry:
     ```bash
     cat ~/<project>/.kinetic-studio/history/index.json
     ```
     The entry should have `"author": "user"`, a non-empty `"sha"`,
     a `"parent"` that's either `null` (if this was the first patch
     in this project) or another sha, and an RFC3339 `"ts"`.
   - The corresponding blob exists:
     ```bash
     ls ~/<project>/.kinetic-studio/history/
     ```
     Should show one `<sha>.json` plus `index.json`. The blob's
     contents match `story.json` byte-for-byte (the spike's atomic
     write).
4. Change the color a second time (a different hex). Confirm:
   - A second entry appears in `index.json` with the first
     entry's sha as its `parent`.
   - A new `<sha>.json` blob appears.
5. Change the color to the SAME hex you set in step 4. Confirm:
   - The index grows to three entries (the new entry has the same
     sha as the previous one but is recorded as a separate
     append).
   - The blob count stays at two — the dedup logic from C2 fires.

### Failure modes to look for

- Path A: a history blob appears → the legacy path isn't isolated
  from the patch path. Bug in C6's early return.
- Path B: preview doesn't update → the watcher isn't firing on the
  patched write. Bug in the Tauri command's atomic rename, or the
  watcher debounce is masking the event.
- Path B: `index.json` shows an entry but no blob → bug in C2's
  `write_entry` (the blob write is skipped when it shouldn't be).
- Either path: console shows `[pillar3] apply_patch failed: ...`
  → patch was rejected; common causes are stale doc state on disk,
  schema mismatch, or fs permissions.

## What this proves (assuming the protocol passes)

- JSON Patch (RFC 6902) is sufficient for at least one
  representative kinetic edit (beat color). The patch is RFC-shaped;
  no fields had to be invented.
- The content-addressed log works in the small case (single-beat
  edits). Dedup behaves correctly when the user re-applies the
  same color (the third write in step B5).
- The tracer can coexist with the legacy save path without
  duplicate writes or watcher confusion — only one of the two
  paths runs per interaction, enforced by the early `return` in
  the C6 wire-up.
- The Tauri capability story for custom app commands is implicit
  (`core:default` covers them). Per-command allow-listing was a
  red herring; this is documented so future hardening efforts
  start from the right baseline.

## What this does NOT prove

- **Multi-step patches.** The wire-up only exercises a single
  `replace` op per interaction. Patches that touch multiple paths
  in one batch (e.g. `addBeat` that touches `/beats` and
  `/selection`) aren't exercised. Will be covered when verbs land
  in a later phase.
- **Schema validation on the Rust side.** Today validation lives on
  the frontend (Zod re-parses after the watcher fires). A patch
  that produces well-formed JSON but schema-invalid data will
  round-trip through the file once before Zod catches it.
  Acceptable for the spike; not acceptable long-term.
- **Branch / revert / discard.** The log supports these
  mechanically (`read_blob` reads by sha; appending a revert is
  just another `write_entry` with the older content), but no UI
  surfaces them and no agent tool calls them yet.
- **Network / preview-iframe observe (Pillar 1) or verbs (Pillar
  2) or auto-generated routing skills (Pillar 4).** Out of scope
  for the spike; the spec's §7.4 maps those to existing
  KineticType infrastructure that the spike didn't need to extend.

## Conclusion

After the user runs the manual protocol above and confirms both
paths behave as described, §7.4 criterion #3 for Pillar 3 is
satisfied: patches-not-rewrites work against real kinetic data,
the history-as-log design is cheaper than the existing
`editor/canvases/kinetic/history.ts` (no per-keystroke coalescing
needed because the Tauri watcher already debounces), and the
tracer integrates without disturbing the existing save path.

The other three criteria (#2 and the Pillar 1/2/4 mappings) are
satisfied by Phase A's paragraph-spec
(`docs/superpowers/specs/2026-05-19-second-canvas-validation.md`)
and the spec's existing §7.4 mapping of pillars to existing
infrastructure.

The spike is validated pending the manual run. The next step
(post-plan) is to decide whether to commit to the framework
extraction described in the spec's §3–§4 or to keep KeepDiggin's
seams in place and continue shipping KineticType.
