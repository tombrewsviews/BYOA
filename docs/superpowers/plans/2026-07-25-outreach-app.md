# Outreach App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build **Outreach**, a DreamStore app that ingests research documents into lead cards on a kanban board, driven by a local terminal agent, with the §15 editable-stages pipeline model implemented locally in SQLite.

**Architecture:** Copy the `brainstorm` Tauri app as the shell (three panels: Agent terminal · kanban Runtime window · Properties). Replace brainstorm's `brainstorm_canvas` Rust module with a `board` module backed by SQLite (`board.db`), exposing §15 verbs through two primitives — `commit(event)` and `revert(seq)` — that make every write append-only and reversible. A local Outreach MCP server exposes those verbs to the agent and enforces the §15.6 blast-radius / rule-check gates server-side.

**Tech Stack:** Tauri 2, Rust (`rusqlite` bundled SQLite, `serde`, `serde_json`, `chrono`, `uuid`, `slug`), React 18 + Vite + TypeScript + Tailwind, `@modelcontextprotocol/sdk` (TypeScript) for the MCP server, `vitest` (frontend) + Rust `#[test]` (backend).

## Global Constraints

- Rust edition 2021, `rust-version = "1.77.2"` (match brainstorm).
- Tauri `2.11.1`, `tauri-build 2.6.1`.
- SQLite via `rusqlite = { version = "0.31", features = ["bundled"] }` — the `bundled` feature so no system SQLite is required.
- All ISO-8601 timestamps are strings (SQLite has no native datetime); use `chrono::Utc::now().to_rfc3339()`.
- **Stage `id` is stable and immutable**: slugify the label once at creation (`slug::slugify`), never change it, never reuse a retired id.
- **One event per lead** — `remapStage` writes N events for N leads, never one batched event.
- **Every write goes through `commit()`** — no direct `UPDATE` of `leads`/`stages` outside a committed event, except bootstrap seeding.
- **No roles / no admin / no per-stage ACL / no UI-triggered DDL** — gate on blast radius and reversibility only.
- Agent-facing package identifier: app dir `apps/outreach/`, Cargo package `outreach-app`, lib `outreach_app_lib`, Tauri identifier `app.altramanera.outreach`.
- Design tokens: before any UI, follow `CLAUDE.md` → Primitiv (call `get_design_context`, prefer tokens over literals).

---

## File Structure

**New app (copied shell, `apps/outreach/`):**
- `src-tauri/src/lib.rs` — command registration (adapted from brainstorm).
- `src-tauri/src/{agent_chat,agents,doc,migrate,paths,projects,prompt_mode,pty,selection,settings,skill}.rs` — copied from brainstorm verbatim, identifiers renamed.
- `src-tauri/src/board.rs` — **NEW.** SQLite open/bootstrap, `commit`, `revert`, all verbs, gates. The heart of the app.
- `src-tauri/src/board_window.rs` — **NEW.** Serves the kanban React bundle on localhost and opens/tiles its window (mirrors brainstorm's `brainstorm_canvas.rs`).
- `src-tauri/skills/outreach/SKILL.md` — **NEW.** Agent operating manual.
- `src/OutreachApp.tsx` — **NEW.** Main-window shell: boards list + editor (Agent | Properties).
- `src/board/Kanban.tsx`, `src/board/api.ts`, `src/board/types.ts` — **NEW.** The kanban window app.
- `src/properties/Inspector.tsx`, `src/properties/Settings.tsx` — **NEW.** Properties panel.
- `src/agent-chat/`, `src/terminal.tsx`, `src/components/ui/*`, `src/runtime.ts`, `src/icons.ts` — copied from brainstorm.
- `mcp/` — **NEW.** The Outreach MCP server (TypeScript, stdio).

**Repo-level:**
- `store-catalog/outreach.json` — **NEW.** Catalog entry.

---

## Phase 0 — Scaffold

### Task 0.1: Copy the brainstorm shell into `apps/outreach/`

**Files:**
- Create: `apps/outreach/` (whole tree, copied from `apps/brainstorm/`)

- [ ] **Step 1: Copy the app tree, excluding build artifacts**

```bash
cd /Users/parandykt/Apps/DreamStore
rsync -a --exclude node_modules --exclude dist --exclude 'src-tauri/target' \
  --exclude 'src-tauri/gen' apps/brainstorm/ apps/outreach/
```

- [ ] **Step 2: Remove brainstorm-specific domain files that Outreach replaces**

```bash
rm -f apps/outreach/src-tauri/src/brainstorm_canvas.rs
rm -rf apps/outreach/src/brainstorm apps/outreach/src/design-language
rm -rf apps/outreach/src-tauri/skills/brainstorm
```

- [ ] **Step 3: Rename package identifiers**

Edit `apps/outreach/package.json`: `"name": "brainstorm-app"` → `"name": "outreach-app"`.

Edit `apps/outreach/src-tauri/Cargo.toml`:
```toml
[package]
name = "outreach-app"
description = "Outreach — standalone app"
# ...
[lib]
name = "outreach_app_lib"
```

Edit `apps/outreach/src-tauri/tauri.conf.json`: set `productName` to `Outreach`, `identifier` to `app.altramanera.outreach`, and the main window `title` to `Outreach`.

- [ ] **Step 4: Add rusqlite to Cargo.toml dependencies**

```toml
rusqlite = { version = "0.31", features = ["bundled"] }
```

- [ ] **Step 5: Commit**

```bash
git add apps/outreach
git commit -m "feat(outreach): scaffold app from brainstorm shell"
```

### Task 0.2: Strip brainstorm domain wiring from `lib.rs` and `main.tsx`

**Files:**
- Modify: `apps/outreach/src-tauri/src/lib.rs`
- Modify: `apps/outreach/src/main.tsx`
- Create: `apps/outreach/src/OutreachApp.tsx` (placeholder)

**Interfaces:**
- Produces: `OutreachApp` React component (default-exported), rendered by `main.tsx`.

- [ ] **Step 1: In `lib.rs`, remove the `brainstorm_canvas` module and its state field + commands**

Delete `mod brainstorm_canvas;`, the `canvas_server` field on `AppState`, the `setup(...)` window-close handler that calls `brainstorm_canvas::shutdown`, and the three `brainstorm_canvas::*` entries in `generate_handler!`. Leave a `// board module added in Phase 1` marker where `mod brainstorm_canvas;` was.

- [ ] **Step 2: Replace `main.tsx`'s import to render a placeholder `OutreachApp`**

`apps/outreach/src/OutreachApp.tsx`:
```tsx
import React from "react";
export const OutreachApp: React.FC = () => (
  <div style={{ padding: 24, color: "#eee", background: "#000", height: "100%" }}>
    Outreach — scaffold OK
  </div>
);
export default OutreachApp;
```
Update `main.tsx` to import and render `OutreachApp` (replacing the brainstorm import).

- [ ] **Step 3: Verify it builds and launches**

Run: `cd apps/outreach && npm install && npm run tauri:dev`
Expected: window opens showing "Outreach — scaffold OK"; the app compiles with no reference to `brainstorm_canvas`.

- [ ] **Step 4: Commit**

```bash
git add apps/outreach
git commit -m "feat(outreach): strip brainstorm canvas wiring, placeholder shell"
```

---

## Phase 1 — SQLite data layer (Rust)

All work in `apps/outreach/src-tauri/src/board.rs`. Tests are Rust `#[cfg(test)]` in the same file, using an in-memory DB (`Connection::open_in_memory()`).

### Task 1.1: Schema + bootstrap

**Files:**
- Create: `apps/outreach/src-tauri/src/board.rs`
- Modify: `apps/outreach/src-tauri/src/lib.rs` (add `mod board;`)

**Interfaces:**
- Produces:
  - `fn open(path: &std::path::Path) -> rusqlite::Result<rusqlite::Connection>` — opens `board.db`, runs schema, seeds defaults if empty.
  - Default stages seeded: `researching`, `ready_to_contact`, `contacted`, `warm`, `won` (positions 0..4), each `label` the title-cased form.
  - A single bootstrap actor row `("local", "You")`.

- [ ] **Step 1: Write the failing test**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bootstrap_seeds_default_stages_and_actor() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        let n: i64 = c.query_row("select count(*) from stages", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 5);
        let first: String = c
            .query_row("select id from stages order by position limit 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(first, "researching");
        let actors: i64 = c.query_row("select count(*) from actors", [], |r| r.get(0)).unwrap();
        assert_eq!(actors, 1);
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/outreach/src-tauri && cargo test board::tests::bootstrap`
Expected: FAIL — `init` not found.

- [ ] **Step 3: Implement schema + `init`**

Write `init(&Connection)` that `execute_batch`es the six-table schema from the spec (stages, leads, events, actors, board_config, rules — with the exact columns and FKs), then, inside a transaction, if `stages` is empty inserts the five default stages (`slug::slugify` is not needed here — the ids are already slugs), the `("local","You")` actor, and a `board_config` singleton row. Add a public `open(path)` that opens the file DB, sets `PRAGMA foreign_keys = ON`, and calls `init`.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test board::tests::bootstrap`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/outreach/src-tauri/src/board.rs apps/outreach/src-tauri/src/lib.rs
git commit -m "feat(outreach): board.db schema + default-stage bootstrap"
```

### Task 1.2: `commit(event)` — the write primitive

**Interfaces:**
- Consumes: `open`/`init` from Task 1.1.
- Produces:
  - `struct Event { kind: String, entity_id: String, before: serde_json::Value, after: serde_json::Value, verb: String, actor: String }`
  - `fn commit(c: &Connection, ev: &Event) -> rusqlite::Result<i64>` — in ONE transaction: apply `ev.after` to the target row (dispatch on `ev.kind`), insert the event row, return its `seq`. Applying `lead.stage` updates `leads.stage` and bumps `leads.version`. Applying `lead.context`/`lead.messages`/`lead.transcripts` replaces the JSON column. Applying `stage.*` upserts/updates the stage row and bumps its `version`.

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn commit_writes_one_event_and_bumps_version() {
    let c = rusqlite::Connection::open_in_memory().unwrap();
    init(&c).unwrap();
    seed_lead(&c, "L1", "researching"); // test helper: insert a lead directly
    let seq = commit(&c, &Event {
        kind: "lead.stage".into(), entity_id: "L1".into(),
        before: serde_json::json!({"stage":"researching"}),
        after: serde_json::json!({"stage":"contacted"}),
        verb: "moveLead".into(), actor: "local".into(),
    }).unwrap();
    let stage: String = c.query_row("select stage from leads where id='L1'", [], |r| r.get(0)).unwrap();
    let ver: i64 = c.query_row("select version from leads where id='L1'", [], |r| r.get(0)).unwrap();
    let events: i64 = c.query_row("select count(*) from events", [], |r| r.get(0)).unwrap();
    assert_eq!(stage, "contacted");
    assert_eq!(ver, 2);
    assert_eq!(events, 1);
    assert_eq!(seq, 1);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test board::tests::commit_writes`
Expected: FAIL — `commit`/`Event`/`seed_lead` not found.

- [ ] **Step 3: Implement `Event`, `commit`, and the `seed_lead` test helper**

`commit` opens `c.unchecked_transaction()`, matches `ev.kind`, applies `after`, inserts into `events`, commits, returns `last_insert_rowid()`. `seed_lead(c, id, stage)` inserts a minimal leads row (empty JSON columns, version 1, timestamps `now`).

- [ ] **Step 4: Run to verify it passes** — Run: `cargo test board::tests::commit_writes` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(outreach): commit() write primitive — one event per change, version bump"
```

### Task 1.3: `revert(seq)` — inherited undo

**Interfaces:**
- Consumes: `commit`, `Event`.
- Produces: `fn revert(c: &Connection, seq: i64) -> rusqlite::Result<usize>` — in one transaction, select events with `seq' > seq` ordered `seq' DESC`, apply each event's `before` to its target row, delete those event rows, return the count reverted.

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn revert_restores_before_state() {
    let c = rusqlite::Connection::open_in_memory().unwrap();
    init(&c).unwrap();
    seed_lead(&c, "L1", "researching");
    let base = commit(&c, &Event{ kind:"lead.stage".into(), entity_id:"L1".into(),
        before: serde_json::json!({"stage":"researching"}),
        after: serde_json::json!({"stage":"contacted"}),
        verb:"moveLead".into(), actor:"local".into() }).unwrap();
    // two more moves after `base`
    commit(&c, &Event{ kind:"lead.stage".into(), entity_id:"L1".into(),
        before: serde_json::json!({"stage":"contacted"}),
        after: serde_json::json!({"stage":"warm"}),
        verb:"moveLead".into(), actor:"local".into() }).unwrap();
    let n = revert(&c, base).unwrap();
    let stage: String = c.query_row("select stage from leads where id='L1'", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
    assert_eq!(stage, "contacted"); // back to the state at `base`
}
```

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL, `revert` not found.
- [ ] **Step 3: Implement `revert`** as described in Interfaces.
- [ ] **Step 4: Run to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(outreach): revert(seq) inherited undo"`

### Task 1.4: Optimistic concurrency + no-reuse-of-retired-id

**Interfaces:**
- Produces:
  - `fn move_lead(c, id, to_stage, expected_version) -> Result<i64, BoardError>` — fails with `BoardError::VersionConflict` if `leads.version != expected_version`; otherwise builds a `lead.stage` Event and `commit`s.
  - `fn add_stage(c, label, position, actor) -> Result<String, BoardError>` — slugifies label to an id; fails with `BoardError::RetiredIdReuse` if a row with that id already exists (retired or not).
  - `enum BoardError { VersionConflict, RetiredIdReuse, RuleBlocked(Vec<String>), NeedsConfirm(usize), NotFound, Sql(rusqlite::Error) }`

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn move_lead_detects_version_conflict() {
    let c = conn_seeded_with_lead("L1", "researching"); // helper: init + seed_lead
    let err = move_lead(&c, "L1", "contacted", 99).unwrap_err();
    assert!(matches!(err, BoardError::VersionConflict));
}
#[test]
fn cannot_reuse_retired_stage_id() {
    let c = { let c = rusqlite::Connection::open_in_memory().unwrap(); init(&c).unwrap(); c };
    // "researching" already exists from bootstrap; adding a stage that slugs to it must fail
    let err = add_stage(&c, "Researching", 9, "local").unwrap_err();
    assert!(matches!(err, BoardError::RetiredIdReuse));
}
```

- [ ] **Step 2: Run to verify they fail** — Expected: FAIL.
- [ ] **Step 3: Implement `BoardError`, `move_lead`, `add_stage`** and the `conn_seeded_with_lead` helper.
- [ ] **Step 4: Run to verify they pass** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(outreach): optimistic concurrency + retired-id reuse guard"`

---

## Phase 2 — Board verbs + gates (Rust)

### Task 2.1: Stage verbs (rename / reorder / retire-empty / unretire)

**Interfaces:**
- Consumes: `commit`, `BoardError`, `add_stage`, `move_lead`.
- Produces:
  - `fn rename_stage(c, id, label) -> Result<i64, BoardError>` (a `stage.renamed` event; no card impact).
  - `fn reorder_stages(c, ids: &[&str]) -> Result<(), BoardError>` (rewrites `position`; `stage.reordered` events).
  - `fn retire_stage(c, id) -> Result<i64, BoardError>` — sets `retired_at`. **Blocks** (`RuleBlocked`) if an enabled rule references `id`; if the stage holds cards, returns `NeedsConfirm(n)` when n > 5 (caller must route through `remap_stage`).
  - `fn unretire_stage(c, id) -> Result<i64, BoardError>`.
  - `fn count_leads_in(c, stage_id) -> usize`, `fn rules_referencing(c, stage_id) -> Vec<String>` (returns rule *names*).

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn rename_stage_touches_no_cards() {
    let c = conn_seeded_with_lead("L1", "researching");
    rename_stage(&c, "researching", "Prospecting").unwrap();
    let label: String = c.query_row("select label from stages where id='researching'", [], |r| r.get(0)).unwrap();
    let stage: String = c.query_row("select stage from leads where id='L1'", [], |r| r.get(0)).unwrap();
    assert_eq!(label, "Prospecting");
    assert_eq!(stage, "researching"); // id unchanged, card untouched
}
#[test]
fn retire_stage_blocked_by_enabled_rule() {
    let c = { let c=rusqlite::Connection::open_in_memory().unwrap(); init(&c).unwrap();
        c.execute("insert into rules(id,name,enabled,conditions,action) values('r1','no_intro_path',1,?,'propose')",
            [serde_json::json!({"stage":"ready_to_contact"}).to_string()]).unwrap(); c };
    let err = retire_stage(&c, "ready_to_contact").unwrap_err();
    match err { BoardError::RuleBlocked(names) => assert_eq!(names, vec!["no_intro_path".to_string()]), _ => panic!() }
}
```

- [ ] **Step 2: Run to verify they fail** — Expected: FAIL.
- [ ] **Step 3: Implement the stage verbs + helpers.**
- [ ] **Step 4: Run to verify they pass** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(outreach): stage verbs + rule-check gate"`

### Task 2.2: `remap_stage` (retire-with-cards / merge / split) + dryRun

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `struct RemapResult { affected: usize, lead_ids: Vec<String> }`
  - `fn remap_stage(c, from, to, filter: Option<LeadFilter>, dry_run: bool, retire_source: bool, confirmed: bool) -> Result<RemapResult, BoardError>` — computes the affected leads (optionally narrowed by `filter` for splits); if `dry_run`, returns the count with **no writes**; else, if `affected > 5 && !confirmed`, returns `NeedsConfirm(affected)`; else in ONE transaction writes **one `lead.stage` event per lead**, and if `retire_source` sets `from.retired_at`. Blocks (`RuleBlocked`) if an enabled rule references `from`.
  - `struct LeadFilter { /* e.g. org: Option<String> */ }` — minimal; extend as needed.

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn remap_dryrun_counts_without_writing() {
    let c = conn_seeded_with_lead("L1", "contacted");
    seed_lead(&c, "L2", "contacted");
    let r = remap_stage(&c, "contacted", "warm", None, true, false, false).unwrap();
    assert_eq!(r.affected, 2);
    let events: i64 = c.query_row("select count(*) from events", [], |r| r.get(0)).unwrap();
    assert_eq!(events, 0); // dryRun wrote nothing
}
#[test]
fn remap_writes_one_event_per_lead() {
    let c = conn_seeded_with_lead("L1", "contacted");
    seed_lead(&c, "L2", "contacted");
    let r = remap_stage(&c, "contacted", "warm", None, false, false, false).unwrap();
    assert_eq!(r.affected, 2);
    let events: i64 = c.query_row("select count(*) from events", [], |r| r.get(0)).unwrap();
    assert_eq!(events, 2); // one per lead, never batched
}
```

- [ ] **Step 2: Run to verify they fail** — Expected: FAIL.
- [ ] **Step 3: Implement `remap_stage`, `RemapResult`, `LeadFilter`.**
- [ ] **Step 4: Run to verify they pass** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(outreach): remapStage — one event per lead, dryRun, blast-radius gate"`

### Task 2.3: Lead content verbs (add / append-context / draft / transcript)

**Interfaces:**
- Produces:
  - `fn add_lead(c, name, org, stage, actor) -> Result<String, BoardError>` (returns new uuid id; `lead.created` event).
  - `fn append_context(c, id, research: serde_json::Value, expected_version) -> Result<i64, BoardError>` — **merges** into the existing `context` JSON (never replaces): appends to a `facts` array with a `source` tag; a `lead.context` event carries before/after.
  - `fn draft_message(c, id, msg: serde_json::Value) -> Result<i64, BoardError>` (appends to `messages`; never sent).
  - `fn attach_transcript(c, id, raw, summary) -> Result<i64, BoardError>` (appends `{raw, summary}` to `transcripts`).

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn append_context_merges_never_replaces() {
    let c = conn_seeded_with_lead("L1", "researching");
    append_context(&c, "L1", serde_json::json!({"fact":"CTO is Ana","source":"paste-1"}), 1).unwrap();
    append_context(&c, "L1", serde_json::json!({"fact":"Series B","source":"paste-2"}), 2).unwrap();
    let ctx: String = c.query_row("select context from leads where id='L1'", [], |r| r.get(0)).unwrap();
    let v: serde_json::Value = serde_json::from_str(&ctx).unwrap();
    assert_eq!(v["facts"].as_array().unwrap().len(), 2); // both preserved
}
```

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL.
- [ ] **Step 3: Implement the four lead verbs.**
- [ ] **Step 4: Run to verify it passes** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(outreach): lead content verbs — add/appendContext(merge)/draft/transcript"`

### Task 2.4: The §15.8 acceptance test (integration)

**Interfaces:** Consumes all Phase 1–2 verbs. No new production code unless the test surfaces a gap.

- [ ] **Step 1: Write the acceptance test**

```rust
#[test]
fn acceptance_stage_lifecycle_and_revert() {
    let c = { let c = rusqlite::Connection::open_in_memory().unwrap(); init(&c).unwrap(); c };
    // Create a stage, move four cards into it
    let sid = add_stage(&c, "Follow up", 5, "local").unwrap(); // -> "follow_up"
    for id in ["A","B","C","D"] { seed_lead(&c, id, "researching");
        move_lead(&c, id, &sid, 1).unwrap(); }
    // Rename it twice, reorder it
    rename_stage(&c, &sid, "Chasing").unwrap();
    rename_stage(&c, &sid, "Nudging").unwrap();
    reorder_stages(&c, &["researching","follow_up","ready_to_contact","contacted","warm","won"]).unwrap();
    // A rule references it — merge must be blocked until remapped
    c.execute("insert into rules(id,name,enabled,conditions,action) values('r','chase_rule',1,?,'propose')",
        [serde_json::json!({"stage":"follow_up"}).to_string()]).unwrap();
    let merge_seq_before = remap_stage(&c, "follow_up", "won", None, false, true, true);
    assert!(matches!(merge_seq_before, Err(BoardError::RuleBlocked(_))));
    // Remap the rule's reference away, then merge succeeds
    c.execute("update rules set conditions=? where id='r'",
        [serde_json::json!({"stage":"won"}).to_string()]).unwrap();
    let seq_before_merge: i64 = c.query_row("select max(seq) from events", [], |r| r.get(0)).unwrap();
    let r = remap_stage(&c, "follow_up", "won", None, false, true, true).unwrap();
    assert_eq!(r.affected, 4);
    for id in ["A","B","C","D"] {
        let s: String = c.query_row(&format!("select stage from leads where id='{id}'"), [], |r| r.get(0)).unwrap();
        assert_eq!(s, "won");
    }
    // revert the merge → all four back to follow_up
    revert(&c, seq_before_merge).unwrap();
    for id in ["A","B","C","D"] {
        let s: String = c.query_row(&format!("select stage from leads where id='{id}'"), [], |r| r.get(0)).unwrap();
        assert_eq!(s, "follow_up");
    }
}
```

- [ ] **Step 2: Run it** — Run: `cargo test board::tests::acceptance` — Expected: PASS (fix any verb gaps it reveals).
- [ ] **Step 3: Commit** — `git commit -am "test(outreach): §15.8 acceptance — lifecycle, rule-block, revert"`

### Task 2.5: Tauri commands exposing the verbs to the frontend

**Files:**
- Modify: `apps/outreach/src-tauri/src/board.rs` (add `#[tauri::command]` wrappers reading the active project's `board.db`)
- Modify: `apps/outreach/src-tauri/src/lib.rs` (register them)

**Interfaces:**
- Produces Tauri commands: `board_list_stages`, `board_list_leads`, `board_get_lead`, `board_move_lead`, `board_add_lead`, `board_rename_stage`, `board_reorder_stages`, `board_add_stage`, `board_retire_stage`, `board_remap_stage`, `board_append_context`, `board_draft_message`, `board_attach_transcript`, `board_list_rules`, `board_revert` — each opens `board.db` under the active project path, calls the matching verb, maps `BoardError` to a `String` error, returns JSON-serializable results.

- [ ] **Step 1:** Add a helper `fn db_for_active(state) -> Result<Connection, String>` that resolves the active project path (via `projects::active`) and `open`s `board.db` there.
- [ ] **Step 2:** Add the `#[tauri::command]` wrappers listed above.
- [ ] **Step 3:** Register every command in `lib.rs` `generate_handler!`.
- [ ] **Step 4: Verify it compiles** — Run: `cargo build` — Expected: builds clean.
- [ ] **Step 5: Commit** — `git commit -am "feat(outreach): tauri commands over board verbs"`

---

## Phase 3 — Kanban runtime (React) + live window

### Task 3.1: `board_window.rs` — serve + open the kanban window

**Files:**
- Create: `apps/outreach/src-tauri/src/board_window.rs` (adapt from brainstorm's `brainstorm_canvas.rs`)
- Modify: `lib.rs` (register `board_window_open`, `board_window_close`)

- [ ] **Step 1:** Adapt `brainstorm_canvas.rs`: instead of spawning the excalidraw npm server, serve the built kanban bundle (Vite build output for `src/board/`) on a localhost port (or load it as a second Tauri window pointing at the bundle). Open it tiled to the right of the main window.
- [ ] **Step 2:** Register the two commands in `lib.rs`.
- [ ] **Step 3: Verify** the window opens empty. **Commit.**

### Task 3.2: Kanban board React app

**Files:**
- Create: `apps/outreach/src/board/types.ts`, `api.ts`, `Kanban.tsx`, and a `board.html` + Vite entry.

**Interfaces:**
- `types.ts`: `Stage { id, label, position, color?, retiredAt? }`, `Lead { id, stage, name, org?, version }`.
- `api.ts`: thin wrappers over the Tauri `board_*` commands (Task 2.5) returning typed data; a `poll(onChange)` that re-fetches on an interval.

- [ ] **Step 1: Write the failing test** (vitest + testing-library): `Kanban` renders one column per non-retired stage and a card per lead in the right column; a lead whose `stage` id isn't in the stage list renders in an **"Unsorted"** column (§15.5). Mock `api.ts`.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement `Kanban.tsx`** — columns from stages (ordered by position, retired hidden), cards grouped by `stage`, unknown-stage cards → an appended "Unsorted" column; drag-to-move calls `api.moveLead(id, toStage, version)` and refetches. Follow Primitiv tokens.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** — `git commit -am "feat(outreach): kanban board with Unsorted fallback + drag-to-move"`

### Task 3.3: Wire the board window into the editor + live poll

- [ ] **Step 1:** In `OutreachApp.tsx` (Phase 4 builds the shell; here just the open-board button), open the board window on project open, start the poll loop.
- [ ] **Step 2: Verify manually** — create leads, drag between columns, reopen the project, confirm persistence and that a stale stage id lands in Unsorted. **Commit.**

---

## Phase 4 — Properties panel + boards-list shell

### Task 4.1: Boards list + editor shell (Agent | Properties)

**Files:**
- Modify: `apps/outreach/src/OutreachApp.tsx` — port brainstorm's `BoardsList` + `BrainstormEditor` structure: boards list entry screen; editor with the **Agent panel on the left** (Terminal/Chat, copied infra) and the **Properties panel on the right**; an "open board window" button.

- [ ] **Step 1:** Port `BoardsList` (rename brainstorm→outreach, `projects_list { canvas: "outreach" }`).
- [ ] **Step 2:** Port the editor layout: left `Terminal`/`Chat`, right = Properties (Task 4.2). Open the board window (Task 3.1) on mount.
- [ ] **Step 3: Verify** the three-panel layout matches the DreamStore convention (Agent leftmost). **Commit.**

### Task 4.2: Lead inspector + Settings

**Files:**
- Create: `apps/outreach/src/properties/Inspector.tsx`, `Settings.tsx`.

- [ ] **Step 1: Write the failing test** — `Inspector` shows a selected lead's context facts, messages, and transcript summaries; `Settings` lists stages with their **stable id in small type** and the board `created_by`.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** both against `api.ts`; `Settings` rename calls `board_rename_stage`. Primitiv tokens.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Verify manually** — select a card → full context; rename a stage in Settings → board window reflects it within one poll. **Commit.**

---

## Phase 5 — Outreach MCP server + skill

### Task 5.1: MCP server exposing the verbs

**Files:**
- Create: `apps/outreach/mcp/package.json`, `apps/outreach/mcp/src/server.ts`.

**Interfaces:**
- A stdio MCP server (`@modelcontextprotocol/sdk`) whose tools mirror the verbs: `listLeads`, `getLead`, `addLead`, `moveLead`, `appendContext`, `draftMessage`, `attachTranscript`, `listStages`, `renameStage`, `reorderStages`, `addStage`, `retireStage`, `remapStage`, `unretireStage`, `listRules`. It opens the project's `board.db` **through the same Rust logic** — implemented by shelling out to a small `outreach-board` Rust binary (built from `board.rs`) OR re-implementing the SQL in TS. **Decision:** shell out to a `board-cli` subcommand so the gates live in one place (Rust). Add a `[[bin]] name = "board-cli"` to Cargo that dispatches verbs as JSON in/out.
- Each destructive tool enforces the §15.6 gates: `remapStage`/`retireStage` accept `dryRun` and `confirmed`; the server returns the count and a `needsConfirm`/`ruleBlocked` structured result the agent must act on.

- [ ] **Step 1:** Add the `board-cli` Rust binary (`src-tauri/src/bin/board_cli.rs`) that reads `{verb, args}` JSON on argv/stdin, opens `board.db` from `$OUTREACH_PROJECT`, calls the verb, prints JSON. Reuse `board.rs` (make its verbs `pub`).
- [ ] **Step 2:** Write the MCP server that spawns `board-cli` per tool call and maps results.
- [ ] **Step 3: Test** — a script test: `listStages` returns the five defaults; `remapStage` with `dryRun` returns a count and writes nothing; `remapStage` on 6 cards without `confirmed` returns `needsConfirm`.
- [ ] **Step 4: Commit** — `git commit -am "feat(outreach): MCP server + board-cli, gates enforced in Rust"`

### Task 5.2: SKILL.md + installer + project MCP registration

**Files:**
- Create: `apps/outreach/src-tauri/skills/outreach/SKILL.md`
- Modify: `apps/outreach/src-tauri/src/skill.rs` (point the bundle at outreach; write project `CLAUDE.md`; register the MCP server in the project's `.mcp.json`)

- [ ] **Step 1: Write `SKILL.md`** — the operating manual from the spec's Ingestion section: read-before-acting; identify → match-or-create → **merge-never-clobber** → classify doc → propose stage moves via dryRun → report-and-wait; drafting/summarizing; "maintain state, lose nothing"; the §15 stage-editing safety rules. Explicit: never auto-send messages; surface contradictions.
- [ ] **Step 2: Adapt `skill.rs`** (from remit's) — bundle path `~/.outreach/skills-bundle/outreach/`, symlink into `.claude/skills/outreach/`, write project `CLAUDE.md`, and ensure the project `.mcp.json` registers the outreach MCP server with `OUTREACH_PROJECT` set.
- [ ] **Step 3: Verify end-to-end** — open a project, in the terminal have the agent `listLeads`, `addLead`, then paste a research blob: it matches/merges via `appendContext`, `dryRun`s a proposed move, reports the count, waits for "yes", commits; attach a transcript. Confirm nothing is lost and gates fire.
- [ ] **Step 4: Commit** — `git commit -am "feat(outreach): agent SKILL.md + installer + MCP registration"`

---

## Phase 6 — Catalog + docs

### Task 6.1: Store catalog entry

**Files:**
- Create: `store-catalog/outreach.json` (mirror `brainstorm.json` fields: id `outreach`, name "Outreach", agent-native blurb, category, tags, `skills` list of the verbs).

- [ ] **Step 1:** Write `outreach.json`.
- [ ] **Step 2: Verify** it parses and matches the catalog schema of the siblings.
- [ ] **Step 3: Commit** — `git commit -am "feat(outreach): store catalog entry"`

---

## Self-Review

- **Spec coverage:** three panels (Phase 0/3/4) · SQLite six-table model (1.1) · commit/revert (1.2/1.3) · optimistic concurrency + retired-id guard (1.4) · stage verbs + rule gate (2.1) · remapStage/dryRun/blast-radius (2.2) · lead content verbs + merge-never-clobber (2.3) · §15.8 acceptance (2.4) · Tauri commands (2.5) · kanban + Unsorted fallback (3.2) · Properties inspector + Settings with stable ids (4.2) · MCP server + gates (5.1) · SKILL.md ingestion flow + installer (5.2) · catalog (6.1). Cut list (roles/ACL/DDL/inbox) is respected — no task builds them.
- **Placeholders:** none — every code step shows code or an exact command.
- **Type consistency:** `Event`, `BoardError`, `RemapResult`, `LeadFilter`, verb signatures are defined once (Phase 1–2) and reused by name in later phases; the MCP tool names match the verb names.

## Execution Handoff

Two execution options — see the end of this session's messages.
```