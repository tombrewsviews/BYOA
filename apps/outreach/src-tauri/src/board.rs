//! SQLite data layer for the Outreach board (`board.db`).
//!
//! Schema + default-stage bootstrap live here (Task 1.1). Later tasks add
//! commit(), revert(), and the board verbs to this same file.

use crate::db::{DbError, SqlParam};
// Re-export the `Db` seam (via a `pub use`) so binaries (board-cli) can name
// it as `outreach_app_lib::board::Db` without the `db` module being public.
pub use crate::db::Db;

const SCHEMA: &str = "
create table if not exists actors (
  id         text primary key,
  label      text not null,
  created_at text not null
);
create table if not exists stages (
  id         text primary key,
  label      text not null,
  position   int  not null,
  color      text,
  retired_at text,
  created_at text not null,
  created_by text not null references actors(id),
  version    int  not null default 1
);
create table if not exists leads (
  id          text primary key,
  stage       text not null references stages(id),
  name        text not null,
  org         text,
  context     text not null default '{}',
  messages    text not null default '[]',
  transcripts text not null default '[]',
  archived_at text,
  created_at  text not null,
  updated_at  text not null,
  version     int  not null default 1
);
create table if not exists events (
  seq        integer primary key autoincrement,
  type       text not null,
  entity_id  text not null,
  before     text,
  after      text,
  verb       text not null,
  actor      text not null references actors(id),
  created_at text not null
);
create table if not exists board_config (
  id         integer primary key check (id = 1),
  name       text not null default 'Outreach board',
  created_by text not null references actors(id),
  version    int  not null default 1
);
create table if not exists rules (
  id         text primary key,
  name       text not null,
  enabled    int  not null default 1,
  conditions text not null,
  action     text not null
);
";

/// The five default stages, in order: (id, label).
const DEFAULT_STAGES: [(&str, &str); 5] = [
    ("researching", "Researching"),
    ("ready_to_contact", "Ready to contact"),
    ("contacted", "Contacted"),
    ("warm", "Warm"),
    ("won", "Won"),
];

/// The signed-in user driving a board session (used to seed/attribute rows
/// created via `open_board`).
pub struct Actor {
    pub id: String,
    pub label: String,
}

/// Build an Actor from an optional configured display name.
/// `Some("Ada Lovelace")` → id "ada-lovelace" (slug, HYPHENS), label "Ada Lovelace".
/// `None` (or empty/whitespace) → the local default ("local", "You") — today's
/// single-user identity.
pub fn actor_from(name: Option<&str>) -> Actor {
    match name {
        Some(n) if !n.trim().is_empty() => Actor {
            id: slug::slugify(n),
            label: n.trim().to_string(),
        },
        _ => Actor { id: "local".into(), label: "You".into() },
    }
}

/// Postgres dialect of `SCHEMA`, one `create table if not exists` statement
/// per table (Postgres arm has no multi-statement `execute_batch`, so these
/// are run one at a time via `Db::exec`). Dialect deltas from `SCHEMA`:
/// every integer column is `bigint`; `events.seq` is
/// `bigint generated always as identity primary key`; `board_config.id` is
/// `bigint primary key check (id = 1)`. The `events` column stays named
/// `type`. Everything else ports verbatim.
const PG_SCHEMA_STMTS: [&str; 6] = [
    "create table if not exists actors (
      id         text primary key,
      label      text not null,
      created_at text not null
    )",
    "create table if not exists stages (
      id         text primary key,
      label      text not null,
      position   bigint not null,
      color      text,
      retired_at text,
      created_at text not null,
      created_by text not null references actors(id),
      version    bigint not null default 1
    )",
    "create table if not exists leads (
      id          text primary key,
      stage       text not null references stages(id),
      name        text not null,
      org         text,
      context     text not null default '{}',
      messages    text not null default '[]',
      transcripts text not null default '[]',
      archived_at text,
      created_at  text not null,
      updated_at  text not null,
      version     bigint not null default 1
    )",
    "create table if not exists events (
      seq        bigint generated always as identity primary key,
      type       text not null,
      entity_id  text not null,
      before     text,
      after      text,
      verb       text not null,
      actor      text not null references actors(id),
      created_at text not null
    )",
    "create table if not exists board_config (
      id         bigint primary key check (id = 1),
      name       text not null default 'Outreach board',
      created_by text not null references actors(id),
      version    bigint not null default 1
    )",
    "create table if not exists rules (
      id         text primary key,
      name       text not null,
      enabled    bigint not null default 1,
      conditions text not null,
      action     text not null
    )",
];

/// Run the SQLite schema (idempotent) over a `Db::Sqlite` handle via
/// `exec_batch`, reusing the same `SCHEMA` string `init` uses. Then apply
/// additive column migrations for boards created before a column existed.
fn ensure_schema_sqlite(db: &mut Db) -> Result<(), DbError> {
    db.exec_batch(SCHEMA)?;
    // `leads.archived_at` was added after the first release; a board.db seeded
    // earlier has the table without it. SQLite has no `add column if not
    // exists`, so probe `pragma table_info` and add it only when missing.
    let has_archived: bool = db
        .query_opt(
            "select count(*) from pragma_table_info('leads') where name = 'archived_at'",
            &[],
            |r| r.get_i64(0),
        )?
        .unwrap_or(0)
        > 0;
    if !has_archived {
        db.exec("alter table leads add column archived_at text", &[])?;
    }
    Ok(())
}

/// One-round-trip probe: is this Postgres board already set up? Checks whether
/// the `board_config` table exists via `to_regclass` (returns NULL for a missing
/// relation without erroring, so it's safe on a brand-new database). Table
/// existence is a sufficient proxy for "initialized": `open_board` always runs
/// schema + seed together, and the seed is idempotent — so if the schema is
/// present, re-seeding would be a no-op anyway. Lets `open_board` skip the ~12
/// schema+seed round-trips on every warm open.
///
/// The check must NOT name `board_config` in a queried FROM/subquery: Postgres
/// resolves every relation at parse time (before `to_regclass` could
/// short-circuit at runtime), so `select ... from board_config` errors on a DB
/// where the table doesn't exist yet. `to_regclass('board_config')` takes the
/// name as a text argument, so it's parse-safe.
fn pg_board_initialized(db: &mut Db) -> Result<bool, DbError> {
    db.query_opt(
        "select (to_regclass('board_config') is not null)::int::bigint",
        &[],
        |r| r.get_i64(0),
    )
    .map(|n| n.unwrap_or(0) > 0)
}

/// Run the Postgres schema (idempotent), statement-by-statement. Then apply
/// additive column migrations for shared boards created before a column existed.
fn ensure_schema_pg(db: &mut Db) -> Result<(), DbError> {
    for stmt in PG_SCHEMA_STMTS {
        db.exec(stmt, &[])?;
    }
    // `leads.archived_at` was added after the first release; Postgres supports
    // `add column if not exists`, so this is a safe no-op on an up-to-date board.
    db.exec("alter table leads add column if not exists archived_at text", &[])?;
    Ok(())
}

/// Insert `actor` into `actors` if not already present. Runs on every
/// `open_board` call, both backends — idempotent and cheap.
fn upsert_actor(db: &mut Db, actor: &Actor) -> Result<(), DbError> {
    let now = chrono::Utc::now().to_rfc3339();
    db.exec(
        "insert into actors (id, label, created_at) values (?1, ?2, ?3) on conflict (id) do nothing",
        &[SqlParam::Text(&actor.id), SqlParam::Text(&actor.label), SqlParam::Text(&now)],
    )?;
    Ok(())
}

/// One-time seed of the 5 default stages + board_config(id=1), attributed to
/// `actor`. Idempotent both backends.
///
/// SQLite (`is_pg = false`): keeps the existing `count(*) from stages == 0`
/// guard, wrapped in a plain transaction.
///
/// Postgres (`is_pg = true`): the guard alone isn't race-safe across
/// concurrent first-opens, so the whole seed runs inside one transaction
/// that first takes `pg_advisory_xact_lock(918273)` (an arbitrary constant
/// lock id, released automatically at commit/rollback) before re-checking
/// the guard, and every insert uses `on conflict do nothing` as a second
/// line of defense.
fn seed_once(db: &mut Db, actor: &Actor, is_pg: bool) -> Result<(), DbError> {
    if is_pg {
        db.exec("begin", &[])?;
        let result = (|| -> Result<(), DbError> {
            db.exec("select pg_advisory_xact_lock(918273)", &[])?;
            let count = db
                .query_opt("select count(*) from stages", &[], |r| r.get_i64(0))?
                .unwrap_or(0);
            if count == 0 {
                seed_rows(db, actor)?;
            }
            Ok(())
        })();
        match result {
            Ok(()) => db.exec("commit", &[]).map(|_| ()),
            Err(e) => {
                let _ = db.exec("rollback", &[]);
                Err(e)
            }
        }
    } else {
        let count = db
            .query_opt("select count(*) from stages", &[], |r| r.get_i64(0))?
            .unwrap_or(0);
        if count == 0 {
            db.exec("begin", &[])?;
            let result = seed_rows(db, actor);
            match result {
                Ok(()) => db.exec("commit", &[]).map(|_| ()),
                Err(e) => {
                    let _ = db.exec("rollback", &[]);
                    Err(e)
                }
            }
        } else {
            Ok(())
        }
    }
}

/// The actual seed inserts, shared by both `seed_once` arms: the configured
/// actor FIRST (so `created_by references actors(id)` is satisfiable), then
/// the 5 default stages, then `board_config`. Every insert uses
/// `on conflict do nothing` so a lost race (Postgres) or a re-run is a no-op.
fn seed_rows(db: &mut Db, actor: &Actor) -> Result<(), DbError> {
    let now = chrono::Utc::now().to_rfc3339();
    db.exec(
        "insert into actors (id, label, created_at) values (?1, ?2, ?3) on conflict (id) do nothing",
        &[SqlParam::Text(&actor.id), SqlParam::Text(&actor.label), SqlParam::Text(&now)],
    )?;
    for (i, (id, label)) in DEFAULT_STAGES.iter().enumerate() {
        db.exec(
            "insert into stages (id, label, position, color, created_at, created_by, version)
             values (?1, ?2, ?3, null, ?4, ?5, 1) on conflict (id) do nothing",
            &[
                SqlParam::Text(id),
                SqlParam::Text(label),
                SqlParam::Int(i as i64),
                SqlParam::Text(&now),
                SqlParam::Text(&actor.id),
            ],
        )?;
    }
    db.exec(
        "insert into board_config (id, name, created_by, version)
         values (1, 'Outreach board', ?1, 1) on conflict (id) do nothing",
        &[SqlParam::Text(&actor.id)],
    )?;
    Ok(())
}

/// Open a board for either backend: Postgres when `database_url` is set
/// (creates the Postgres schema, race-safe one-time seed), otherwise SQLite
/// under `project_dir/board.db` (existing schema + seed). Upserts `actor`
/// into `actors` on every open, both backends.
pub fn open_board(
    project_dir: &std::path::Path,
    database_url: Option<&str>,
    actor: &Actor,
) -> Result<Db, DbError> {
    let mut db = match database_url {
        Some(url) => {
            // A shared Postgres board opens over the network — every statement is
            // a remote round-trip, so a slow/distant DB makes the (UI-blocking)
            // open path slow. Log the elapsed open time so a recurrence of the
            // "loading too long" symptom is visible in the app's stderr, keyed to
            // the exact cause. The local SQLite path is instant and unlogged.
            let start = std::time::Instant::now();
            let mut db = Db::connect_pg(url)?;
            // Schema creation (7 DDL round-trips) + seed (advisory lock + count +
            // inserts) only need to run on a *fresh* shared board. Re-running them
            // on every open turned a Postgres board-open into ~9s of remote
            // round-trips. Probe once: if the board is already initialized, skip
            // both — a warm open is then just the connect + probe.
            let fresh = !pg_board_initialized(&mut db)?;
            if fresh {
                ensure_schema_pg(&mut db)?;
                seed_once(&mut db, actor, true)?;
            }
            eprintln!(
                "[outreach] shared board open: {}ms ({})",
                start.elapsed().as_millis(),
                if fresh { "fresh: schema+seed" } else { "warm" }
            );
            db
        }
        None => {
            let mut db = Db::open_sqlite(&project_dir.join("board.db"))?;
            db.exec("PRAGMA foreign_keys = ON", &[])?;
            ensure_schema_sqlite(&mut db)?;
            seed_once(&mut db, actor, false)?;
            db
        }
    };
    upsert_actor(&mut db, actor)?;
    Ok(db)
}

/// How many leads a board holds — used to decide whether a shared board is
/// "empty" (safe to seed from a local board) before copying.
pub fn lead_count(db: &mut Db) -> Result<i64, DbError> {
    Ok(db.query_opt("select count(*) from leads", &[], |r| r.get_i64(0))?.unwrap_or(0))
}

/// Copy every stage and lead from `src` into `dst`, preserving each lead's full
/// state (context, messages, transcripts, archived flag, timestamps). Used to
/// seed a fresh shared (Postgres) board from the user's existing local board so
/// enabling sharing doesn't strand their data on a blank remote board.
///
/// - Stages: inserted `on conflict do nothing`, so `dst`'s five default seeded
///   stages are kept and any custom stages from `src` are added. A lead whose
///   stage id doesn't exist in `dst` would violate the FK, so we insert all of
///   `src`'s stages first.
/// - Leads: inserted with their original ids and full column set. `on conflict
///   do nothing` makes a re-run idempotent (already-copied leads are skipped),
///   so this is safe to invoke more than once.
/// - The event log is NOT copied — `dst` keeps its own history; this is a seed,
///   not a merge of two divergent boards.
///
/// Returns the number of leads copied (newly inserted).
///
/// `on_progress(done, total)` is called after each lead is processed so a
/// caller can surface a live progress bar; `total` is the number of leads in
/// `src`. Pass `&mut |_, _| {}` when progress isn't needed.
pub fn copy_board(
    src: &mut Db,
    dst: &mut Db,
    actor: &str,
    on_progress: &mut dyn FnMut(i64, i64),
) -> Result<i64, DbError> {
    // Stages from src (skip nothing — default ids will conflict-noop in dst).
    let stages: Vec<(String, String, i64, Option<String>, Option<String>, String)> = src
        .query_all(
            "select id, label, position, color, retired_at, created_at from stages",
            &[],
            |r| {
                Ok((
                    r.get_str(0)?,
                    r.get_str(1)?,
                    r.get_i64(2)?,
                    r.get_opt_str(3)?,
                    r.get_opt_str(4)?,
                    r.get_str(5)?,
                ))
            },
        )?;

    let leads: Vec<(String, String, String, Option<String>, String, String, String, Option<String>, String, String, i64)> =
        src.query_all(
            "select id, stage, name, org, context, messages, transcripts, archived_at, created_at, updated_at, version from leads",
            &[],
            |r| {
                Ok((
                    r.get_str(0)?, r.get_str(1)?, r.get_str(2)?, r.get_opt_str(3)?,
                    r.get_str(4)?, r.get_str(5)?, r.get_str(6)?, r.get_opt_str(7)?,
                    r.get_str(8)?, r.get_str(9)?, r.get_i64(10)?,
                ))
            },
        )?;

    with_tx(dst, |dst| {
        for (id, label, position, color, retired_at, created_at) in &stages {
            dst.exec(
                "insert into stages (id, label, position, color, retired_at, created_at, created_by, version)
                 values (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1) on conflict (id) do nothing",
                &[
                    SqlParam::Text(id),
                    SqlParam::Text(label),
                    SqlParam::Int(*position),
                    SqlParam::OptText(color.as_deref()),
                    SqlParam::OptText(retired_at.as_deref()),
                    SqlParam::Text(created_at),
                    SqlParam::Text(actor),
                ],
            )?;
        }

        let total = leads.len() as i64;
        let mut copied = 0i64;
        let mut done = 0i64;
        for (id, stage, name, org, context, messages, transcripts, archived_at, created_at, updated_at, version) in &leads {
            let n = dst.exec(
                "insert into leads (id, stage, name, org, context, messages, transcripts, archived_at, created_at, updated_at, version)
                 values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) on conflict (id) do nothing",
                &[
                    SqlParam::Text(id),
                    SqlParam::Text(stage),
                    SqlParam::Text(name),
                    SqlParam::OptText(org.as_deref()),
                    SqlParam::Json(context.clone()),
                    SqlParam::Json(messages.clone()),
                    SqlParam::Json(transcripts.clone()),
                    SqlParam::OptText(archived_at.as_deref()),
                    SqlParam::Text(created_at),
                    SqlParam::Text(updated_at),
                    SqlParam::Int(*version),
                ],
            )?;
            copied += n as i64;
            done += 1;
            on_progress(done, total);
        }
        Ok(copied)
    })
}

/// A single write to the board: applied to `entity_id`'s row and recorded
/// as an immutable row in `events`.
pub struct Event {
    pub kind: String,
    pub entity_id: String,
    pub before: serde_json::Value,
    pub after: serde_json::Value,
    pub verb: String,
    pub actor: String,
}

/// Monotonic savepoint-name source (names must be unique to nest safely).
fn next_sp_name() -> String {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("board_sp_{n}")
}

/// Run `body` inside a SAVEPOINT: release on Ok, rollback-to + release on Err.
/// Nests correctly (SAVEPOINTs compose in SQLite and Postgres) and works
/// standalone (a top-level SAVEPOINT implicitly opens a transaction, and
/// RELEASE commits it). Replaces the old `is_autocommit` BEGIN/SAVEPOINT
/// split with one uniform, backend-agnostic path.
fn with_tx<T>(
    db: &mut Db,
    body: impl FnOnce(&mut Db) -> Result<T, DbError>,
) -> Result<T, DbError> {
    let name = next_sp_name();
    db.savepoint(&name)?;
    match body(db) {
        Ok(v) => {
            db.release(&name)?;
            Ok(v)
        }
        Err(e) => {
            // best-effort unwind; `rollback_to` leaves the savepoint open in
            // both dialects, so release it too. Propagate the ORIGINAL error.
            let _ = db.rollback_to(&name);
            let _ = db.release(&name);
            Err(e)
        }
    }
}

/// Applies `value` (a before- or after-state) to the row identified by
/// (kind, entity_id). Version-bumps the row. Unlisted kinds are a no-op
/// (event-only, no row change). Shared by `commit` (applies `after`) and
/// `revert` (applies `before`) so the two stay in lockstep.
fn apply_state(
    db: &mut Db,
    kind: &str,
    entity_id: &str,
    value: &serde_json::Value,
) -> Result<(), DbError> {
    let now = chrono::Utc::now().to_rfc3339();
    match kind {
        "lead.stage" => {
            db.exec(
                "update leads set stage = ?1, updated_at = ?2, version = version + 1 where id = ?3",
                &[SqlParam::OptText(value["stage"].as_str()), SqlParam::Text(&now), SqlParam::Text(entity_id)],
            )?;
        }
        "lead.context" => {
            db.exec(
                "update leads set context = ?1, updated_at = ?2, version = version + 1 where id = ?3",
                &[SqlParam::Json(value.to_string()), SqlParam::Text(&now), SqlParam::Text(entity_id)],
            )?;
        }
        "lead.messages" => {
            db.exec(
                "update leads set messages = ?1, updated_at = ?2, version = version + 1 where id = ?3",
                &[SqlParam::Json(value.to_string()), SqlParam::Text(&now), SqlParam::Text(entity_id)],
            )?;
        }
        "lead.transcripts" => {
            db.exec(
                "update leads set transcripts = ?1, updated_at = ?2, version = version + 1 where id = ?3",
                &[SqlParam::Json(value.to_string()), SqlParam::Text(&now), SqlParam::Text(entity_id)],
            )?;
        }
        "stage.renamed" => {
            db.exec(
                "update stages set label = ?1, version = version + 1 where id = ?2",
                &[SqlParam::OptText(value["label"].as_str()), SqlParam::Text(entity_id)],
            )?;
        }
        "stage.retired" => {
            db.exec(
                "update stages set retired_at = ?1, version = version + 1 where id = ?2",
                &[SqlParam::OptText(value["retired_at"].as_str()), SqlParam::Text(entity_id)],
            )?;
        }
        "stage.unretired" => {
            db.exec(
                "update stages set retired_at = ?1, version = version + 1 where id = ?2",
                &[SqlParam::OptText(value["retired_at"].as_str()), SqlParam::Text(entity_id)],
            )?;
        }
        "stage.reordered" => {
            if let Some(positions) = value["positions"].as_object() {
                for (id, pos) in positions {
                    if let Some(pos) = pos.as_i64() {
                        db.exec(
                            "update stages set position = ?1 where id = ?2",
                            &[SqlParam::Int(pos), SqlParam::Text(id)],
                        )?;
                    }
                }
            }
        }
        "stage.created" => {
            if value.is_null() {
                db.exec("delete from stages where id = ?1", &[SqlParam::Text(entity_id)])?;
            }
        }
        "lead.created" => {
            if value.is_null() {
                db.exec("delete from leads where id = ?1", &[SqlParam::Text(entity_id)])?;
            }
        }
        "lead.archived" => {
            // `after.archived_at` is a timestamp to archive, or null to restore.
            db.exec(
                "update leads set archived_at = ?1, updated_at = ?2, version = version + 1 where id = ?3",
                &[
                    SqlParam::OptText(value["archived_at"].as_str()),
                    SqlParam::Text(&now),
                    SqlParam::Text(entity_id),
                ],
            )?;
        }
        "lead.deleted" => {
            // Direction-aware, like `lead.created`/`stage.created`: the forward
            // event's `after` is null → drop the row; `revert` applies the
            // event's `before` (the full saved row) → recreate it. This lets the
            // event log undo a permanent delete.
            if value.is_null() {
                db.exec("delete from leads where id = ?1", &[SqlParam::Text(entity_id)])?;
            } else {
                db.exec(
                    "insert into leads
                       (id, stage, name, org, context, messages, transcripts, archived_at, created_at, updated_at, version)
                     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                     on conflict (id) do nothing",
                    &[
                        SqlParam::Text(entity_id),
                        SqlParam::OptText(value["stage"].as_str()),
                        SqlParam::OptText(value["name"].as_str()),
                        SqlParam::OptText(value["org"].as_str()),
                        SqlParam::Text(&value["context"].as_str().map(str::to_string).unwrap_or_else(|| value["context"].to_string())),
                        SqlParam::Text(&value["messages"].as_str().map(str::to_string).unwrap_or_else(|| value["messages"].to_string())),
                        SqlParam::Text(&value["transcripts"].as_str().map(str::to_string).unwrap_or_else(|| value["transcripts"].to_string())),
                        SqlParam::OptText(value["archived_at"].as_str()),
                        SqlParam::OptText(value["created_at"].as_str()),
                        SqlParam::OptText(value["updated_at"].as_str()),
                        SqlParam::Int(value["version"].as_i64().unwrap_or(1)),
                    ],
                )?;
            }
        }
        _ => {
            // other kinds applied by their verbs in later tasks
        }
    }
    Ok(())
}

/// Apply `ev.after` to its target row and record the event, atomically.
/// Runs inside a SAVEPOINT via `with_tx`, which composes with an outer
/// `with_tx` (nested SAVEPOINT) or stands alone. Returns the event's `seq`.
pub fn commit(db: &mut Db, ev: &Event) -> Result<i64, DbError> {
    let now = chrono::Utc::now().to_rfc3339();
    with_tx(db, |db| {
        apply_state(db, &ev.kind, &ev.entity_id, &ev.after)?;
        let seq = db.commit_event_returning_seq(
            "insert into events(type, entity_id, before, after, verb, actor, created_at)
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            &[
                SqlParam::Text(&ev.kind),
                SqlParam::Text(&ev.entity_id),
                SqlParam::Json(ev.before.to_string()),
                SqlParam::Json(ev.after.to_string()),
                SqlParam::Text(&ev.verb),
                SqlParam::Text(&ev.actor),
                SqlParam::Text(&now),
            ],
        )?;
        Ok(seq)
    })
}

/// Undo every event after `seq`, newest-first, restoring each one's
/// `before` state. Deletes the reverted event rows. Returns the count
/// of events reverted. Atomic (single SAVEPOINT).
pub fn revert(db: &mut Db, seq: i64) -> Result<usize, DbError> {
    with_tx(db, |db| {
        let rows: Vec<(String, String, String)> = db.query_all(
            "select type, entity_id, before from events where seq > ?1 order by seq desc",
            &[SqlParam::Int(seq)],
            |r| Ok((r.get_str(0)?, r.get_str(1)?, r.get_str(2)?)),
        )?;

        let mut count = 0usize;
        for (kind, entity_id, before) in rows {
            let before: serde_json::Value = serde_json::from_str(&before)
                .map_err(|e: serde_json::Error| DbError::Json(e.to_string()))?;
            apply_state(db, &kind, &entity_id, &before)?;
            count += 1;
        }

        db.exec("delete from events where seq > ?1", &[SqlParam::Int(seq)])?;
        Ok(count)
    })
}

/// Errors shared by all board verbs.
#[derive(Debug)]
pub enum BoardError {
    VersionConflict,
    RetiredIdReuse,
    RuleBlocked(Vec<String>), // rule NAMES blocking the op
    NeedsConfirm(usize),      // affected count exceeding the blast-radius threshold
    NotFound,
    Db(DbError),
}

impl From<DbError> for BoardError {
    fn from(e: DbError) -> Self {
        BoardError::Db(e)
    }
}

/// Move a lead to a new stage, enforcing optimistic concurrency: the caller
/// must supply the version they last read, or the write is rejected.
pub fn move_lead(
    db: &mut Db,
    id: &str,
    to_stage: &str,
    expected_version: i64,
    actor: &str,
) -> Result<i64, BoardError> {
    let current: Option<(String, i64)> = db.query_opt(
        "select stage, version from leads where id = ?1",
        &[SqlParam::Text(id)],
        |r| Ok((r.get_str(0)?, r.get_i64(1)?)),
    )?;

    let (current_stage, version) = current.ok_or(BoardError::NotFound)?;
    if version != expected_version {
        return Err(BoardError::VersionConflict);
    }

    let seq = commit(
        db,
        &Event {
            kind: "lead.stage".into(),
            entity_id: id.into(),
            before: serde_json::json!({"stage": current_stage}),
            after: serde_json::json!({"stage": to_stage}),
            verb: "moveLead".into(),
            actor: actor.into(),
        },
    )?;
    Ok(seq)
}

/// Archive or restore a lead. `archived = true` sets `archived_at` to now (the
/// card leaves the default board view but keeps all history); `false` clears it
/// (restore). Idempotent — archiving an already-archived lead just re-stamps the
/// time. Returns the committed event's seq.
pub fn set_lead_archived(
    db: &mut Db,
    id: &str,
    archived: bool,
    actor: &str,
) -> Result<i64, BoardError> {
    let current: Option<Option<String>> = db.query_opt(
        "select archived_at from leads where id = ?1",
        &[SqlParam::Text(id)],
        |r| r.get_opt_str(0),
    )?;
    let before_archived = current.ok_or(BoardError::NotFound)?;

    let after = if archived {
        serde_json::json!({ "archived_at": chrono::Utc::now().to_rfc3339() })
    } else {
        serde_json::json!({ "archived_at": serde_json::Value::Null })
    };

    let seq = commit(
        db,
        &Event {
            kind: "lead.archived".into(),
            entity_id: id.into(),
            before: serde_json::json!({ "archived_at": before_archived }),
            after,
            verb: if archived { "archiveLead" } else { "unarchiveLead" }.into(),
            actor: actor.into(),
        },
    )?;
    Ok(seq)
}

/// Permanently delete a lead. The full row is saved into the event's `before`,
/// so the event-log `revert` can still recreate it; the forward event drops the
/// row from the board. Returns the committed event's seq.
pub fn delete_lead(db: &mut Db, id: &str, actor: &str) -> Result<i64, BoardError> {
    let before = db.query_opt(
        "select stage, name, org, context, messages, transcripts, archived_at, created_at, updated_at, version
         from leads where id = ?1",
        &[SqlParam::Text(id)],
        |r| {
            Ok(serde_json::json!({
                "stage": r.get_str(0)?,
                "name": r.get_str(1)?,
                "org": r.get_opt_str(2)?,
                "context": r.get_str(3)?,
                "messages": r.get_str(4)?,
                "transcripts": r.get_str(5)?,
                "archived_at": r.get_opt_str(6)?,
                "created_at": r.get_str(7)?,
                "updated_at": r.get_str(8)?,
                "version": r.get_i64(9)?,
            }))
        },
    )?;
    let before = before.ok_or(BoardError::NotFound)?;

    let seq = commit(
        db,
        &Event {
            kind: "lead.deleted".into(),
            entity_id: id.into(),
            before,
            after: serde_json::Value::Null,
            verb: "deleteLead".into(),
            actor: actor.into(),
        },
    )?;
    Ok(seq)
}

/// Add a new stage, refusing to reuse the id of any existing (active or
/// retired) stage row.
pub fn add_stage(
    db: &mut Db,
    label: &str,
    position: i64,
    actor: &str,
) -> Result<String, BoardError> {
    let id = slug::slugify(label);

    let existing: i64 = db
        .query_opt("select count(*) from stages where id = ?1", &[SqlParam::Text(&id)], |r| {
            r.get_i64(0)
        })?
        .unwrap_or(0);
    if existing > 0 {
        return Err(BoardError::RetiredIdReuse);
    }

    let now = chrono::Utc::now().to_rfc3339();
    db.exec(
        "insert into stages (id, label, position, color, retired_at, created_at, created_by, version)
         values (?1, ?2, ?3, null, null, ?4, ?5, 1)",
        &[
            SqlParam::Text(&id),
            SqlParam::Text(label),
            SqlParam::Int(position),
            SqlParam::Text(&now),
            SqlParam::Text(actor),
        ],
    )?;

    commit(
        db,
        &Event {
            kind: "stage.created".into(),
            entity_id: id.clone(),
            before: serde_json::Value::Null,
            after: serde_json::json!({"id": id, "label": label, "position": position}),
            verb: "addStage".into(),
            actor: actor.into(),
        },
    )?;

    Ok(id)
}

/// Count leads currently sitting in `stage_id`.
pub fn count_leads_in(db: &mut Db, stage_id: &str) -> Result<usize, BoardError> {
    let n: i64 = db
        .query_opt(
            "select count(*) from leads where stage = ?1",
            &[SqlParam::Text(stage_id)],
            |r| r.get_i64(0),
        )?
        .unwrap_or(0);
    Ok(n as usize)
}

/// Names of all ENABLED rules whose `conditions` JSON references `stage_id`
/// (i.e. `conditions["stage"] == stage_id`).
pub fn rules_referencing(db: &mut Db, stage_id: &str) -> Result<Vec<String>, BoardError> {
    let rows: Vec<(String, String)> = db.query_all(
        "select name, conditions from rules where enabled = 1",
        &[],
        |r| Ok((r.get_str(0)?, r.get_str(1)?)),
    )?;

    let mut names = Vec::new();
    for (name, conditions) in rows {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&conditions) {
            if parsed["stage"].as_str() == Some(stage_id) {
                names.push(name);
            }
        }
    }
    Ok(names)
}

/// Rename a stage's label. No card impact (the stage id is unchanged), so
/// no rule check is needed.
pub fn rename_stage(db: &mut Db, id: &str, label: &str, actor: &str) -> Result<i64, BoardError> {
    let current_label: Option<String> = db.query_opt(
        "select label from stages where id = ?1",
        &[SqlParam::Text(id)],
        |r| r.get_str(0),
    )?;
    let current_label = current_label.ok_or(BoardError::NotFound)?;

    let seq = commit(
        db,
        &Event {
            kind: "stage.renamed".into(),
            entity_id: id.into(),
            before: serde_json::json!({"label": current_label}),
            after: serde_json::json!({"label": label}),
            verb: "renameStage".into(),
            actor: actor.into(),
        },
    )?;
    Ok(seq)
}

/// Set each stage's `position` to its index in `ids`, atomically. Records a
/// `stage.reordered` event whose `before`/`after` carry the old/new position
/// maps, so `apply_state`'s `stage.reordered` arm can restore either side.
pub fn reorder_stages(db: &mut Db, ids: &[&str], actor: &str) -> Result<(), BoardError> {
    let before_positions: Vec<(String, i64)> = db.query_all(
        "select id, position from stages",
        &[],
        |r| Ok((r.get_str(0)?, r.get_i64(1)?)),
    )?;
    let before_map: serde_json::Map<String, serde_json::Value> = before_positions
        .into_iter()
        .map(|(id, pos)| (id, serde_json::json!(pos)))
        .collect();

    let after_map: serde_json::Map<String, serde_json::Value> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| (id.to_string(), serde_json::json!(i as i64)))
        .collect();

    commit(
        db,
        &Event {
            kind: "stage.reordered".into(),
            entity_id: "board".into(),
            before: serde_json::json!({"positions": before_map}),
            after: serde_json::json!({"positions": after_map, "ids": ids}),
            verb: "reorderStages".into(),
            actor: actor.into(),
        },
    )?;
    Ok(())
}

/// Retire a stage: blocked if an enabled rule references it, or if more
/// than 5 leads still sit in it (large retires must route through
/// `remap_stage`, added in a later task). Otherwise sets `retired_at`.
pub fn retire_stage(db: &mut Db, id: &str, actor: &str) -> Result<i64, BoardError> {
    let exists: i64 = db
        .query_opt("select count(*) from stages where id = ?1", &[SqlParam::Text(id)], |r| {
            r.get_i64(0)
        })?
        .unwrap_or(0);
    if exists == 0 {
        return Err(BoardError::NotFound);
    }

    let blocking = rules_referencing(db, id)?;
    if !blocking.is_empty() {
        return Err(BoardError::RuleBlocked(blocking));
    }

    let n = count_leads_in(db, id)?;
    if n > 5 {
        return Err(BoardError::NeedsConfirm(n));
    }

    let now = chrono::Utc::now().to_rfc3339();

    let seq = commit(
        db,
        &Event {
            kind: "stage.retired".into(),
            entity_id: id.into(),
            before: serde_json::json!({"retired_at": null}),
            after: serde_json::json!({"retired_at": now}),
            verb: "retireStage".into(),
            actor: actor.into(),
        },
    )?;
    Ok(seq)
}

/// Unretire a stage: clears `retired_at`. No gates.
pub fn unretire_stage(db: &mut Db, id: &str, actor: &str) -> Result<i64, BoardError> {
    // Read current retired_at so revert can restore it.
    let prev: Option<String> = db
        .query_opt(
            "select retired_at from stages where id = ?1",
            &[SqlParam::Text(id)],
            |r| r.get_opt_str(0),
        )?
        .ok_or(BoardError::NotFound)?;

    let seq = commit(
        db,
        &Event {
            kind: "stage.unretired".into(),
            entity_id: id.into(),
            before: serde_json::json!({ "retired_at": prev }),
            after: serde_json::json!({ "retired_at": null }),
            verb: "unretireStage".into(),
            actor: actor.into(),
        },
    )?;
    Ok(seq)
}

/// Result of a `remap_stage` call: how many leads were (or would be)
/// affected, and their ids.
#[derive(Debug)]
pub struct RemapResult {
    pub affected: usize,
    pub lead_ids: Vec<String>,
}

/// Narrows which leads a `remap_stage` call touches (for splits). `None`
/// fields match all leads.
pub struct LeadFilter {
    pub org: Option<String>,
}

/// Remap every lead in stage `from` to stage `to` (merge, split via
/// `filter`, or retire-with-cards via `retire_source`). Blocked
/// (`RuleBlocked`) if an enabled rule references `from`. `dry_run` returns
/// the affected count/ids with no writes. Otherwise, if more than 5 leads
/// would be affected and `confirmed` is false, returns `NeedsConfirm`.
/// Writes one `lead.stage` event per lead (never batched); if
/// `retire_source`, also sets `from.retired_at` (never deletes the row).
pub fn remap_stage(
    db: &mut Db,
    from: &str,
    to: &str,
    filter: Option<LeadFilter>,
    dry_run: bool,
    retire_source: bool,
    confirmed: bool,
    actor: &str,
) -> Result<RemapResult, BoardError> {
    let blocking = rules_referencing(db, from)?;
    if !blocking.is_empty() {
        return Err(BoardError::RuleBlocked(blocking));
    }

    let to_exists: i64 = db
        .query_opt("select count(*) from stages where id = ?1", &[SqlParam::Text(to)], |r| {
            r.get_i64(0)
        })?
        .unwrap_or(0);
    if to_exists == 0 {
        return Err(BoardError::NotFound);
    }

    let lead_ids: Vec<String> = match &filter {
        Some(LeadFilter { org: Some(org) }) => db.query_all(
            "select id from leads where stage = ?1 and org = ?2",
            &[SqlParam::Text(from), SqlParam::Text(org)],
            |r| r.get_str(0),
        )?,
        _ => db.query_all(
            "select id from leads where stage = ?1",
            &[SqlParam::Text(from)],
            |r| r.get_str(0),
        )?,
    };
    let affected = lead_ids.len();

    if dry_run {
        return Ok(RemapResult { affected, lead_ids });
    }

    if affected > 5 && !confirmed {
        return Err(BoardError::NeedsConfirm(affected));
    }

    // One outer SAVEPOINT wraps every write below (§15.3: all-or-none).
    // Each `commit` call nests its own SAVEPOINT inside it, so a failure
    // partway through rolls back the entire remap, not just one lead.
    with_tx(db, |db| {
        // The key invariant is one event row per lead — never a single batched event.
        for id in &lead_ids {
            commit(
                db,
                &Event {
                    kind: "lead.stage".into(),
                    entity_id: id.clone(),
                    before: serde_json::json!({"stage": from}),
                    after: serde_json::json!({"stage": to}),
                    verb: "remapStage".into(),
                    actor: actor.into(),
                },
            )?;
        }

        if retire_source {
            let now = chrono::Utc::now().to_rfc3339();
            commit(
                db,
                &Event {
                    kind: "stage.retired".into(),
                    entity_id: from.into(),
                    before: serde_json::json!({"retired_at": null}),
                    after: serde_json::json!({"retired_at": now}),
                    verb: "remapStage".into(),
                    actor: actor.into(),
                },
            )?;
        }
        Ok(())
    })?;

    Ok(RemapResult { affected, lead_ids })
}

/// Create a new lead, recording a `lead.created` event (event-only — the
/// row insert and event write happen together, atomically).
pub fn add_lead(
    db: &mut Db,
    name: &str,
    org: Option<&str>,
    stage: &str,
    actor: &str,
) -> Result<String, BoardError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    with_tx(db, |db| {
        db.exec(
            "insert into leads (id, stage, name, org, context, messages, transcripts, created_at, updated_at, version)
             values (?1, ?2, ?3, ?4, '{}', '[]', '[]', ?5, ?5, 1)",
            &[
                SqlParam::Text(&id),
                SqlParam::Text(stage),
                SqlParam::Text(name),
                SqlParam::OptText(org),
                SqlParam::Text(&now),
            ],
        )?;

        commit(
            db,
            &Event {
                kind: "lead.created".into(),
                entity_id: id.clone(),
                before: serde_json::Value::Null,
                after: serde_json::json!({"name": name, "org": org, "stage": stage}),
                verb: "addLead".into(),
                actor: actor.into(),
            },
        )?;
        Ok(())
    })?;

    Ok(id)
}

/// Append one research item to a lead's `context.facts` array — MERGE, never
/// clobber. Reads the current context, pushes `research` onto its `facts`
/// array (treating a missing/non-array `facts` as empty), and commits the
/// merged object as the new context. Enforces optimistic concurrency via
/// `expected_version`.
pub fn append_context(
    db: &mut Db,
    id: &str,
    research: serde_json::Value,
    expected_version: i64,
    actor: &str,
) -> Result<i64, BoardError> {
    let current: Option<(String, i64)> = db.query_opt(
        "select context, version from leads where id = ?1",
        &[SqlParam::Text(id)],
        |r| Ok((r.get_str(0)?, r.get_i64(1)?)),
    )?;
    let (context_text, version) = current.ok_or(BoardError::NotFound)?;
    if version != expected_version {
        return Err(BoardError::VersionConflict);
    }

    let before: serde_json::Value = serde_json::from_str(&context_text)
        .map_err(|e: serde_json::Error| BoardError::Db(DbError::Json(e.to_string())))?;

    let mut facts = before["facts"].as_array().cloned().unwrap_or_default();
    facts.push(research);
    let after = serde_json::json!({"facts": facts});

    let seq = commit(
        db,
        &Event {
            kind: "lead.context".into(),
            entity_id: id.into(),
            before,
            after,
            verb: "appendContext".into(),
            actor: actor.into(),
        },
    )?;
    Ok(seq)
}

/// Draft a message onto a lead's `messages` array — appended, never sent.
pub fn draft_message(db: &mut Db, id: &str, msg: serde_json::Value, actor: &str) -> Result<i64, BoardError> {
    let messages_text: Option<String> = db.query_opt(
        "select messages from leads where id = ?1",
        &[SqlParam::Text(id)],
        |r| r.get_str(0),
    )?;
    let messages_text = messages_text.ok_or(BoardError::NotFound)?;

    let before: serde_json::Value = serde_json::from_str(&messages_text)
        .map_err(|e: serde_json::Error| BoardError::Db(DbError::Json(e.to_string())))?;

    let mut messages = before.as_array().cloned().unwrap_or_default();
    messages.push(msg);
    let after = serde_json::Value::Array(messages);

    let seq = commit(
        db,
        &Event {
            kind: "lead.messages".into(),
            entity_id: id.into(),
            before,
            after,
            verb: "draftMessage".into(),
            actor: actor.into(),
        },
    )?;
    Ok(seq)
}

/// Attach a call/meeting transcript to a lead's `transcripts` array.
pub fn attach_transcript(db: &mut Db, id: &str, raw: &str, summary: &str, actor: &str) -> Result<i64, BoardError> {
    let transcripts_text: Option<String> = db.query_opt(
        "select transcripts from leads where id = ?1",
        &[SqlParam::Text(id)],
        |r| r.get_str(0),
    )?;
    let transcripts_text = transcripts_text.ok_or(BoardError::NotFound)?;

    let before: serde_json::Value = serde_json::from_str(&transcripts_text)
        .map_err(|e: serde_json::Error| BoardError::Db(DbError::Json(e.to_string())))?;

    let mut transcripts = before.as_array().cloned().unwrap_or_default();
    transcripts.push(serde_json::json!({"raw": raw, "summary": summary}));
    let after = serde_json::Value::Array(transcripts);

    let seq = commit(
        db,
        &Event {
            kind: "lead.transcripts".into(),
            entity_id: id.into(),
            before,
            after,
            verb: "attachTranscript".into(),
            actor: actor.into(),
        },
    )?;
    Ok(seq)
}

// ---------------------------------------------------------------------------
// Tauri command layer — exposes the board verbs above to the frontend.
// ---------------------------------------------------------------------------

/// A board connection cached in `AppState`, keyed by what it was opened for.
/// Reopening on every command was the killer for shared (Postgres) boards: each
/// `open_board` is a ~2-3s remote connect, and the board window polls twice a
/// second, so the app spent all its time reconnecting to Neon (looked frozen).
/// Caching the open `Db` makes every command after the first a local call.
pub struct CachedBoard {
    /// Invalidation key: project dir + db url + actor id. Any change reopens.
    key: String,
    db: Db,
}

/// A locked handle to the cached board `Db`. Holds the cache mutex for the
/// duration of one command (board commands are quick once connected, so
/// serializing them on one connection is fine and matches the single-writer
/// event log). Derefs to `Db` so existing call sites use `&mut *guard`.
pub struct BoardGuard<'a> {
    cache: std::sync::MutexGuard<'a, Option<CachedBoard>>,
}

impl std::ops::Deref for BoardGuard<'_> {
    type Target = Db;
    fn deref(&self) -> &Db {
        // Always Some: db_for_active fills the cache before constructing the guard.
        &self.cache.as_ref().expect("cached board present").db
    }
}
impl std::ops::DerefMut for BoardGuard<'_> {
    fn deref_mut(&mut self) -> &mut Db {
        &mut self.cache.as_mut().expect("cached board present").db
    }
}

/// The invalidation key for the cached board connection: project dir + db url +
/// actor id. Any change reopens. Kept in one place so the command path and the
/// background warm-up agree on what "the same connection" means.
fn board_key(dir: &std::path::Path, url: Option<&str>, actor: &Actor) -> String {
    format!("{}\u{1f}{}\u{1f}{}", dir.to_string_lossy(), url.unwrap_or(""), actor.id)
}

/// Prefix marking a "not connected yet" error, so the frontend can show a
/// "Connecting…" state instead of a real failure. The board poll treats this as
/// transient and retries.
pub const CONNECTING_PREFIX: &str = "connecting:";

/// Open (or reuse) the board for the active project, sourcing the database URL +
/// actor from settings. Returns a locked handle to the cached connection plus
/// the resolved `Actor`.
///
/// CRITICAL: this runs on the UI thread (board commands are synchronous). It
/// therefore NEVER performs a slow remote connect. For a **local** board a
/// cache miss connects inline (SQLite open is instant). For a **shared**
/// (Postgres) board a cache miss returns `CONNECTING_PREFIX` immediately — the
/// slow connect is done off-thread by `warm_board_connection` (kicked off on
/// project open and by `board_ensure_connected`), which fills the cache. This
/// is what stops a set shared-DB URL from freezing the whole app on open.
fn db_from_cache<'a>(
    state: &'a crate::AppState,
    cache_field: &'a std::sync::Mutex<Option<CachedBoard>>,
) -> Result<(BoardGuard<'a>, Actor), String> {
    let dir = crate::projects::active_path(state)?;
    let s = crate::settings::load();
    let actor = actor_from(s.actor_name.as_deref());
    let key = board_key(&dir, s.database_url.as_deref(), &actor);

    let mut cache = cache_field.lock().map_err(|e| format!("board cache lock: {e}"))?;

    // Cache hit = same (project, url, actor) and the connection is still live.
    let hit = cache.as_ref().is_some_and(|c| c.key == key && !c.db.is_dead());
    if !hit {
        // A shared (remote) connect is slow and must not block the UI thread —
        // defer it to the background warm-up and tell the caller we're still
        // connecting. Local SQLite is instant, so connect it inline.
        if s.database_url.as_deref().map(str::trim).is_some_and(|u| !u.is_empty()) {
            return Err(format!("{CONNECTING_PREFIX} connecting to the shared board…"));
        }
        let db = open_board(&dir, None, &actor).map_err(|e| format!("open board: {e}"))?;
        *cache = Some(CachedBoard { key, db });
    }

    Ok((BoardGuard { cache }, actor))
}

/// Handle for READS (list/snapshot/get). Uses the read connection, which the 5s
/// poll's snapshot also uses.
fn db_for_active(state: &crate::AppState) -> Result<(BoardGuard<'_>, Actor), String> {
    db_from_cache(state, &state.board_cache)
}

/// Handle for WRITES (move/archive/delete/add/…). Uses a SEPARATE connection so
/// a user action never blocks behind an in-flight read snapshot holding the read
/// connection — the contention that made every drag/click take ~1s on a shared
/// board.
fn db_for_active_write(state: &crate::AppState) -> Result<(BoardGuard<'_>, Actor), String> {
    db_from_cache(state, &state.board_cache_write)
}

/// Connect to the active board (SQLite or Postgres) and store it in the shared
/// cache, keyed by (project, url, actor). Idempotent: if the cache already holds
/// a live connection for the same key, this is a no-op. This is the ONLY place a
/// slow remote connect happens, and it is always called from a blocking
/// background task (`spawn_blocking`), never the UI thread. Returns whether the
/// cache now holds a connection (i.e. connect succeeded).
///
/// `dir`/`url`/`actor` are captured on the UI thread before spawning (settings
/// and the active path aren't reachable from a background thread without the
/// `State`, which isn't `Send`).
fn warm_board_connection(
    cache: &std::sync::Mutex<Option<CachedBoard>>,
    warm_lock: &std::sync::Mutex<()>,
    dir: &std::path::Path,
    url: Option<String>,
    actor: &Actor,
) -> Result<(), String> {
    let key = board_key(dir, url.as_deref(), actor);

    // Fast path: already warm, no need to serialize.
    {
        let guard = cache.lock().map_err(|e| format!("board cache lock: {e}"))?;
        if guard.as_ref().is_some_and(|c| c.key == key && !c.db.is_dead()) {
            return Ok(());
        }
    }

    // Single-flight: only ONE connect runs at a time. Concurrent warmers (two
    // windows + poll ticks + the badge poll) block here instead of each opening
    // their own slow Neon connection — the stampede that thrashed the app.
    let _warming = warm_lock.lock().map_err(|e| format!("warm lock: {e}"))?;

    // Re-check under the warm lock: the warmer we queued behind may have already
    // filled the cache, in which case we do nothing (no second connect).
    {
        let guard = cache.lock().map_err(|e| format!("board cache lock: {e}"))?;
        if guard.as_ref().is_some_and(|c| c.key == key && !c.db.is_dead()) {
            return Ok(());
        }
    }

    // The connect itself runs while holding ONLY the warm lock (not the cache
    // lock), so board commands can still read the cache meanwhile.
    let db = open_board(dir, url.as_deref(), actor).map_err(|e| format!("open board: {e}"))?;
    let mut guard = cache.lock().map_err(|e| format!("board cache lock: {e}"))?;
    // Re-check the key under the lock in case settings changed mid-connect.
    if guard.as_ref().is_none_or(|c| c.key != key) {
        *guard = Some(CachedBoard { key, db });
    }
    Ok(())
}

/// Warm the active board's connection off the UI thread, filling the cache so
/// subsequent (synchronous) board commands are instant. Called by the frontend
/// on open and whenever the poll sees a `connecting:` state. Resolves once the
/// connection is ready (or errors if the connect failed). Safe to call
/// repeatedly — `warm_board_connection` is idempotent.
#[tauri::command]
pub async fn board_ensure_connected(
    state: tauri::State<'_, crate::AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // Capture everything the background connect needs on the UI thread (State
    // isn't Send). `AppState` lives for the app's lifetime, so a raw pointer to
    // the cache mutex is valid for the task; we only touch the Mutex, which is
    // Sync. Simpler: pull what we need and pass owned values.
    let dir = crate::projects::active_path(&state)?;
    let s = crate::settings::load();
    let actor = actor_from(s.actor_name.as_deref());
    let url = s.database_url.clone();

    // Fast path: local board never needs warming (instant connect on demand).
    if url.as_deref().map(str::trim).is_none_or(str::is_empty) {
        return Ok(());
    }

    let app_cache = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app_cache.state::<crate::AppState>();
        // Warm BOTH the read and the write connection, so neither the poll's
        // first snapshot nor the user's first action pays a connect. The read
        // one first (the poll needs it soonest for the board to appear).
        warm_board_connection(&state.board_cache, &state.board_warm_lock, &dir, url.clone(), &actor)?;
        warm_board_connection(&state.board_cache_write, &state.board_warm_lock, &dir, url, &actor)
    })
    .await
    .map_err(|e| format!("warm task: {e}"))?
}

/// Report the board connection state WITHOUT connecting (never blocks the UI
/// thread). `mode` is "local" or "shared"; `connected` is whether the shared
/// connection is warm and live in the cache. The Settings panel shows this as a
/// live indicator so the user can tell whether the remote DB is actually
/// reachable. For a local board `connected` is always true.
#[tauri::command]
pub fn board_connection_status(
    state: tauri::State<'_, crate::AppState>,
) -> Result<serde_json::Value, String> {
    let dir = crate::projects::active_path(&state)?;
    let s = crate::settings::load();
    let actor = actor_from(s.actor_name.as_deref());
    let is_shared = s.database_url.as_deref().map(str::trim).is_some_and(|u| !u.is_empty());

    if !is_shared {
        return Ok(serde_json::json!({ "mode": "local", "connected": true }));
    }

    let key = board_key(&dir, s.database_url.as_deref(), &actor);
    let cache = state.board_cache.lock().map_err(|e| format!("board cache lock: {e}"))?;
    let connected = cache.as_ref().is_some_and(|c| c.key == key && !c.db.is_dead());
    Ok(serde_json::json!({ "mode": "shared", "connected": connected }))
}

/// Emit one `board://sync-progress` step to the frontend so the Settings panel
/// can render a live progress bar. `phase` is one of `connecting`, `checking`,
/// `copying`, `done`, `error`; `done`/`total` are lead counts (0 outside the
/// copy phase). Best-effort — a failed emit must not fail the sync.
fn emit_sync(app: &tauri::AppHandle, phase: &str, done: i64, total: i64, message: &str) {
    use tauri::Emitter;
    let _ = app.emit(
        "board://sync-progress",
        serde_json::json!({ "phase": phase, "done": done, "total": total, "message": message }),
    );
}

/// Save a shared (Postgres) board URL WITHOUT freezing the UI.
///
/// The freeze this replaces: the old preview+copy commands were synchronous
/// `#[tauri::command] fn`s, so their slow remote Neon connect (up to the 10s
/// connect timeout) ran on the main/UI thread and locked the whole app — no
/// clicks, no window switching — until it returned. This command is `async`
/// and does every blocking DB step inside `spawn_blocking`, so the UI thread
/// is free the instant the field blurs. Each step emits `board://sync-progress`
/// so the user sees real state instead of a silent hang.
///
/// Flow (empty URL = go local, nothing to sync):
///   connecting → checking → (copying, if shared is empty and local has leads)
///   → persist URL → done.
///
/// Auto-copies local → shared when the shared board is empty and local has
/// leads, so enabling sharing never strands the user's research on a blank
/// remote board.
#[tauri::command]
pub async fn board_save_shared_url(
    state: tauri::State<'_, crate::AppState>,
    app: tauri::AppHandle,
    url: String,
) -> Result<i64, String> {
    // Pull the project path on the UI thread (instant, and `State` isn't
    // Send). Everything after this moves owned values into the blocking task.
    let dir = crate::projects::active_path(&state)?;
    let trimmed = url.trim().to_string();

    // Clearing the URL (back to a local board) — no remote work, just persist.
    if trimmed.is_empty() {
        crate::settings::set_database_url(url)?;
        emit_sync(&app, "done", 0, 0, "Using the local board.");
        return Ok(0);
    }

    let app_bg = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<i64, String> {
        let s = crate::settings::load();
        let actor = actor_from(s.actor_name.as_deref());

        emit_sync(&app_bg, "connecting", 0, 0, "Connecting to the shared board…");
        let mut shared = open_board(&dir, Some(&trimmed), &actor)
            .map_err(|e| format!("open shared: {e}"))?;

        emit_sync(&app_bg, "checking", 0, 0, "Checking the shared board…");
        let shared_count = lead_count(&mut shared).map_err(|e| format!("count shared: {e}"))?;

        let mut local = open_board(&dir, None, &actor).map_err(|e| format!("open local: {e}"))?;
        let local_count = lead_count(&mut local).map_err(|e| format!("count local: {e}"))?;

        let copied = if shared_count == 0 && local_count > 0 {
            emit_sync(&app_bg, "copying", 0, local_count, "Copying your leads to the shared board…");
            let mut on_progress = |done: i64, total: i64| {
                emit_sync(&app_bg, "copying", done, total, "Copying your leads to the shared board…");
            };
            copy_board(&mut local, &mut shared, &actor.id, &mut on_progress)
                .map_err(|e| format!("copy board: {e}"))?
        } else {
            0
        };

        // Persist only after the copy succeeds, so a failed copy leaves the app
        // on the local board (no silent switch to an empty remote board).
        crate::settings::set_database_url(url)?;
        Ok(copied)
    })
    .await
    .map_err(|e| format!("sync task: {e}"))?;

    match &result {
        Ok(copied) => emit_sync(
            &app,
            "done",
            *copied,
            *copied,
            &format!(
                "Shared board ready{}. Reopen the board to switch to it.",
                if *copied > 0 { format!(" — {copied} leads copied up") } else { String::new() }
            ),
        ),
        Err(e) => emit_sync(&app, "error", 0, 0, e),
    }
    result
}

/// Map a `BoardError` to a frontend-facing string. Stable prefixes
/// (`conflict:`, `retired-id-reuse:`, `rule-blocked:`, `needs-confirm:`,
/// `not-found:`, `db error:`) let the frontend/MCP layer pattern-match gate
/// outcomes without parsing the whole message.
pub fn board_err(e: BoardError) -> String {
    match e {
        BoardError::VersionConflict => "conflict: this lead changed since you loaded it — reload".into(),
        BoardError::RetiredIdReuse => "retired-id-reuse: a stage with this id already exists (ids are never reused)".into(),
        BoardError::RuleBlocked(names) => format!(
            "rule-blocked: {} rule(s) reference this stage — remap or disable them first: {}",
            names.len(),
            names.join(", ")
        ),
        BoardError::NeedsConfirm(n) => format!("needs-confirm: this affects {n} cards — re-run with confirm=true"),
        BoardError::NotFound => "not-found: no such lead or stage".into(),
        BoardError::Db(err) => format!("db error: {err}"),
    }
}

pub fn list_stages_json(db: &mut Db) -> Result<serde_json::Value, String> {
    let rows = db
        .query_all(
            "select id,label,position,color,retired_at,version from stages order by position",
            &[],
            |r| {
                Ok(serde_json::json!({
                    "id": r.get_str(0)?,
                    "label": r.get_str(1)?,
                    "position": r.get_i64(2)?,
                    "color": r.get_opt_str(3)?,
                    "retiredAt": r.get_opt_str(4)?,
                    "version": r.get_i64(5)?,
                }))
            },
        )
        .map_err(|e| format!("db error: {e}"))?;
    Ok(serde_json::Value::Array(rows))
}

#[tauri::command]
pub fn board_list_stages(state: tauri::State<'_, crate::AppState>) -> Result<serde_json::Value, String> {
    let (mut db, _actor) = db_for_active(&state)?;
    list_stages_json(&mut *db)
}

pub fn get_config_json(db: &mut Db) -> Result<serde_json::Value, String> {
    let row: (String, String, i64) = db
        .query_opt(
            "select name, created_by, version from board_config where id = 1",
            &[],
            |r| Ok((r.get_str(0)?, r.get_str(1)?, r.get_i64(2)?)),
        )
        .map_err(|e| format!("db error: {e}"))?
        .ok_or_else(|| "db error: missing board_config".to_string())?;
    Ok(serde_json::json!({ "name": row.0, "createdBy": row.1, "version": row.2 }))
}

#[tauri::command]
pub fn board_get_config(state: tauri::State<'_, crate::AppState>) -> Result<serde_json::Value, String> {
    let (mut db, _actor) = db_for_active(&state)?;
    get_config_json(&mut *db)
}

pub fn list_leads_json(db: &mut Db) -> Result<serde_json::Value, String> {
    let rows = db
        .query_all("select id,stage,name,org,archived_at,version from leads", &[], |r| {
            Ok(serde_json::json!({
                "id": r.get_str(0)?,
                "stage": r.get_str(1)?,
                "name": r.get_str(2)?,
                "org": r.get_opt_str(3)?,
                "archivedAt": r.get_opt_str(4)?,
                "version": r.get_i64(5)?,
            }))
        })
        .map_err(|e| format!("db error: {e}"))?;
    Ok(serde_json::Value::Array(rows))
}

#[tauri::command]
pub fn board_list_leads(state: tauri::State<'_, crate::AppState>) -> Result<serde_json::Value, String> {
    let (mut db, _actor) = db_for_active(&state)?;
    list_leads_json(&mut *db)
}

/// One-shot board read: stages + leads + config in a SINGLE command, so the
/// poll makes one connection acquisition instead of 2–3 separate commands each
/// re-acquiring the (shared, remote) connection. On a transatlantic Postgres
/// board every command is a ~600ms round-trip, and two windows polling three
/// commands each made the app feel laggy — this collapses a poll tick to one
/// call. `mode` ("local"/"shared") lets the frontend pick its poll interval
/// (fast for local SQLite, slow for a remote board).
#[tauri::command]
pub fn board_snapshot(state: tauri::State<'_, crate::AppState>) -> Result<serde_json::Value, String> {
    let is_shared = {
        let s = crate::settings::load();
        s.database_url.as_deref().map(str::trim).is_some_and(|u| !u.is_empty())
    };
    let (mut db, _actor) = db_for_active(&state)?;
    let stages = list_stages_json(&mut *db)?;
    let leads = list_leads_json(&mut *db)?;
    let config = get_config_json(&mut *db)?;
    Ok(serde_json::json!({
        "stages": stages,
        "leads": leads,
        "config": config,
        "mode": if is_shared { "shared" } else { "local" },
    }))
}

pub fn get_lead_json(db: &mut Db, id: &str) -> Result<serde_json::Value, String> {
    let row: Option<(String, String, String, Option<String>, String, String, String, Option<String>, String, String, i64)> = db
        .query_opt(
            "select id,stage,name,org,context,messages,transcripts,archived_at,created_at,updated_at,version from leads where id = ?1",
            &[SqlParam::Text(id)],
            |r| {
                Ok((
                    r.get_str(0)?,
                    r.get_str(1)?,
                    r.get_str(2)?,
                    r.get_opt_str(3)?,
                    r.get_str(4)?,
                    r.get_str(5)?,
                    r.get_str(6)?,
                    r.get_opt_str(7)?,
                    r.get_str(8)?,
                    r.get_str(9)?,
                    r.get_i64(10)?,
                ))
            },
        )
        .map_err(|e| format!("db error: {e}"))?;

    let (id, stage, name, org, context, messages, transcripts, archived_at, created_at, updated_at, version) =
        row.ok_or_else(|| board_err(BoardError::NotFound))?;

    let parse = |s: &str| -> Result<serde_json::Value, String> {
        serde_json::from_str(s).map_err(|e| format!("db error: corrupt json: {e}"))
    };

    Ok(serde_json::json!({
        "id": id,
        "stage": stage,
        "name": name,
        "org": org,
        "context": parse(&context)?,
        "messages": parse(&messages)?,
        "transcripts": parse(&transcripts)?,
        "archivedAt": archived_at,
        "createdAt": created_at,
        "updatedAt": updated_at,
        "version": version,
    }))
}

#[tauri::command]
pub fn board_get_lead(state: tauri::State<'_, crate::AppState>, id: String) -> Result<serde_json::Value, String> {
    let (mut db, _actor) = db_for_active(&state)?;
    get_lead_json(&mut *db, &id)
}

#[tauri::command]
pub fn board_add_lead(
    state: tauri::State<'_, crate::AppState>,
    name: String,
    org: Option<String>,
    stage: String,
) -> Result<String, String> {
    let (mut db, actor) = db_for_active_write(&state)?;
    add_lead(&mut *db, &name, org.as_deref(), &stage, &actor.id).map_err(board_err)
}

#[tauri::command]
pub fn board_move_lead(
    state: tauri::State<'_, crate::AppState>,
    id: String,
    to_stage: String,
    expected_version: i64,
) -> Result<i64, String> {
    let (mut db, actor) = db_for_active_write(&state)?;
    move_lead(&mut *db, &id, &to_stage, expected_version, &actor.id).map_err(board_err)
}

#[tauri::command]
pub fn board_set_lead_archived(
    state: tauri::State<'_, crate::AppState>,
    id: String,
    archived: bool,
) -> Result<i64, String> {
    let (mut db, actor) = db_for_active_write(&state)?;
    set_lead_archived(&mut *db, &id, archived, &actor.id).map_err(board_err)
}

#[tauri::command]
pub fn board_delete_lead(
    state: tauri::State<'_, crate::AppState>,
    id: String,
) -> Result<i64, String> {
    let (mut db, actor) = db_for_active_write(&state)?;
    delete_lead(&mut *db, &id, &actor.id).map_err(board_err)
}

#[tauri::command]
pub fn board_append_context(
    state: tauri::State<'_, crate::AppState>,
    id: String,
    research: serde_json::Value,
    expected_version: i64,
) -> Result<i64, String> {
    let (mut db, actor) = db_for_active_write(&state)?;
    append_context(&mut *db, &id, research, expected_version, &actor.id).map_err(board_err)
}

#[tauri::command]
pub fn board_draft_message(
    state: tauri::State<'_, crate::AppState>,
    id: String,
    msg: serde_json::Value,
) -> Result<i64, String> {
    let (mut db, actor) = db_for_active_write(&state)?;
    draft_message(&mut *db, &id, msg, &actor.id).map_err(board_err)
}

#[tauri::command]
pub fn board_attach_transcript(
    state: tauri::State<'_, crate::AppState>,
    id: String,
    raw: String,
    summary: String,
) -> Result<i64, String> {
    let (mut db, actor) = db_for_active_write(&state)?;
    attach_transcript(&mut *db, &id, &raw, &summary, &actor.id).map_err(board_err)
}

#[tauri::command]
pub fn board_rename_stage(
    state: tauri::State<'_, crate::AppState>,
    id: String,
    label: String,
) -> Result<i64, String> {
    let (mut db, actor) = db_for_active_write(&state)?;
    rename_stage(&mut *db, &id, &label, &actor.id).map_err(board_err)
}

#[tauri::command]
pub fn board_reorder_stages(state: tauri::State<'_, crate::AppState>, ids: Vec<String>) -> Result<(), String> {
    let (mut db, actor) = db_for_active_write(&state)?;
    let refs: Vec<&str> = ids.iter().map(String::as_str).collect();
    reorder_stages(&mut *db, &refs, &actor.id).map_err(board_err)
}

#[tauri::command]
pub fn board_add_stage(
    state: tauri::State<'_, crate::AppState>,
    label: String,
    position: i64,
) -> Result<String, String> {
    let (mut db, actor) = db_for_active_write(&state)?;
    add_stage(&mut *db, &label, position, &actor.id).map_err(board_err)
}

#[tauri::command]
pub fn board_retire_stage(state: tauri::State<'_, crate::AppState>, id: String) -> Result<i64, String> {
    let (mut db, actor) = db_for_active_write(&state)?;
    retire_stage(&mut *db, &id, &actor.id).map_err(board_err)
}

#[tauri::command]
pub fn board_unretire_stage(state: tauri::State<'_, crate::AppState>, id: String) -> Result<i64, String> {
    let (mut db, actor) = db_for_active_write(&state)?;
    unretire_stage(&mut *db, &id, &actor.id).map_err(board_err)
}

#[tauri::command]
pub fn board_remap_stage(
    state: tauri::State<'_, crate::AppState>,
    from: String,
    to: String,
    org_filter: Option<String>,
    dry_run: bool,
    retire_source: bool,
    confirmed: bool,
) -> Result<serde_json::Value, String> {
    let (mut db, actor) = db_for_active_write(&state)?;
    let filter = org_filter.map(|org| LeadFilter { org: Some(org) });
    let result = remap_stage(&mut *db, &from, &to, filter, dry_run, retire_source, confirmed, &actor.id).map_err(board_err)?;
    Ok(serde_json::json!({
        "affected": result.affected,
        "lead_ids": result.lead_ids,
    }))
}

pub fn list_rules_json(db: &mut Db) -> Result<serde_json::Value, String> {
    let rows = db
        .query_all("select id,name,enabled,conditions,action from rules", &[], |r| {
            Ok(serde_json::json!({
                "id": r.get_str(0)?,
                "name": r.get_str(1)?,
                "enabled": r.get_i64(2)? != 0,
                "conditions": r.get_str(3)?,
                "action": r.get_str(4)?,
            }))
        })
        .map_err(|e| format!("db error: {e}"))?;
    Ok(serde_json::Value::Array(rows))
}

#[tauri::command]
pub fn board_list_rules(state: tauri::State<'_, crate::AppState>) -> Result<serde_json::Value, String> {
    let (mut db, _actor) = db_for_active(&state)?;
    list_rules_json(&mut *db)
}

#[tauri::command]
pub fn board_revert(state: tauri::State<'_, crate::AppState>, seq: i64) -> Result<usize, String> {
    let (mut db, _actor) = db_for_active_write(&state)?;
    revert(&mut *db, seq).map_err(|e| format!("db error: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_board_sqlite_seeds_once_and_registers_actor() {
        let tmp = tempfile::TempDir::new().unwrap();
        let actor = Actor { id: "ada".into(), label: "Ada".into() };
        let mut db = open_board(tmp.path(), None, &actor).unwrap();
        // seeded 5 stages, one board_config, actor upserted
        assert_eq!(db.query_opt("select count(*) from stages", &[], |r| r.get_i64(0)).unwrap(), Some(5));
        assert_eq!(db.query_opt("select count(*) from board_config", &[], |r| r.get_i64(0)).unwrap(), Some(1));
        assert_eq!(db.query_opt("select label from actors where id=?1", &[crate::db::SqlParam::Text("ada")], |r| r.get_str(0)).unwrap(), Some("Ada".to_string()));
        // reopening does not double-seed
        drop(db);
        let mut db2 = open_board(tmp.path(), None, &actor).unwrap();
        assert_eq!(db2.query_opt("select count(*) from stages", &[], |r| r.get_i64(0)).unwrap(), Some(5));
    }

    #[test]
    fn actor_from_slugifies_name_or_defaults_local() {
        let a = actor_from(Some("Ada Lovelace"));
        assert_eq!(a.id, "ada-lovelace");
        assert_eq!(a.label, "Ada Lovelace");
        let d = actor_from(None);
        assert_eq!(d.id, "local");
        assert_eq!(d.label, "You");
        // empty / whitespace name → default, not an empty slug
        assert_eq!(actor_from(Some("   ")).id, "local");
    }

    #[test]
    fn board_err_prefixes_are_stable_and_distinguishable() {
        assert!(board_err(BoardError::VersionConflict).starts_with("conflict:"));
        assert!(board_err(BoardError::RetiredIdReuse).starts_with("retired-id-reuse:"));
        assert!(board_err(BoardError::RuleBlocked(vec!["r1".into(), "r2".into()])).starts_with("rule-blocked:"));
        assert!(board_err(BoardError::NeedsConfirm(7)).starts_with("needs-confirm:"));
        assert!(board_err(BoardError::NotFound).starts_with("not-found:"));
        assert!(board_err(BoardError::Db(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows))).starts_with("db error:"));
    }

    #[test]
    fn board_config_seeds_created_by_local() {
        let tmp = tempfile::TempDir::new().unwrap();
        let mut db = open_board(tmp.path(), None, &Actor { id: "local".into(), label: "You".into() }).unwrap();
        let created_by = q_str(&mut db, "select created_by from board_config where id = 1");
        assert_eq!(created_by, "local");
    }

    #[test]
    fn bootstrap_seeds_default_stages_and_actor() {
        let tmp = tempfile::TempDir::new().unwrap();
        let mut db = open_board(tmp.path(), None, &Actor { id: "local".into(), label: "You".into() }).unwrap();
        let n = q_i64(&mut db, "select count(*) from stages");
        assert_eq!(n, 5);
        let first = q_str(&mut db, "select id from stages order by position limit 1");
        assert_eq!(first, "researching");
        let actors = q_i64(&mut db, "select count(*) from actors");
        assert_eq!(actors, 1);
    }

    #[test]
    fn bootstrap_is_idempotent() {
        let tmp = tempfile::TempDir::new().unwrap();
        let actor = Actor { id: "local".into(), label: "You".into() };
        let db = open_board(tmp.path(), None, &actor).unwrap();
        drop(db);
        let mut db2 = open_board(tmp.path(), None, &actor).unwrap();
        let n = q_i64(&mut db2, "select count(*) from stages");
        assert_eq!(n, 5);
        let actors = q_i64(&mut db2, "select count(*) from actors");
        assert_eq!(actors, 1);
    }

    /// Build a seeded `Db` (local SQLite, actor "local") on a temp dir.
    /// Returns the `TempDir` guard alongside so the `board.db` file stays
    /// alive for the test's duration.
    fn seeded_db() -> (tempfile::TempDir, Db) {
        let tmp = tempfile::TempDir::new().unwrap();
        let db = open_board(tmp.path(), None, &Actor { id: "local".into(), label: "You".into() }).unwrap();
        (tmp, db)
    }

    fn seed_lead(db: &mut Db, id: &str, stage: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        db.exec(
            "insert into leads(id,stage,name,org,context,messages,transcripts,created_at,updated_at,version)
             values(?1,?2,?3,null,'{}','[]','[]',?4,?4,1)",
            &[SqlParam::Text(id), SqlParam::Text(stage), SqlParam::Text(id), SqlParam::Text(&now)],
        ).unwrap();
    }

    fn db_seeded_with_lead(id: &str, stage: &str) -> (tempfile::TempDir, Db) {
        let (tmp, mut db) = seeded_db();
        seed_lead(&mut db, id, stage);
        (tmp, db)
    }

    // Assertion helpers over `Db` (replacing the old `Connection::query_row`).
    fn q_str(db: &mut Db, sql: &str) -> String {
        db.query_opt(sql, &[], |r| r.get_str(0)).unwrap().unwrap()
    }
    fn q_i64(db: &mut Db, sql: &str) -> i64 {
        db.query_opt(sql, &[], |r| r.get_i64(0)).unwrap().unwrap()
    }
    fn q_opt_str(db: &mut Db, sql: &str) -> Option<String> {
        db.query_opt(sql, &[], |r| r.get_opt_str(0)).unwrap().flatten()
    }

    #[test]
    fn commit_writes_one_event_and_bumps_version() {
        let (_tmp, mut db) = seeded_db();
        seed_lead(&mut db, "L1", "researching");
        let seq = commit(&mut db, &Event {
            kind: "lead.stage".into(), entity_id: "L1".into(),
            before: serde_json::json!({"stage":"researching"}),
            after: serde_json::json!({"stage":"contacted"}),
            verb: "moveLead".into(), actor: "local".into(),
        }).unwrap();
        let stage = q_str(&mut db, "select stage from leads where id='L1'");
        let ver = q_i64(&mut db, "select version from leads where id='L1'");
        let events = q_i64(&mut db, "select count(*) from events");
        assert_eq!(stage, "contacted");
        assert_eq!(ver, 2);
        assert_eq!(events, 1);
        assert_eq!(seq, 1);
    }

    #[test]
    fn revert_restores_before_state() {
        let (_tmp, mut db) = seeded_db();
        seed_lead(&mut db, "L1", "researching");
        let base = commit(&mut db, &Event{ kind:"lead.stage".into(), entity_id:"L1".into(),
            before: serde_json::json!({"stage":"researching"}),
            after: serde_json::json!({"stage":"contacted"}),
            verb:"moveLead".into(), actor:"local".into() }).unwrap();
        commit(&mut db, &Event{ kind:"lead.stage".into(), entity_id:"L1".into(),
            before: serde_json::json!({"stage":"contacted"}),
            after: serde_json::json!({"stage":"warm"}),
            verb:"moveLead".into(), actor:"local".into() }).unwrap();
        let n = revert(&mut db, base).unwrap();
        let stage = q_str(&mut db, "select stage from leads where id='L1'");
        assert_eq!(n, 1);          // one event (the warm move) reverted
        assert_eq!(stage, "contacted"); // back to the state at `base`
        let remaining = q_i64(&mut db, "select count(*) from events");
        assert_eq!(remaining, 1);  // the base event remains
    }

    #[test]
    fn sqlite_handle_is_never_dead_so_it_stays_cached() {
        // The cache reopens a connection when `is_dead()` is true. A local SQLite
        // file handle never drops, so it must always report alive — otherwise the
        // cache would pointlessly reopen the file every command.
        let (_tmp, db) = seeded_db();
        assert!(!db.is_dead());
    }

    #[test]
    fn archive_then_unarchive_sets_and_clears_archived_at() {
        let (_tmp, mut db) = seeded_db();
        seed_lead(&mut db, "L1", "researching");
        assert_eq!(q_opt_str(&mut db, "select archived_at from leads where id='L1'"), None);

        set_lead_archived(&mut db, "L1", true, "local").unwrap();
        assert!(
            q_opt_str(&mut db, "select archived_at from leads where id='L1'").is_some(),
            "archive stamps archived_at"
        );

        set_lead_archived(&mut db, "L1", false, "local").unwrap();
        assert_eq!(
            q_opt_str(&mut db, "select archived_at from leads where id='L1'"),
            None,
            "unarchive clears archived_at"
        );
    }

    #[test]
    fn delete_lead_removes_row_and_revert_restores_it() {
        let (_tmp, mut db) = seeded_db();
        // A lead created via the real verb so it has a lead.created event before it.
        let id = add_lead(&mut db, "Acme", Some("Acme Inc"), "researching", "local").unwrap();
        let base = q_i64(&mut db, "select max(seq) from events");

        delete_lead(&mut db, &id, "local").unwrap();
        assert_eq!(
            q_i64(&mut db, "select count(*) from leads"),
            0,
            "delete removes the row"
        );

        // The event log can undo the permanent delete: reverting past the delete
        // recreates the row with its saved fields.
        revert(&mut db, base).unwrap();
        assert_eq!(q_i64(&mut db, "select count(*) from leads"), 1, "revert recreates the lead");
        assert_eq!(q_str(&mut db, "select name from leads"), "Acme");
        assert_eq!(q_opt_str(&mut db, "select org from leads"), Some("Acme Inc".into()));
    }

    #[test]
    fn delete_nonexistent_lead_is_not_found() {
        let (_tmp, mut db) = seeded_db();
        assert!(matches!(delete_lead(&mut db, "nope", "local"), Err(BoardError::NotFound)));
    }

    #[test]
    fn move_lead_detects_version_conflict() {
        let (_tmp, mut db) = db_seeded_with_lead("L1", "researching");
        let err = move_lead(&mut db, "L1", "contacted", 99, "local").unwrap_err();
        assert!(matches!(err, BoardError::VersionConflict));
        // and no write happened:
        let stage = q_str(&mut db, "select stage from leads where id='L1'");
        assert_eq!(stage, "researching");
    }

    #[test]
    fn move_lead_succeeds_on_correct_version() {
        let (_tmp, mut db) = db_seeded_with_lead("L1", "researching");
        move_lead(&mut db, "L1", "contacted", 1, "local").unwrap(); // seed_lead sets version 1
        let stage = q_str(&mut db, "select stage from leads where id='L1'");
        assert_eq!(stage, "contacted");
    }

    #[test]
    fn cannot_reuse_existing_stage_id() {
        let (_tmp, mut db) = seeded_db();
        // "researching" already exists from bootstrap; adding a stage that slugs to it must fail
        let err = add_stage(&mut db, "Researching", 9, "local").unwrap_err();
        assert!(matches!(err, BoardError::RetiredIdReuse));
    }

    #[test]
    fn add_stage_creates_new_stage_and_event() {
        let (_tmp, mut db) = seeded_db();
        let id = add_stage(&mut db, "Follow up", 5, "local").unwrap();
        assert_eq!(id, "follow-up"); // slug::slugify("Follow up") -> "follow-up"
        let n = q_i64(&mut db, "select count(*) from stages where id='follow-up'");
        assert_eq!(n, 1);
        let ev = q_i64(&mut db, "select count(*) from events where type='stage.created'");
        assert_eq!(ev, 1);
    }

    #[test]
    fn rename_stage_touches_no_cards() {
        let (_tmp, mut db) = db_seeded_with_lead("L1", "researching");
        rename_stage(&mut db, "researching", "Prospecting", "local").unwrap();
        let label = q_str(&mut db, "select label from stages where id='researching'");
        let stage = q_str(&mut db, "select stage from leads where id='L1'");
        assert_eq!(label, "Prospecting");
        assert_eq!(stage, "researching"); // id unchanged, card untouched
    }

    #[test]
    fn retire_stage_blocked_by_enabled_rule() {
        let (_tmp, mut db) = seeded_db();
        db.exec("insert into rules(id,name,enabled,conditions,action) values('r1','no_intro_path',1,?1,'propose')",
            &[SqlParam::Json(serde_json::json!({"stage":"ready_to_contact"}).to_string())]).unwrap();
        let err = retire_stage(&mut db, "ready_to_contact", "local").unwrap_err();
        match err { BoardError::RuleBlocked(names) => assert_eq!(names, vec!["no_intro_path".to_string()]), _ => panic!("expected RuleBlocked") }
        // and the stage was NOT retired:
        let retired = q_opt_str(&mut db, "select retired_at from stages where id='ready_to_contact'");
        assert!(retired.is_none());
    }

    #[test]
    fn retire_empty_stage_succeeds() {
        let (_tmp, mut db) = seeded_db();
        retire_stage(&mut db, "warm", "local").unwrap(); // no cards, no rules
        let retired = q_opt_str(&mut db, "select retired_at from stages where id='warm'");
        assert!(retired.is_some());
    }

    #[test]
    fn disabled_rule_does_not_block_retire() {
        let (_tmp, mut db) = seeded_db();
        db.exec("insert into rules(id,name,enabled,conditions,action) values('r1','off_rule',0,?1,'propose')",
            &[SqlParam::Json(serde_json::json!({"stage":"warm"}).to_string())]).unwrap();
        retire_stage(&mut db, "warm", "local").unwrap(); // rule is disabled -> no block
        let retired = q_opt_str(&mut db, "select retired_at from stages where id='warm'");
        assert!(retired.is_some());
    }

    #[test]
    fn remap_dryrun_counts_without_writing() {
        let (_tmp, mut db) = db_seeded_with_lead("L1", "contacted");
        seed_lead(&mut db, "L2", "contacted");
        let r = remap_stage(&mut db, "contacted", "warm", None, true, false, false, "local").unwrap();
        assert_eq!(r.affected, 2);
        let events = q_i64(&mut db, "select count(*) from events");
        assert_eq!(events, 0); // dryRun wrote nothing
        let still = q_i64(&mut db, "select count(*) from leads where stage='contacted'");
        assert_eq!(still, 2); // leads unchanged
    }

    #[test]
    fn remap_writes_one_event_per_lead() {
        let (_tmp, mut db) = db_seeded_with_lead("L1", "contacted");
        seed_lead(&mut db, "L2", "contacted");
        let r = remap_stage(&mut db, "contacted", "warm", None, false, false, false, "local").unwrap();
        assert_eq!(r.affected, 2);
        let events = q_i64(&mut db, "select count(*) from events");
        assert_eq!(events, 2); // one per lead, never batched
        let moved = q_i64(&mut db, "select count(*) from leads where stage='warm'");
        assert_eq!(moved, 2);
    }

    #[test]
    fn remap_over_five_needs_confirm() {
        let (_tmp, mut db) = seeded_db();
        for i in 0..6 { seed_lead(&mut db, &format!("L{i}"), "contacted"); } // 6 > 5
        let err = remap_stage(&mut db, "contacted", "warm", None, false, false, false, "local").unwrap_err();
        assert!(matches!(err, BoardError::NeedsConfirm(6)));
        let events = q_i64(&mut db, "select count(*) from events");
        assert_eq!(events, 0); // blocked, no writes
        // exactly 5 proceeds without confirm (boundary):
        let (_tmp2, mut db2) = seeded_db();
        for i in 0..5 { seed_lead(&mut db2, &format!("L{i}"), "contacted"); }
        let r = remap_stage(&mut db2, "contacted", "warm", None, false, false, false, "local").unwrap();
        assert_eq!(r.affected, 5);
        // and with confirmed=true, 6 proceeds:
        let (_tmp3, mut db3) = seeded_db();
        for i in 0..6 { seed_lead(&mut db3, &format!("L{i}"), "contacted"); }
        let r3 = remap_stage(&mut db3, "contacted", "warm", None, false, true, true, "local").unwrap();
        assert_eq!(r3.affected, 6);
    }

    #[test]
    fn remap_is_atomic_bad_target_writes_nothing() {
        let (_tmp, mut db) = seeded_db();
        for i in 0..3 { seed_lead(&mut db, &format!("L{i}"), "contacted"); }
        // remap to a NON-EXISTENT stage -> must fail cleanly with NO partial writes
        let err = remap_stage(&mut db, "contacted", "does_not_exist", None, false, false, false, "local").unwrap_err();
        assert!(matches!(err, BoardError::NotFound));
        let events = q_i64(&mut db, "select count(*) from events");
        assert_eq!(events, 0);            // nothing written
        let still = q_i64(&mut db, "select count(*) from leads where stage='contacted'");
        assert_eq!(still, 3);            // all leads still in source
    }

    #[test]
    fn remap_retire_source_sets_retired_at_never_deletes() {
        let (_tmp, mut db) = db_seeded_with_lead("L1", "contacted");
        remap_stage(&mut db, "contacted", "warm", None, false, true, false, "local").unwrap();
        let retired = q_opt_str(&mut db, "select retired_at from stages where id='contacted'");
        assert!(retired.is_some()); // retired, not deleted
        let exists = q_i64(&mut db, "select count(*) from stages where id='contacted'");
        assert_eq!(exists, 1); // row still there
    }

    #[test]
    fn append_context_merges_never_replaces() {
        let (_tmp, mut db) = db_seeded_with_lead("L1", "researching"); // seed_lead sets version 1
        append_context(&mut db, "L1", serde_json::json!({"fact":"CTO is Ana","source":"paste-1"}), 1, "local").unwrap();
        // version bumped to 2 after first append:
        append_context(&mut db, "L1", serde_json::json!({"fact":"Series B","source":"paste-2"}), 2, "local").unwrap();
        let ctx = q_str(&mut db, "select context from leads where id='L1'");
        let v: serde_json::Value = serde_json::from_str(&ctx).unwrap();
        let facts = v["facts"].as_array().unwrap();
        assert_eq!(facts.len(), 2); // BOTH preserved
        assert_eq!(facts[0]["fact"], "CTO is Ana");
        assert_eq!(facts[1]["fact"], "Series B");
    }

    #[test]
    fn append_context_version_conflict_writes_nothing() {
        let (_tmp, mut db) = db_seeded_with_lead("L1", "researching");
        let err = append_context(&mut db, "L1", serde_json::json!({"fact":"x"}), 99, "local").unwrap_err();
        assert!(matches!(err, BoardError::VersionConflict));
        let ctx = q_str(&mut db, "select context from leads where id='L1'");
        assert_eq!(ctx, "{}"); // untouched
    }

    #[test]
    fn add_lead_creates_row_and_event() {
        let (_tmp, mut db) = seeded_db();
        let id = add_lead(&mut db, "Ana Costa", Some("Acme"), "researching", "local").unwrap();
        let n = q_i64(&mut db, &format!("select count(*) from leads where id='{id}'"));
        assert_eq!(n, 1);
        let ev = q_i64(&mut db, "select count(*) from events where type='lead.created'");
        assert_eq!(ev, 1);
    }

    #[test]
    fn attach_transcript_appends() {
        let (_tmp, mut db) = db_seeded_with_lead("L1", "researching");
        attach_transcript(&mut db, "L1", "raw call text", "they want a demo", "local").unwrap();
        let t = q_str(&mut db, "select transcripts from leads where id='L1'");
        let v: serde_json::Value = serde_json::from_str(&t).unwrap();
        assert_eq!(v.as_array().unwrap().len(), 1);
        assert_eq!(v[0]["summary"], "they want a demo");
    }

    #[test]
    fn revert_restores_retired_at() {
        let (_tmp, mut db) = seeded_db();
        let before_seq = q_i64(&mut db, "select coalesce(max(seq),0) from events");
        retire_stage(&mut db, "warm", "local").unwrap();
        let retired = q_opt_str(&mut db, "select retired_at from stages where id='warm'");
        assert!(retired.is_some());
        revert(&mut db, before_seq).unwrap();
        let after = q_opt_str(&mut db, "select retired_at from stages where id='warm'");
        assert!(after.is_none(), "revert must clear retired_at"); // was the bug
    }
    #[test]
    fn revert_merge_with_retire_source_unretires_source() {
        // The exact acceptance-test path: reverting a merge-with-retireSource must un-retire the source.
        let (_tmp, mut db) = seeded_db();
        for id in ["A","B","C","D"] { seed_lead(&mut db, id, "contacted"); }
        let seq_before = q_i64(&mut db, "select coalesce(max(seq),0) from events");
        remap_stage(&mut db, "contacted", "won", None, false, true, true, "local").unwrap();
        let retired = q_opt_str(&mut db, "select retired_at from stages where id='contacted'");
        assert!(retired.is_some());
        revert(&mut db, seq_before).unwrap();
        for id in ["A","B","C","D"] {
            let s = q_str(&mut db, &format!("select stage from leads where id='{id}'"));
            assert_eq!(s, "contacted");
        }
        let after = q_opt_str(&mut db, "select retired_at from stages where id='contacted'");
        assert!(after.is_none(), "reverting the merge must un-retire the source stage");
    }
    #[test]
    fn revert_reorder_restores_positions() {
        let (_tmp, mut db) = seeded_db();
        let before_pos = q_i64(&mut db, "select position from stages where id='researching'");
        let seq_before = q_i64(&mut db, "select coalesce(max(seq),0) from events");
        reorder_stages(&mut db, &["won","warm","contacted","ready_to_contact","researching"], "local").unwrap();
        let moved = q_i64(&mut db, "select position from stages where id='researching'");
        assert_ne!(moved, before_pos);
        revert(&mut db, seq_before).unwrap();
        let restored = q_i64(&mut db, "select position from stages where id='researching'");
        assert_eq!(restored, before_pos, "revert must restore original positions");
    }
    #[test]
    fn revert_add_stage_removes_row() {
        let (_tmp, mut db) = seeded_db();
        let seq_before = q_i64(&mut db, "select coalesce(max(seq),0) from events");
        let id = add_stage(&mut db, "Temp", 9, "local").unwrap();
        assert_eq!(q_i64(&mut db, &format!("select count(*) from stages where id='{id}'")), 1);
        revert(&mut db, seq_before).unwrap();
        assert_eq!(q_i64(&mut db, &format!("select count(*) from stages where id='{id}'")), 0, "revert must remove the created stage");
    }

    #[test]
    fn revert_add_lead_removes_row() {
        let (_tmp, mut db) = seeded_db();
        let base = q_i64(&mut db, "select coalesce(max(seq),0) from events");
        let id = add_lead(&mut db, "Ada", None, "researching", "local").unwrap();
        assert_eq!(q_i64(&mut db, &format!("select count(*) from leads where id='{id}'")), 1);
        revert(&mut db, base).unwrap();
        assert_eq!(q_i64(&mut db, &format!("select count(*) from leads where id='{id}'")), 0, "revert must remove the added lead");
    }

    #[test]
    fn revert_unretire_restores_retired_at() {
        let (_tmp, mut db) = seeded_db();
        retire_stage(&mut db, "won", "local").unwrap();
        let retired_before = q_opt_str(&mut db, "select retired_at from stages where id='won'");
        assert!(retired_before.is_some(), "won should be retired");
        let base = q_i64(&mut db, "select coalesce(max(seq),0) from events");
        unretire_stage(&mut db, "won", "local").unwrap();
        let active = q_opt_str(&mut db, "select retired_at from stages where id='won'");
        assert!(active.is_none(), "unretire clears retired_at");
        revert(&mut db, base).unwrap();
        let restored = q_opt_str(&mut db, "select retired_at from stages where id='won'");
        assert!(restored.is_some(), "revert must restore retired_at → stage retired again");
    }

    #[test]
    fn acceptance_stage_lifecycle_and_revert() {
        let (_tmp, mut db) = seeded_db();

        // Create a stage, move four cards into it.
        let sid = add_stage(&mut db, "Follow up", 5, "local").unwrap();
        assert_eq!(sid, "follow-up");
        for id in ["A", "B", "C", "D"] {
            seed_lead(&mut db, id, "researching");      // seed_lead sets version 1
            move_lead(&mut db, id, &sid, 1, "local").unwrap();   // researching(v1) -> follow-up(v2)
        }

        // Rename it twice, reorder it.
        rename_stage(&mut db, &sid, "Chasing", "local").unwrap();
        rename_stage(&mut db, &sid, "Nudging", "local").unwrap();
        reorder_stages(&mut db, &["researching", "follow-up", "ready_to_contact", "contacted", "warm", "won"], "local").unwrap();

        // A rule references it — merge must be BLOCKED until remapped.
        db.exec(
            "insert into rules(id,name,enabled,conditions,action) values('r','chase_rule',1,?1,'propose')",
            &[SqlParam::Json(serde_json::json!({"stage":"follow-up"}).to_string())],
        ).unwrap();
        let blocked = remap_stage(&mut db, "follow-up", "won", None, false, true, true, "local");
        assert!(matches!(blocked, Err(BoardError::RuleBlocked(_))));

        // Remap the rule's reference away, then the merge succeeds.
        db.exec(
            "update rules set conditions=?1 where id='r'",
            &[SqlParam::Json(serde_json::json!({"stage":"won"}).to_string())],
        ).unwrap();

        // Watermark BEFORE the merge, so we can revert exactly the merge.
        let seq_before_merge = q_i64(&mut db, "select max(seq) from events");
        let r = remap_stage(&mut db, "follow-up", "won", None, false, true, true, "local").unwrap();
        assert_eq!(r.affected, 4);
        for id in ["A", "B", "C", "D"] {
            let s = q_str(&mut db, &format!("select stage from leads where id='{id}'"));
            assert_eq!(s, "won");
        }

        // revert the merge -> all four back to follow-up.
        revert(&mut db, seq_before_merge).unwrap();
        for id in ["A", "B", "C", "D"] {
            let s = q_str(&mut db, &format!("select stage from leads where id='{id}'"));
            assert_eq!(s, "follow-up");
        }
    }
}
