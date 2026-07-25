# Outreach Multi-User (Shared Postgres) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let multiple Outreach desktop clients share one Postgres board with live sync and per-user name identity, while staying local-first (SQLite) when no database URL is set.

**Architecture:** A thin `Db` enum wraps `rusqlite::Connection | postgres::Client`, exposing ~8 primitives the board verbs use; verb/gate logic stays written once. `open_board` dispatches to Postgres when `DATABASE_URL` is set, else SQLite (today's path). The actor id/label comes from config. Live sync reuses the existing poll; the optimistic `version` gate handles concurrent edits.

**Tech Stack:** Rust, `postgres` crate (blocking) + `rusqlite` (existing), Tauri 2, Postgres (Neon via Vercel). React/TS for the Settings fields.

**Spec:** `docs/superpowers/specs/2026-07-25-outreach-multiuser-postgres-design.md`.

## Global Constraints

- **Local-first, zero behavior change without a DB URL.** With `DATABASE_URL` unset, every path must be byte-equivalent to today (SQLite `board.db`). All 42 existing crate tests must stay green throughout, running against `Db::Sqlite` (in-memory).
- **Synchronous only.** Use the blocking `postgres` crate. Do NOT introduce `async`/`tokio` into `board.rs` or its callers. Verb signatures must not gain `async`.
- **One source of gate logic.** The verbs, gates (`needs-confirm`, `rule-blocked`, optimistic `version`, `retired-id-reuse`, `dryRun`), `commit`, `revert`, `apply_state` are written ONCE and run over `Db` regardless of backend. No forking `board.rs`, no per-backend verb copies.
- **Portable SQL, dialect normalized in `Db`.** Verbs author `?N`-style placeholders; the `Pg` arm rewrites `?N`→`$N`. `events.seq` is `integer primary key autoincrement` (SQLite) / `bigint generated always as identity` (Postgres); `commit` obtains the new seq via `last_insert_rowid()` / `INSERT … RETURNING seq`.
- **Actor from config.** Replace the hardcoded `"local"` actor literal in verbs/`commit`/seed with a configured `actor_id` (default `"local"`/`"You"` when unset). `actor_id = slugify(name)` (slug crate already a dep; slug uses HYPHENS).
- **Trusted-collaborators model.** No auth. Do not add roles/permission checks. The optimistic `version` gate is the only concurrency protection and must remain intact.
- **apps/ is git-ignored** — every `git add` uses `-f` with explicit paths (NOT the whole dir; no node_modules/target/dist).
- **Postgres tests are env-gated** (`OUTREACH_TEST_PG`) so the suite stays green without a database.

---

## File Structure

- `apps/outreach/src-tauri/Cargo.toml` — add `postgres` (+ `postgres-native-tls` or `postgres` with `rustls` for Neon TLS).
- `apps/outreach/src-tauri/src/db.rs` — **new**: the `Db` enum + primitives + `open_board` dispatch + Postgres DDL/seed. The single new seam.
- `apps/outreach/src-tauri/src/board.rs` — mechanical port of 109 SQL call-sites from `&Connection`/`c.execute(...)` to `&mut Db`/`db.exec(...)`; `ComposableTx` gains a Pg arm; `commit` seq via `Db`.
- `apps/outreach/src-tauri/src/settings.rs` — add `database_url` + `actor_name` fields + setters.
- `apps/outreach/src-tauri/src/lib.rs` — register new settings setters; `mod db;`.
- `apps/outreach/src-tauri/src/board.rs` (Tauri cmds) + `src/bin/board_cli.rs` + `src/projects.rs` — route through `open_board(project_dir, cfg)` instead of `open(board.db)`; pass the configured actor.
- `apps/outreach/src/properties/Settings.tsx` + `src/board/api.ts` — two Settings fields (DB URL, Your name) + wrappers.
- `apps/outreach/mcp/src/board-cli.ts` — pass `DATABASE_URL`/`OUTREACH_ACTOR` through to `board-cli` (env already inherited; make explicit).

---

## Phase 1 — Config surface (DB URL + actor name)

### Task 1.1: Settings fields + Tauri setters

**Files:**
- Modify: `apps/outreach/src-tauri/src/settings.rs`
- Modify: `apps/outreach/src-tauri/src/lib.rs` (register setters)

**Interfaces:**
- Produces: `Settings { database_url: Option<String>, actor_name: Option<String>, .. }`; Tauri commands `set_database_url(String)`, `set_actor_name(String)`; both persist via existing `save`. `get_settings` already returns the whole struct.

- [ ] **Step 1: Write the failing test** (in `settings.rs` `#[cfg(test)]`):

```rust
#[test]
fn settings_roundtrip_db_url_and_actor() {
    let s = Settings {
        database_url: Some("postgres://x".into()),
        actor_name: Some("Ada".into()),
        ..Default::default()
    };
    let json = serde_json::to_string(&s).unwrap();
    let back: Settings = serde_json::from_str(&json).unwrap();
    assert_eq!(back.database_url.as_deref(), Some("postgres://x"));
    assert_eq!(back.actor_name.as_deref(), Some("Ada"));
}
```

- [ ] **Step 2: Run to verify it fails** (fields don't exist yet):
Run: `cargo test --manifest-path apps/outreach/src-tauri/Cargo.toml settings_roundtrip`
Expected: compile error / FAIL.

- [ ] **Step 3: Add the fields** to `Settings` (after `agent_starting_command`):

```rust
    /// Shared Postgres board URL. When set (non-empty), the board opens against
    /// this database instead of the local SQLite `board.db` — enabling a
    /// multi-user shared board. Empty/None = local-first (default).
    #[serde(default)]
    pub database_url: Option<String>,
    /// This user's display name, used as the board actor (who did what). When
    /// unset, the board falls back to the built-in `"You"` actor.
    #[serde(default)]
    pub actor_name: Option<String>,
```

- [ ] **Step 4: Add the setters** (mirror `set_default_agent`'s shape in `settings.rs`):

```rust
#[tauri::command]
pub fn set_database_url(url: String) -> Result<(), String> {
    let mut s = load();
    s.database_url = if url.trim().is_empty() { None } else { Some(url.trim().to_string()) };
    save(&s)
}

#[tauri::command]
pub fn set_actor_name(name: String) -> Result<(), String> {
    let mut s = load();
    s.actor_name = if name.trim().is_empty() { None } else { Some(name.trim().to_string()) };
    save(&s)
}
```

- [ ] **Step 5: Register** both in `lib.rs` `generate_handler![...]` (after the other `settings::set_*`):

```rust
    settings::set_database_url,
    settings::set_actor_name,
```

- [ ] **Step 6: Run to verify it passes.**
Run: `cargo test --manifest-path apps/outreach/src-tauri/Cargo.toml settings_roundtrip`
Expected: PASS. Also `cargo build ... ` clean.

- [ ] **Step 7: Commit.**

```bash
git add -f apps/outreach/src-tauri/src/settings.rs apps/outreach/src-tauri/src/lib.rs
git commit -m "feat(outreach): settings fields for shared DB url + actor name"
```

---

## Phase 2 — The `Db` seam

### Task 2.1: `Db` enum + SQLite arm (behavior-preserving primitives)

**Files:**
- Create: `apps/outreach/src-tauri/src/db.rs`
- Modify: `apps/outreach/src-tauri/src/lib.rs` (`mod db;`)

**Interfaces:**
- Produces: `pub enum Db { Sqlite(rusqlite::Connection), Pg(postgres::Client) }` with methods used by the verbs. Phase 3 ports `board.rs` onto these. Method set (finalize signatures here; `board.rs` will consume exactly these):
  - `exec(&mut self, sql: &str, params: &[&dyn ToSql]) -> Result<u64, DbError>`
  - `query_opt<T, F: FnMut(&Row)->T>(&mut self, sql, params, f) -> Result<Option<T>, DbError>`
  - `query_all<T, F: FnMut(&Row)->T>(&mut self, sql, params, f) -> Result<Vec<T>, DbError>`
  - `savepoint(&mut self, name)`, `release(&mut self, name)`, `rollback_to(&mut self, name)`
  - `commit_event_returning_seq(&mut self, insert_sql, params) -> Result<i64, DbError>` (RETURNING vs last_insert_rowid)
- Note: `Row`/`ToSql` need a small unifying shim so verbs write one closure body. Simplest flexible approach: define `Db`'s query methods to hand the closure a `&dyn Row`-like accessor with `get_str(i)`, `get_i64(i)`, `get_opt_str(i)` — the handful of getters the verbs use. Implement that accessor for both `rusqlite::Row` and `postgres::Row`. (This keeps row-mapping written once in the verbs.)

- [ ] **Step 1: Write failing tests** (`db.rs` `#[cfg(test)]`) against an in-memory SQLite `Db`:

```rust
#[test]
fn sqlite_exec_query_savepoint_roundtrip() {
    let mut db = Db::sqlite_in_memory().unwrap();
    db.exec("create table t (id text primary key, n int)", &[]).unwrap();
    db.exec("insert into t (id,n) values (?1,?2)", &[&"a", &1i64]).unwrap();
    let n = db.query_opt("select n from t where id=?1", &[&"a"], |r| r.get_i64(0)).unwrap();
    assert_eq!(n, Some(1));
    // savepoint rollback
    db.savepoint("sp1").unwrap();
    db.exec("insert into t (id,n) values (?1,?2)", &[&"b", &2i64]).unwrap();
    db.rollback_to("sp1").unwrap(); db.release("sp1").unwrap();
    let cnt = db.query_opt("select count(*) from t", &[], |r| r.get_i64(0)).unwrap();
    assert_eq!(cnt, Some(1), "rolled-back insert must be gone");
}

#[test]
fn sqlite_param_placeholders_are_question_mark_style() {
    // The SQLite arm passes ?N through untouched.
    let mut db = Db::sqlite_in_memory().unwrap();
    db.exec("create table t (id text)", &[]).unwrap();
    db.exec("insert into t values (?1)", &[&"x"]).unwrap();
    assert_eq!(db.query_opt("select id from t where id=?1", &[&"x"], |r| r.get_str(0)).unwrap(), Some("x".to_string()));
}
```

- [ ] **Step 2: Run — verify FAIL** (`Db` doesn't exist).
Run: `cargo test --manifest-path apps/outreach/src-tauri/Cargo.toml db::tests`
Expected: FAIL (unresolved).

- [ ] **Step 3: Implement `Db` (SQLite arm only for now)** in `db.rs`: the enum, a `DbError` (wrapping `rusqlite::Error` for now; add a `Pg` variant in Task 2.2), the row-accessor shim over `rusqlite::Row`, `sqlite_in_memory()`/`open_sqlite(path)` constructors, and the methods above delegating to `rusqlite`. `savepoint/release/rollback_to` issue `SAVEPOINT <n>` / `RELEASE <n>` / `ROLLBACK TO <n>`. Declare `mod db;` in `lib.rs`.

- [ ] **Step 4: Run — verify PASS.**
Run: `cargo test --manifest-path apps/outreach/src-tauri/Cargo.toml db::tests`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add -f apps/outreach/src-tauri/src/db.rs apps/outreach/src-tauri/src/lib.rs
git commit -m "feat(outreach): Db seam — SQLite arm + primitives (exec/query/savepoint)"
```

### Task 2.2: Postgres arm + `?N`→`$N` translation + Cargo deps

**Files:**
- Modify: `apps/outreach/src-tauri/Cargo.toml`
- Modify: `apps/outreach/src-tauri/src/db.rs`

**Interfaces:**
- Produces: `Db::Pg` implementing the same methods; `Db::connect_pg(url)`; a `pub fn translate_placeholders(sql: &str) -> String` (`?1`→`$1`, …) used only by the Pg arm. `DbError::Pg` variant.

- [ ] **Step 1: Add deps** to `Cargo.toml` `[dependencies]`:

```toml
postgres = "0.19"
postgres-native-tls = "0.5"
native-tls = "0.2"
```

- [ ] **Step 2: Write the placeholder-translation test** (`db.rs` `#[cfg(test)]`):

```rust
#[test]
fn translate_placeholders_qmark_to_dollar() {
    assert_eq!(translate_placeholders("select * from t where a=?1 and b=?2"),
               "select * from t where a=$1 and b=$2");
    assert_eq!(translate_placeholders("insert into t values (?1,?2,?3)"),
               "insert into t values ($1,$2,$3)");
    // ?10 must not be mangled into ?1 + 0
    assert_eq!(translate_placeholders("x=?10"), "x=$10");
}
```

- [ ] **Step 3: Run — verify FAIL.**
Run: `cargo test --manifest-path apps/outreach/src-tauri/Cargo.toml translate_placeholders`
Expected: FAIL.

- [ ] **Step 4: Implement** `translate_placeholders` (regex-free: scan for `?` followed by ASCII digits, emit `$` + same digits), the `Db::Pg` arm delegating to `postgres::Client` (applying `translate_placeholders` to every SQL string first), the `postgres::Row` accessor shim (`get_str`→`row.get::<_,String>`, `get_i64`, `get_opt_str`→`row.get::<_,Option<String>>`), `connect_pg(url)` (native-tls connector for Neon `sslmode=require`), and `DbError::Pg`.

- [ ] **Step 5: Run — verify PASS** (translation unit test; the Pg live path is exercised in Phase 5's env-gated test).
Run: `cargo test --manifest-path apps/outreach/src-tauri/Cargo.toml translate_placeholders`
Expected: PASS. Also `cargo build` clean with the new deps.

- [ ] **Step 6: Commit.**

```bash
git add -f apps/outreach/src-tauri/Cargo.toml apps/outreach/src-tauri/Cargo.lock apps/outreach/src-tauri/src/db.rs
git commit -m "feat(outreach): Db Postgres arm + ?N→\$N placeholder translation"
```

### Task 2.3: `open_board` dispatch + Postgres DDL + race-safe seed

**Files:**
- Modify: `apps/outreach/src-tauri/src/db.rs`
- Modify: `apps/outreach/src-tauri/src/board.rs` (move `SCHEMA`/`DEFAULT_STAGES`/seed into a form `open_board` can call for both backends)

**Interfaces:**
- Produces: `pub fn open_board(project_dir: &Path, database_url: Option<&str>, actor: &Actor) -> Result<Db, DbError>` where `Actor { id: String, label: String }`. Postgres path: connect, run `ensure_schema_pg` (idempotent DDL), `seed_once` under `pg_advisory_xact_lock`. SQLite path: `open_sqlite(project_dir/board.db)` + existing `init`. Both upsert the `actor` (`on conflict do nothing`). Consumed by Tauri cmds, board-cli, projects.rs in Phase 4.

- [ ] **Step 1: Write the seed-idempotency test** (SQLite, `db.rs` or `board.rs` tests):

```rust
#[test]
fn open_board_sqlite_seeds_once_and_registers_actor() {
    let tmp = tempfile::TempDir::new().unwrap();
    let actor = Actor { id: "ada".into(), label: "Ada".into() };
    let mut db = open_board(tmp.path(), None, &actor).unwrap();
    // seeded 5 stages, one board_config, actor upserted
    assert_eq!(db.query_opt("select count(*) from stages", &[], |r| r.get_i64(0)).unwrap(), Some(5));
    assert_eq!(db.query_opt("select count(*) from board_config", &[], |r| r.get_i64(0)).unwrap(), Some(1));
    assert_eq!(db.query_opt("select label from actors where id=?1", &[&"ada"], |r| r.get_str(0)).unwrap(), Some("Ada".to_string()));
    // reopening does not double-seed
    drop(db);
    let mut db2 = open_board(tmp.path(), None, &actor).unwrap();
    assert_eq!(db2.query_opt("select count(*) from stages", &[], |r| r.get_i64(0)).unwrap(), Some(5));
}
```

- [ ] **Step 2: Run — verify FAIL.**
Run: `cargo test --manifest-path apps/outreach/src-tauri/Cargo.toml open_board_sqlite_seeds_once`
Expected: FAIL.

- [ ] **Step 3: Implement** `Actor`, `open_board`, `ensure_schema_pg` (the six-table DDL in Postgres dialect: `text`/`int` as-is; `events.seq bigint generated always as identity primary key`; `board_config.id int primary key check (id=1)`; same FKs), and `seed_once` (shared by both: `insert … on conflict do nothing` for stages/board_config/actor; Postgres wraps it in `pg_advisory_xact_lock(918273)` inside a transaction; SQLite keeps the existing count==0 guard). Actor upsert runs on every open. Keep the existing SQLite `init`/`SCHEMA` working (SQLite arm can keep using `execute_batch(SCHEMA)`).

- [ ] **Step 4: Run — verify PASS.**
Run: `cargo test --manifest-path apps/outreach/src-tauri/Cargo.toml open_board_sqlite_seeds_once`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add -f apps/outreach/src-tauri/src/db.rs apps/outreach/src-tauri/src/board.rs
git commit -m "feat(outreach): open_board dispatch + Postgres DDL + race-safe seed + actor upsert"
```

---

## Phase 3 — Port `board.rs` verbs onto `Db`

### Task 3.1: Port `commit` / `revert` / `apply_state` / `ComposableTx`

**Files:**
- Modify: `apps/outreach/src-tauri/src/board.rs`

**Interfaces:**
- Consumes: `Db` (Task 2.x). Produces: `commit(db: &mut Db, ev: &Event) -> Result<i64, DbError>`, `revert(db: &mut Db, seq: i64) -> Result<usize, DbError>`, `apply_state(db: &mut Db, ..)`, `ComposableTx` over `&mut Db`. These keep their exact logic (one event per change, version bump, the `apply_state` arms incl. `lead.created`/`stage.unretired` from the final-review fixes) — only the handle type + call syntax change.

- [ ] **Step 1:** Change `commit`/`revert`/`apply_state`/`ComposableTx` signatures from `&Connection` to `&mut Db`; rewrite their SQL calls (`c.execute` → `db.exec`, `c.query_row` → `db.query_opt`, etc.). `commit`'s seq: use `db.commit_event_returning_seq(...)`. `ComposableTx::begin/commit/drop` call `db.savepoint/release/rollback_to`. Keep all logic identical.

- [ ] **Step 2: Run the existing revert/commit tests** (they already assert the §15 guarantees; they now run over `Db::Sqlite`):
Run: `cargo test --manifest-path apps/outreach/src-tauri/Cargo.toml board::tests::revert`
Expected: the existing `revert_*` tests + acceptance PASS unchanged. (If a test constructs a `Connection` directly, update it to `Db::sqlite_in_memory()` — mechanical.)

- [ ] **Step 3: Commit.**

```bash
git add -f apps/outreach/src-tauri/src/board.rs
git commit -m "feat(outreach): port commit/revert/apply_state/ComposableTx onto Db"
```

### Task 3.2: Port the read helpers + all lead/stage verbs onto `Db`

**Files:**
- Modify: `apps/outreach/src-tauri/src/board.rs`

**Interfaces:**
- All `pub fn` verbs (`add_lead`, `move_lead`, `append_context`, `draft_message`, `attach_transcript`, `rename_stage`, `reorder_stages`, `add_stage`, `retire_stage`, `unretire_stage`, `remap_stage`, `count_leads_in`, `rules_referencing`) and the `*_json` read helpers change from `&Connection` → `&mut Db`; their SQL call syntax updates to `db.*`. Signatures otherwise unchanged. `move_lead`/`add_lead`/verbs that took an `actor: &str` keep it (Phase 4 passes the configured actor).

- [ ] **Step 1:** Mechanically port every remaining `c.<sqlmethod>(...)` in `board.rs` to `db.<method>(...)`, threading `&mut Db`. The verb/gate logic (rule checks, blast-radius `>5`, optimistic `version` where clause, merge-never-clobber JSON handling) is unchanged — only the handle + call syntax. Author SQL with `?N` placeholders (the Pg arm translates).

- [ ] **Step 2: Run the FULL crate suite** — this is the regression gate proving the port preserved every verb + gate:
Run: `cargo test --manifest-path apps/outreach/src-tauri/Cargo.toml`
Expected: all prior board tests (42 total incl. the §15.8 acceptance, all gate + revert tests) PASS against `Db::Sqlite`. Fix any test that constructed a raw `Connection` to use `Db` (mechanical; do NOT weaken assertions).

- [ ] **Step 3: Commit.**

```bash
git add -f apps/outreach/src-tauri/src/board.rs
git commit -m "feat(outreach): port all board verbs + read helpers onto Db (gates/logic unchanged)"
```

---

## Phase 4 — Wire `open_board` + actor through the app

### Task 4.1: Route Tauri commands, board-cli, and project create/open through `open_board`

**Files:**
- Modify: `apps/outreach/src-tauri/src/board.rs` (`db_for_active`)
- Modify: `apps/outreach/src-tauri/src/bin/board_cli.rs`
- Modify: `apps/outreach/src-tauri/src/projects.rs`

**Interfaces:**
- `db_for_active(state)` becomes: read `settings::load()` for `database_url` + `actor_name`; build `Actor { id: actor_name.map(slugify).unwrap_or("local"), label: actor_name.unwrap_or("You") }`; call `open_board(active_dir, database_url.as_deref(), &actor)`. Tauri command bodies keep calling the verbs (now `&mut Db`). `board_add_lead`/`board_move_lead`/etc. pass `actor.id` instead of the literal `"local"`.
- `board-cli`: read `DATABASE_URL` + `OUTREACH_ACTOR` env; build `Actor` (id = slugify(OUTREACH_ACTOR) or "local"); `open_board($OUTREACH_PROJECT dir, DATABASE_URL, &actor)`. Dispatch passes `actor.id` to write verbs.
- `projects.rs create_project_dir`: replace the eager `board::open(dir/board.db)` with `open_board(dir, settings db url, &actor)` so a new project seeds either its local db or (if a shared URL is set) confirms the shared board exists. (Opening a shared board from "create" is fine — seed is idempotent.)

- [ ] **Step 1:** Update `db_for_active`, `board-cli` `main`, and `projects.rs` per the interfaces. Thread the configured `actor.id` into every write-verb call that currently passes `"local"`. Where board-cli/Tauri build the `Actor`, centralize it in one small helper (e.g. `fn actor_from(name: Option<&str>) -> Actor`) to avoid drift.

- [ ] **Step 2: Build + full suite.**
Run: `cargo build --manifest-path apps/outreach/src-tauri/Cargo.toml --bin board-cli && cargo test --manifest-path apps/outreach/src-tauri/Cargo.toml`
Expected: build clean; all tests green (still SQLite/local — no DB url in tests). Add a test that `db_for_active`/the actor helper maps a name → slugified id (`"Ada Lovelace"` → `"ada-lovelace"`, label `"Ada Lovelace"`) and `None` → `("local","You")`.

- [ ] **Step 3: Commit.**

```bash
git add -f apps/outreach/src-tauri/src/board.rs apps/outreach/src-tauri/src/bin/board_cli.rs apps/outreach/src-tauri/src/projects.rs
git commit -m "feat(outreach): route app + board-cli through open_board with configured actor"
```

### Task 4.2: MCP server passes DB URL + actor to board-cli

**Files:**
- Modify: `apps/outreach/mcp/src/board-cli.ts` (and `server.ts` if it constructs env)
- Modify: `apps/outreach/src-tauri/src/skill.rs` (the `.mcp.json` env block)

**Interfaces:**
- `callBoardCli` spawns `board-cli` with `OUTREACH_PROJECT` (existing) plus `DATABASE_URL` and `OUTREACH_ACTOR` inherited from the server process env. `skill.rs`'s `write_mcp_config` adds `DATABASE_URL`/`OUTREACH_ACTOR` to the registered server's `env` when they are set (read from `settings.rs`), so the terminal agent's MCP session targets the same shared board + name as the UI.

- [ ] **Step 1:** In `board-cli.ts`, ensure the child spawn inherits `DATABASE_URL`/`OUTREACH_ACTOR` (pass `env: { ...process.env }` or explicit keys). In `skill.rs`, when writing `.mcp.json`, include `DATABASE_URL`/`OUTREACH_ACTOR` in the `outreach` server's `env` map when `settings::load()` has them (else omit → local mode).

- [ ] **Step 2: Test.**
Run: `cd apps/outreach/mcp && npm test` (the existing callBoardCli mapping test still passes; extend the stub test to assert env passthrough if practical) and `cargo test --manifest-path apps/outreach/src-tauri/Cargo.toml` (add a `write_mcp_config` test asserting that when a db url is set, the `.mcp.json` contains `DATABASE_URL`).
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add -f apps/outreach/mcp/src/board-cli.ts apps/outreach/src-tauri/src/skill.rs
git commit -m "feat(outreach): MCP passes shared DB url + actor to board-cli"
```

---

## Phase 5 — Postgres integration tests (env-gated)

### Task 5.1: Acceptance + concurrency against a real Postgres

**Files:**
- Create: `apps/outreach/src-tauri/tests/pg_integration.rs`

**Interfaces:**
- Consumes: `outreach_app_lib::{db, board}`. Runs ONLY when `OUTREACH_TEST_PG` (a throwaway Postgres URL) is set; otherwise every test early-returns (prints "skipped: OUTREACH_TEST_PG unset").

- [ ] **Step 1: Write the env-gated integration tests:**
  - `pg_acceptance_lifecycle`: mirror the §15.8 acceptance (create stage → move cards → rename → reorder → rule blocks merge → remap → merge → revert restores) but against `Db::Pg` (open_board with the test URL). Use a unique schema/table-prefix or a `drop … cascade` teardown so reruns are clean.
  - `pg_optimistic_conflict`: two `Db::Pg` handles on the same board; handle A `move_lead(id, s, v)`; handle B `move_lead(id, s2, v)` with the now-stale `v` → returns `conflict:`.
  - `pg_seed_race`: two handles call `open_board` concurrently on a fresh DB → exactly 5 stages, one board_config (advisory-lock guard holds).

```rust
fn pg_url() -> Option<String> { std::env::var("OUTREACH_TEST_PG").ok() }
// each test: let Some(url) = pg_url() else { eprintln!("skipped: OUTREACH_TEST_PG unset"); return; };
```

- [ ] **Step 2: Run gated (no URL → skipped, suite stays green):**
Run: `cargo test --manifest-path apps/outreach/src-tauri/Cargo.toml --test pg_integration`
Expected: PASS (all skipped) without a URL. With `OUTREACH_TEST_PG=<neon test url>` set, they run for real and PASS.

- [ ] **Step 3: Commit.**

```bash
git add -f apps/outreach/src-tauri/tests/pg_integration.rs
git commit -m "test(outreach): env-gated Postgres acceptance + concurrency + seed-race"
```

---

## Phase 6 — Settings UI (DB URL + Your name)

### Task 6.1: Two fields in the Settings panel

**Files:**
- Modify: `apps/outreach/src/properties/Settings.tsx`
- Modify: `apps/outreach/src/board/api.ts`

**Interfaces:**
- `api.ts`: `setDatabaseUrl(url: string)` → `invoke("set_database_url",{url})`; `setActorName(name: string)` → `invoke("set_actor_name",{name})`; `getSettings()` → `invoke("get_settings")` returning at least `{ databaseUrl?: string; actorName?: string }`.
- `Settings.tsx`: a **"Sharing"** section above the stages list with two `Input`s ("Your name", "Shared database URL"), seeded from `getSettings()`, saving on blur/Enter. A one-line note: "With a shared URL, everyone using it sees and edits the same board live. Changes apply on next app open." (open-scoped is fine — connection is established at project open.)

- [ ] **Step 1: Write the failing test** (`src/properties/__tests__/Settings.test.tsx` — extend existing): `Settings` renders a "Your name" field and a "Shared database URL" field seeded from props, and calls `onSaveActor`/`onSaveDbUrl` on Enter. Keep the component presentational (take current values + callbacks as props; the OutreachApp wiring calls the api).

```tsx
it("renders sharing fields and saves name + db url", () => {
  const onSaveActor = vi.fn(); const onSaveDbUrl = vi.fn();
  render(<Settings stages={stages} config={config}
    actorName="Ada" databaseUrl="postgres://x"
    onRename={()=>{}} onSaveActor={onSaveActor} onSaveDbUrl={onSaveDbUrl} />);
  const name = screen.getByDisplayValue("Ada");
  fireEvent.change(name, { target: { value: "Grace" } });
  fireEvent.keyDown(name, { key: "Enter" });
  expect(onSaveActor).toHaveBeenCalledWith("Grace");
});
```

- [ ] **Step 2: Run — FAIL.**
Run: `cd apps/outreach && npx vitest run src/properties`

- [ ] **Step 3: Implement** the two fields + the three new `Settings` props; wire `api.ts` wrappers; in `OutreachApp.tsx` pass current settings + save callbacks (load via `getSettings()` on mount). Token classes only.

- [ ] **Step 4: Run — PASS**, then `npm run build`.
Run: `cd apps/outreach && npx vitest run src/properties && npm run build`

- [ ] **Step 5: Commit.**

```bash
git add -f apps/outreach/src/properties/Settings.tsx apps/outreach/src/board/api.ts apps/outreach/src/properties/__tests__/Settings.test.tsx apps/outreach/src/OutreachApp.tsx
git commit -m "feat(outreach): Settings — Your name + Shared database URL fields"
```

---

## Self-Review

- **Spec coverage:** Db seam (2.1/2.2) · local-first dispatch (2.3) · Postgres DDL + race-safe seed (2.3/5.1) · actor from config (1.1/4.1) · verb+gate port preserving §15 (3.1/3.2, guarded by the existing 42 tests) · `events.seq` both dialects (Decision 4 in 2.x/3.1) · live sync = existing poll (no code; noted) · MCP env passthrough (4.2) · env-gated PG tests incl. concurrency + seed race (5.1) · Settings UI for URL+name (6.1). Non-goals (auth/push/CRDT/migration/async) are respected — no task builds them.
- **Placeholders:** none — every code step shows code or an exact command.
- **Type consistency:** `Db`, `DbError`, `Actor`, `open_board`, the row-accessor getters (`get_str/get_i64/get_opt_str`), and the verb signatures (`&mut Db`) are defined in Phase 2 and consumed by name in Phases 3–4. Settings field names (`database_url`/`actor_name` Rust ↔ `databaseUrl`/`actorName` camelCase JS) are consistent with Tauri's mapping.

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-07-25-outreach-multiuser-postgres.md`. Recommended: **Subagent-Driven Development** (fresh subagent per task, review between). The existing 42-test suite is the regression spine for the port — every port task re-runs it.
