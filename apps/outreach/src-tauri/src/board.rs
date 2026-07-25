//! SQLite data layer for the Outreach board (`board.db`).
//!
//! Schema + default-stage bootstrap live here (Task 1.1). Later tasks add
//! commit(), revert(), and the board verbs to this same file.

use rusqlite::{Connection, OptionalExtension};

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

/// Run the schema (idempotent) and seed defaults if `stages` is empty
/// (also idempotent — safe to call more than once).
pub fn init(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch(SCHEMA)?;

    let stage_count: i64 = c.query_row("select count(*) from stages", [], |r| r.get(0))?;
    if stage_count == 0 {
        let now = chrono::Utc::now().to_rfc3339();
        c.execute_batch("begin;")?;
        let result = (|| -> rusqlite::Result<()> {
            c.execute(
                "insert into actors (id, label, created_at) values ('local', 'You', ?1)",
                [&now],
            )?;
            for (i, (id, label)) in DEFAULT_STAGES.iter().enumerate() {
                c.execute(
                    "insert into stages (id, label, position, color, created_at, created_by, version)
                     values (?1, ?2, ?3, null, ?4, 'local', 1)",
                    rusqlite::params![id, label, i as i64, &now],
                )?;
            }
            c.execute(
                "insert into board_config (id, name, created_by, version)
                 values (1, 'Outreach board', 'local', 1)",
                [],
            )?;
            Ok(())
        })();
        match result {
            Ok(()) => c.execute_batch("commit;")?,
            Err(e) => {
                c.execute_batch("rollback;")?;
                return Err(e);
            }
        }
    }

    Ok(())
}

/// Open the board.db file at `path`, enable foreign keys, run schema + bootstrap.
pub fn open(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let c = Connection::open(path)?;
    c.execute_batch("PRAGMA foreign_keys = ON;")?;
    init(&c)?;
    Ok(c)
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

/// A transaction that composes: if the connection is already inside a
/// transaction, this opens a SAVEPOINT (nestable); otherwise a plain BEGIN.
/// Must call `.commit()` on the success path — on drop without commit it
/// rolls back (a bare `ROLLBACK` when top-level, `ROLLBACK TO <savepoint>`
/// when nested).
///
/// `Connection::unchecked_transaction()` in rusqlite 0.31 always issues a
/// raw BEGIN and errors with "cannot start a transaction within a
/// transaction" if one is already open — it does NOT compose. This type
/// fills that gap using raw SAVEPOINT/RELEASE/ROLLBACK TO SQL, which is
/// SQLite's supported way to nest transactions and only needs `&Connection`
/// (rusqlite's `Savepoint` API requires `&mut Connection`, which callers
/// here don't have).
struct ComposableTx<'c> {
    conn: &'c Connection,
    name: String,
    done: bool,
}

impl<'c> ComposableTx<'c> {
    fn begin(conn: &'c Connection) -> rusqlite::Result<Self> {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        if conn.is_autocommit() {
            conn.execute_batch("begin;")?;
            Ok(Self { conn, name: String::new(), done: false })
        } else {
            let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let name = format!("board_sp_{n}");
            conn.execute_batch(&format!("savepoint {name};"))?;
            Ok(Self { conn, name, done: false })
        }
    }

    fn commit(mut self) -> rusqlite::Result<()> {
        let sql = if self.name.is_empty() {
            "commit;".to_string()
        } else {
            format!("release {};", self.name)
        };
        self.conn.execute_batch(&sql)?;
        self.done = true;
        Ok(())
    }
}

impl Drop for ComposableTx<'_> {
    fn drop(&mut self) {
        if !self.done {
            let sql = if self.name.is_empty() {
                "rollback;".to_string()
            } else {
                format!("rollback to {};", self.name)
            };
            let _ = self.conn.execute_batch(&sql);
        }
    }
}

/// Applies `value` (a before- or after-state) to the row identified by
/// (kind, entity_id). Version-bumps the row. Unlisted kinds are a no-op
/// (event-only, no row change). Shared by `commit` (applies `after`) and
/// `revert` (applies `before`) so the two stay in lockstep.
fn apply_state(
    c: &Connection,
    kind: &str,
    entity_id: &str,
    value: &serde_json::Value,
) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    match kind {
        "lead.stage" => {
            c.execute(
                "update leads set stage = ?1, updated_at = ?2, version = version + 1 where id = ?3",
                rusqlite::params![value["stage"].as_str(), &now, entity_id],
            )?;
        }
        "lead.context" => {
            c.execute(
                "update leads set context = ?1, updated_at = ?2, version = version + 1 where id = ?3",
                rusqlite::params![value.to_string(), &now, entity_id],
            )?;
        }
        "lead.messages" => {
            c.execute(
                "update leads set messages = ?1, updated_at = ?2, version = version + 1 where id = ?3",
                rusqlite::params![value.to_string(), &now, entity_id],
            )?;
        }
        "lead.transcripts" => {
            c.execute(
                "update leads set transcripts = ?1, updated_at = ?2, version = version + 1 where id = ?3",
                rusqlite::params![value.to_string(), &now, entity_id],
            )?;
        }
        "stage.renamed" => {
            c.execute(
                "update stages set label = ?1, version = version + 1 where id = ?2",
                rusqlite::params![value["label"].as_str(), entity_id],
            )?;
        }
        "stage.retired" => {
            c.execute(
                "update stages set retired_at = ?1, version = version + 1 where id = ?2",
                rusqlite::params![value["retired_at"].as_str(), entity_id],
            )?;
        }
        "stage.reordered" => {
            if let Some(positions) = value["positions"].as_object() {
                for (id, pos) in positions {
                    if let Some(pos) = pos.as_i64() {
                        c.execute(
                            "update stages set position = ?1 where id = ?2",
                            rusqlite::params![pos, id],
                        )?;
                    }
                }
            }
        }
        "stage.created" => {
            if value.is_null() {
                c.execute("delete from stages where id = ?1", [entity_id])?;
            }
        }
        _ => {
            // other kinds applied by their verbs in later tasks
        }
    }
    Ok(())
}

/// Apply `ev.after` to its target row and record the event, atomically.
/// Uses `ComposableTx`, which opens a SAVEPOINT if a transaction is already
/// active (composing with an outer transaction) or a plain BEGIN otherwise
/// (standalone use). Returns the event's `seq`.
pub fn commit(c: &Connection, ev: &Event) -> rusqlite::Result<i64> {
    let now = chrono::Utc::now().to_rfc3339();
    let tx = ComposableTx::begin(c)?;

    apply_state(c, &ev.kind, &ev.entity_id, &ev.after)?;

    c.execute(
        "insert into events(type, entity_id, before, after, verb, actor, created_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            ev.kind,
            ev.entity_id,
            ev.before.to_string(),
            ev.after.to_string(),
            ev.verb,
            ev.actor,
            &now
        ],
    )?;

    tx.commit()?;

    Ok(c.last_insert_rowid())
}

/// Undo every event after `seq`, newest-first, restoring each one's
/// `before` state. Deletes the reverted event rows. Returns the count
/// of events reverted. Atomic (single transaction).
pub fn revert(c: &Connection, seq: i64) -> rusqlite::Result<usize> {
    c.execute_batch("begin;")?;
    let result = (|| -> rusqlite::Result<usize> {
        let mut stmt = c.prepare(
            "select type, entity_id, before from events where seq > ?1 order by seq desc",
        )?;
        let rows = stmt
            .query_map([seq], |r| {
                let kind: String = r.get(0)?;
                let entity_id: String = r.get(1)?;
                let before: String = r.get(2)?;
                Ok((kind, entity_id, before))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);

        let mut count = 0usize;
        for (kind, entity_id, before) in rows {
            let before: serde_json::Value = serde_json::from_str(&before).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
            })?;
            apply_state(c, &kind, &entity_id, &before)?;
            count += 1;
        }

        c.execute("delete from events where seq > ?1", [seq])?;
        Ok(count)
    })();
    match result {
        Ok(count) => {
            c.execute_batch("commit;")?;
            Ok(count)
        }
        Err(e) => {
            c.execute_batch("rollback;")?;
            Err(e)
        }
    }
}

/// Errors shared by all board verbs.
#[derive(Debug)]
pub enum BoardError {
    VersionConflict,
    RetiredIdReuse,
    RuleBlocked(Vec<String>), // rule NAMES blocking the op
    NeedsConfirm(usize),      // affected count exceeding the blast-radius threshold
    NotFound,
    Sql(rusqlite::Error),
}

impl From<rusqlite::Error> for BoardError {
    fn from(e: rusqlite::Error) -> Self {
        BoardError::Sql(e)
    }
}

/// Move a lead to a new stage, enforcing optimistic concurrency: the caller
/// must supply the version they last read, or the write is rejected.
pub fn move_lead(
    c: &Connection,
    id: &str,
    to_stage: &str,
    expected_version: i64,
) -> Result<i64, BoardError> {
    let current: Option<(String, i64)> = c
        .query_row(
            "select stage, version from leads where id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;

    let (current_stage, version) = current.ok_or(BoardError::NotFound)?;
    if version != expected_version {
        return Err(BoardError::VersionConflict);
    }

    let seq = commit(
        c,
        &Event {
            kind: "lead.stage".into(),
            entity_id: id.into(),
            before: serde_json::json!({"stage": current_stage}),
            after: serde_json::json!({"stage": to_stage}),
            verb: "moveLead".into(),
            actor: "local".into(),
        },
    )?;
    Ok(seq)
}

/// Add a new stage, refusing to reuse the id of any existing (active or
/// retired) stage row.
pub fn add_stage(
    c: &Connection,
    label: &str,
    position: i64,
    actor: &str,
) -> Result<String, BoardError> {
    let id = slug::slugify(label);

    let existing: i64 = c.query_row("select count(*) from stages where id = ?1", [&id], |r| r.get(0))?;
    if existing > 0 {
        return Err(BoardError::RetiredIdReuse);
    }

    let now = chrono::Utc::now().to_rfc3339();
    c.execute(
        "insert into stages (id, label, position, color, retired_at, created_at, created_by, version)
         values (?1, ?2, ?3, null, null, ?4, ?5, 1)",
        rusqlite::params![id, label, position, &now, actor],
    )?;

    commit(
        c,
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
pub fn count_leads_in(c: &Connection, stage_id: &str) -> Result<usize, BoardError> {
    let n: i64 = c.query_row(
        "select count(*) from leads where stage = ?1",
        [stage_id],
        |r| r.get(0),
    )?;
    Ok(n as usize)
}

/// Names of all ENABLED rules whose `conditions` JSON references `stage_id`
/// (i.e. `conditions["stage"] == stage_id`).
pub fn rules_referencing(c: &Connection, stage_id: &str) -> Result<Vec<String>, BoardError> {
    let mut stmt = c.prepare("select name, conditions from rules where enabled = 1")?;
    let rows = stmt
        .query_map([], |r| {
            let name: String = r.get(0)?;
            let conditions: String = r.get(1)?;
            Ok((name, conditions))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);

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
pub fn rename_stage(c: &Connection, id: &str, label: &str) -> Result<i64, BoardError> {
    let current_label: Option<String> = c
        .query_row("select label from stages where id = ?1", [id], |r| r.get(0))
        .optional()?;
    let current_label = current_label.ok_or(BoardError::NotFound)?;

    let seq = commit(
        c,
        &Event {
            kind: "stage.renamed".into(),
            entity_id: id.into(),
            before: serde_json::json!({"label": current_label}),
            after: serde_json::json!({"label": label}),
            verb: "renameStage".into(),
            actor: "local".into(),
        },
    )?;
    Ok(seq)
}

/// Set each stage's `position` to its index in `ids`, atomically. Records a
/// `stage.reordered` event whose `before`/`after` carry the old/new position
/// maps, so `apply_state`'s `stage.reordered` arm can restore either side.
pub fn reorder_stages(c: &Connection, ids: &[&str]) -> Result<(), BoardError> {
    let mut stmt = c.prepare("select id, position from stages")?;
    let before_positions = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
        .collect::<rusqlite::Result<Vec<(String, i64)>>>()?;
    drop(stmt);
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
        c,
        &Event {
            kind: "stage.reordered".into(),
            entity_id: "board".into(),
            before: serde_json::json!({"positions": before_map}),
            after: serde_json::json!({"positions": after_map, "ids": ids}),
            verb: "reorderStages".into(),
            actor: "local".into(),
        },
    )?;
    Ok(())
}

/// Retire a stage: blocked if an enabled rule references it, or if more
/// than 5 leads still sit in it (large retires must route through
/// `remap_stage`, added in a later task). Otherwise sets `retired_at`.
pub fn retire_stage(c: &Connection, id: &str) -> Result<i64, BoardError> {
    let exists: i64 = c.query_row("select count(*) from stages where id = ?1", [id], |r| r.get(0))?;
    if exists == 0 {
        return Err(BoardError::NotFound);
    }

    let blocking = rules_referencing(c, id)?;
    if !blocking.is_empty() {
        return Err(BoardError::RuleBlocked(blocking));
    }

    let n = count_leads_in(c, id)?;
    if n > 5 {
        return Err(BoardError::NeedsConfirm(n));
    }

    let now = chrono::Utc::now().to_rfc3339();

    let seq = commit(
        c,
        &Event {
            kind: "stage.retired".into(),
            entity_id: id.into(),
            before: serde_json::json!({"retired_at": null}),
            after: serde_json::json!({"retired_at": now}),
            verb: "retireStage".into(),
            actor: "local".into(),
        },
    )?;
    Ok(seq)
}

/// Unretire a stage: clears `retired_at`. No gates.
pub fn unretire_stage(c: &Connection, id: &str) -> Result<i64, BoardError> {
    let exists: i64 = c.query_row("select count(*) from stages where id = ?1", [id], |r| r.get(0))?;
    if exists == 0 {
        return Err(BoardError::NotFound);
    }

    c.execute(
        "update stages set retired_at = null, version = version + 1 where id = ?1",
        [id],
    )?;

    let seq = commit(
        c,
        &Event {
            kind: "stage.unretired".into(),
            entity_id: id.into(),
            before: serde_json::Value::Null,
            after: serde_json::Value::Null,
            verb: "unretireStage".into(),
            actor: "local".into(),
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
    c: &Connection,
    from: &str,
    to: &str,
    filter: Option<LeadFilter>,
    dry_run: bool,
    retire_source: bool,
    confirmed: bool,
) -> Result<RemapResult, BoardError> {
    let blocking = rules_referencing(c, from)?;
    if !blocking.is_empty() {
        return Err(BoardError::RuleBlocked(blocking));
    }

    let to_exists: i64 = c.query_row("select count(*) from stages where id = ?1", [to], |r| r.get(0))?;
    if to_exists == 0 {
        return Err(BoardError::NotFound);
    }

    let lead_ids: Vec<String> = match &filter {
        Some(LeadFilter { org: Some(org) }) => {
            let mut stmt = c.prepare("select id from leads where stage = ?1 and org = ?2")?;
            let rows = stmt
                .query_map(rusqlite::params![from, org], |r| r.get(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        }
        _ => {
            let mut stmt = c.prepare("select id from leads where stage = ?1")?;
            let rows = stmt
                .query_map([from], |r| r.get(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        }
    };
    let affected = lead_ids.len();

    if dry_run {
        return Ok(RemapResult { affected, lead_ids });
    }

    if affected > 5 && !confirmed {
        return Err(BoardError::NeedsConfirm(affected));
    }

    // One outer transaction wraps every write below (§15.3: all-or-none).
    // Each `commit` call nests as a SAVEPOINT inside it, so a failure
    // partway through rolls back the entire remap, not just one lead.
    let tx = ComposableTx::begin(c)?;

    // The key invariant is one event row per lead — never a single batched event.
    for id in &lead_ids {
        commit(
            c,
            &Event {
                kind: "lead.stage".into(),
                entity_id: id.clone(),
                before: serde_json::json!({"stage": from}),
                after: serde_json::json!({"stage": to}),
                verb: "remapStage".into(),
                actor: "local".into(),
            },
        )?;
    }

    if retire_source {
        let now = chrono::Utc::now().to_rfc3339();
        commit(
            c,
            &Event {
                kind: "stage.retired".into(),
                entity_id: from.into(),
                before: serde_json::json!({"retired_at": null}),
                after: serde_json::json!({"retired_at": now}),
                verb: "remapStage".into(),
                actor: "local".into(),
            },
        )?;
    }

    tx.commit()?;

    Ok(RemapResult { affected, lead_ids })
}

/// Create a new lead, recording a `lead.created` event (event-only — the
/// row insert and event write happen together, atomically).
pub fn add_lead(
    c: &Connection,
    name: &str,
    org: Option<&str>,
    stage: &str,
    actor: &str,
) -> Result<String, BoardError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let tx = ComposableTx::begin(c)?;

    c.execute(
        "insert into leads (id, stage, name, org, context, messages, transcripts, created_at, updated_at, version)
         values (?1, ?2, ?3, ?4, '{}', '[]', '[]', ?5, ?5, 1)",
        rusqlite::params![id, stage, name, org, &now],
    )?;

    commit(
        c,
        &Event {
            kind: "lead.created".into(),
            entity_id: id.clone(),
            before: serde_json::Value::Null,
            after: serde_json::json!({"name": name, "org": org, "stage": stage}),
            verb: "addLead".into(),
            actor: actor.into(),
        },
    )?;

    tx.commit()?;

    Ok(id)
}

/// Append one research item to a lead's `context.facts` array — MERGE, never
/// clobber. Reads the current context, pushes `research` onto its `facts`
/// array (treating a missing/non-array `facts` as empty), and commits the
/// merged object as the new context. Enforces optimistic concurrency via
/// `expected_version`.
pub fn append_context(
    c: &Connection,
    id: &str,
    research: serde_json::Value,
    expected_version: i64,
) -> Result<i64, BoardError> {
    let current: Option<(String, i64)> = c
        .query_row(
            "select context, version from leads where id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let (context_text, version) = current.ok_or(BoardError::NotFound)?;
    if version != expected_version {
        return Err(BoardError::VersionConflict);
    }

    let before: serde_json::Value = serde_json::from_str(&context_text).map_err(|e| {
        BoardError::Sql(rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(e),
        ))
    })?;

    let mut facts = before["facts"].as_array().cloned().unwrap_or_default();
    facts.push(research);
    let after = serde_json::json!({"facts": facts});

    let seq = commit(
        c,
        &Event {
            kind: "lead.context".into(),
            entity_id: id.into(),
            before,
            after,
            verb: "appendContext".into(),
            actor: "local".into(),
        },
    )?;
    Ok(seq)
}

/// Draft a message onto a lead's `messages` array — appended, never sent.
pub fn draft_message(c: &Connection, id: &str, msg: serde_json::Value) -> Result<i64, BoardError> {
    let messages_text: Option<String> = c
        .query_row("select messages from leads where id = ?1", [id], |r| r.get(0))
        .optional()?;
    let messages_text = messages_text.ok_or(BoardError::NotFound)?;

    let before: serde_json::Value = serde_json::from_str(&messages_text).map_err(|e| {
        BoardError::Sql(rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(e),
        ))
    })?;

    let mut messages = before.as_array().cloned().unwrap_or_default();
    messages.push(msg);
    let after = serde_json::Value::Array(messages);

    let seq = commit(
        c,
        &Event {
            kind: "lead.messages".into(),
            entity_id: id.into(),
            before,
            after,
            verb: "draftMessage".into(),
            actor: "local".into(),
        },
    )?;
    Ok(seq)
}

/// Attach a call/meeting transcript to a lead's `transcripts` array.
pub fn attach_transcript(c: &Connection, id: &str, raw: &str, summary: &str) -> Result<i64, BoardError> {
    let transcripts_text: Option<String> = c
        .query_row("select transcripts from leads where id = ?1", [id], |r| r.get(0))
        .optional()?;
    let transcripts_text = transcripts_text.ok_or(BoardError::NotFound)?;

    let before: serde_json::Value = serde_json::from_str(&transcripts_text).map_err(|e| {
        BoardError::Sql(rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(e),
        ))
    })?;

    let mut transcripts = before.as_array().cloned().unwrap_or_default();
    transcripts.push(serde_json::json!({"raw": raw, "summary": summary}));
    let after = serde_json::Value::Array(transcripts);

    let seq = commit(
        c,
        &Event {
            kind: "lead.transcripts".into(),
            entity_id: id.into(),
            before,
            after,
            verb: "attachTranscript".into(),
            actor: "local".into(),
        },
    )?;
    Ok(seq)
}

// ---------------------------------------------------------------------------
// Tauri command layer — exposes the board verbs above to the frontend.
// ---------------------------------------------------------------------------

/// Open `board.db` under the active project's directory.
fn db_for_active(state: &crate::AppState) -> Result<Connection, String> {
    let dir = crate::projects::active_path(state)?;
    open(&dir.join("board.db")).map_err(|e| format!("open board.db: {e}"))
}

/// Map a `BoardError` to a frontend-facing string. Stable prefixes
/// (`conflict:`, `retired-id-reuse:`, `rule-blocked:`, `needs-confirm:`,
/// `not-found:`, `db error:`) let the frontend/MCP layer pattern-match gate
/// outcomes without parsing the whole message.
fn board_err(e: BoardError) -> String {
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
        BoardError::Sql(err) => format!("db error: {err}"),
    }
}

#[tauri::command]
pub fn board_list_stages(state: tauri::State<'_, crate::AppState>) -> Result<serde_json::Value, String> {
    let c = db_for_active(&state)?;
    let mut stmt = c
        .prepare("select id,label,position,color,retired_at,version from stages order by position")
        .map_err(|e| format!("db error: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "label": r.get::<_, String>(1)?,
                "position": r.get::<_, i64>(2)?,
                "color": r.get::<_, Option<String>>(3)?,
                "retiredAt": r.get::<_, Option<String>>(4)?,
                "version": r.get::<_, i64>(5)?,
            }))
        })
        .map_err(|e| format!("db error: {e}"))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("db error: {e}"))?;
    Ok(serde_json::Value::Array(rows))
}

#[tauri::command]
pub fn board_get_config(state: tauri::State<'_, crate::AppState>) -> Result<serde_json::Value, String> {
    let c = db_for_active(&state)?;
    let row: (String, String, i64) = c
        .query_row(
            "select name, created_by, version from board_config where id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| format!("db error: {e}"))?;
    Ok(serde_json::json!({ "name": row.0, "createdBy": row.1, "version": row.2 }))
}

#[tauri::command]
pub fn board_list_leads(state: tauri::State<'_, crate::AppState>) -> Result<serde_json::Value, String> {
    let c = db_for_active(&state)?;
    let mut stmt = c
        .prepare("select id,stage,name,org,version from leads")
        .map_err(|e| format!("db error: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "stage": r.get::<_, String>(1)?,
                "name": r.get::<_, String>(2)?,
                "org": r.get::<_, Option<String>>(3)?,
                "version": r.get::<_, i64>(4)?,
            }))
        })
        .map_err(|e| format!("db error: {e}"))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("db error: {e}"))?;
    Ok(serde_json::Value::Array(rows))
}

#[tauri::command]
pub fn board_get_lead(state: tauri::State<'_, crate::AppState>, id: String) -> Result<serde_json::Value, String> {
    let c = db_for_active(&state)?;
    let row: Option<(String, String, String, Option<String>, String, String, String, String, String, i64)> = c
        .query_row(
            "select id,stage,name,org,context,messages,transcripts,created_at,updated_at,version from leads where id = ?1",
            [&id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                ))
            },
        )
        .optional()
        .map_err(|e| format!("db error: {e}"))?;

    let (id, stage, name, org, context, messages, transcripts, created_at, updated_at, version) =
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
        "createdAt": created_at,
        "updatedAt": updated_at,
        "version": version,
    }))
}

#[tauri::command]
pub fn board_add_lead(
    state: tauri::State<'_, crate::AppState>,
    name: String,
    org: Option<String>,
    stage: String,
) -> Result<String, String> {
    let c = db_for_active(&state)?;
    add_lead(&c, &name, org.as_deref(), &stage, "local").map_err(board_err)
}

#[tauri::command]
pub fn board_move_lead(
    state: tauri::State<'_, crate::AppState>,
    id: String,
    to_stage: String,
    expected_version: i64,
) -> Result<i64, String> {
    let c = db_for_active(&state)?;
    move_lead(&c, &id, &to_stage, expected_version).map_err(board_err)
}

#[tauri::command]
pub fn board_append_context(
    state: tauri::State<'_, crate::AppState>,
    id: String,
    research: serde_json::Value,
    expected_version: i64,
) -> Result<i64, String> {
    let c = db_for_active(&state)?;
    append_context(&c, &id, research, expected_version).map_err(board_err)
}

#[tauri::command]
pub fn board_draft_message(
    state: tauri::State<'_, crate::AppState>,
    id: String,
    msg: serde_json::Value,
) -> Result<i64, String> {
    let c = db_for_active(&state)?;
    draft_message(&c, &id, msg).map_err(board_err)
}

#[tauri::command]
pub fn board_attach_transcript(
    state: tauri::State<'_, crate::AppState>,
    id: String,
    raw: String,
    summary: String,
) -> Result<i64, String> {
    let c = db_for_active(&state)?;
    attach_transcript(&c, &id, &raw, &summary).map_err(board_err)
}

#[tauri::command]
pub fn board_rename_stage(
    state: tauri::State<'_, crate::AppState>,
    id: String,
    label: String,
) -> Result<i64, String> {
    let c = db_for_active(&state)?;
    rename_stage(&c, &id, &label).map_err(board_err)
}

#[tauri::command]
pub fn board_reorder_stages(state: tauri::State<'_, crate::AppState>, ids: Vec<String>) -> Result<(), String> {
    let c = db_for_active(&state)?;
    let refs: Vec<&str> = ids.iter().map(String::as_str).collect();
    reorder_stages(&c, &refs).map_err(board_err)
}

#[tauri::command]
pub fn board_add_stage(
    state: tauri::State<'_, crate::AppState>,
    label: String,
    position: i64,
) -> Result<String, String> {
    let c = db_for_active(&state)?;
    add_stage(&c, &label, position, "local").map_err(board_err)
}

#[tauri::command]
pub fn board_retire_stage(state: tauri::State<'_, crate::AppState>, id: String) -> Result<i64, String> {
    let c = db_for_active(&state)?;
    retire_stage(&c, &id).map_err(board_err)
}

#[tauri::command]
pub fn board_unretire_stage(state: tauri::State<'_, crate::AppState>, id: String) -> Result<i64, String> {
    let c = db_for_active(&state)?;
    unretire_stage(&c, &id).map_err(board_err)
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
    let c = db_for_active(&state)?;
    let filter = org_filter.map(|org| LeadFilter { org: Some(org) });
    let result = remap_stage(&c, &from, &to, filter, dry_run, retire_source, confirmed).map_err(board_err)?;
    Ok(serde_json::json!({
        "affected": result.affected,
        "lead_ids": result.lead_ids,
    }))
}

#[tauri::command]
pub fn board_list_rules(state: tauri::State<'_, crate::AppState>) -> Result<serde_json::Value, String> {
    let c = db_for_active(&state)?;
    let mut stmt = c
        .prepare("select id,name,enabled,conditions,action from rules")
        .map_err(|e| format!("db error: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "name": r.get::<_, String>(1)?,
                "enabled": r.get::<_, i64>(2)? != 0,
                "conditions": r.get::<_, String>(3)?,
                "action": r.get::<_, String>(4)?,
            }))
        })
        .map_err(|e| format!("db error: {e}"))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("db error: {e}"))?;
    Ok(serde_json::Value::Array(rows))
}

#[tauri::command]
pub fn board_revert(state: tauri::State<'_, crate::AppState>, seq: i64) -> Result<usize, String> {
    let c = db_for_active(&state)?;
    revert(&c, seq).map_err(|e| format!("db error: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn board_err_prefixes_are_stable_and_distinguishable() {
        assert!(board_err(BoardError::VersionConflict).starts_with("conflict:"));
        assert!(board_err(BoardError::RetiredIdReuse).starts_with("retired-id-reuse:"));
        assert!(board_err(BoardError::RuleBlocked(vec!["r1".into(), "r2".into()])).starts_with("rule-blocked:"));
        assert!(board_err(BoardError::NeedsConfirm(7)).starts_with("needs-confirm:"));
        assert!(board_err(BoardError::NotFound).starts_with("not-found:"));
        assert!(board_err(BoardError::Sql(rusqlite::Error::QueryReturnedNoRows)).starts_with("db error:"));
    }

    #[test]
    fn board_config_seeds_created_by_local() {
        let c = Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        let created_by: String = c
            .query_row("select created_by from board_config where id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(created_by, "local");
    }

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

    #[test]
    fn bootstrap_is_idempotent() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        init(&c).unwrap();
        let n: i64 = c.query_row("select count(*) from stages", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 5);
        let actors: i64 = c.query_row("select count(*) from actors", [], |r| r.get(0)).unwrap();
        assert_eq!(actors, 1);
    }

    fn seed_lead(c: &rusqlite::Connection, id: &str, stage: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        c.execute(
            "insert into leads(id,stage,name,org,context,messages,transcripts,created_at,updated_at,version)
             values(?1,?2,?3,null,'{}','[]','[]',?4,?4,1)",
            rusqlite::params![id, stage, id, now],
        ).unwrap();
    }

    fn conn_seeded_with_lead(id: &str, stage: &str) -> rusqlite::Connection {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        seed_lead(&c, id, stage);
        c
    }

    #[test]
    fn commit_writes_one_event_and_bumps_version() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        seed_lead(&c, "L1", "researching");
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

    #[test]
    fn revert_restores_before_state() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        seed_lead(&c, "L1", "researching");
        let base = commit(&c, &Event{ kind:"lead.stage".into(), entity_id:"L1".into(),
            before: serde_json::json!({"stage":"researching"}),
            after: serde_json::json!({"stage":"contacted"}),
            verb:"moveLead".into(), actor:"local".into() }).unwrap();
        commit(&c, &Event{ kind:"lead.stage".into(), entity_id:"L1".into(),
            before: serde_json::json!({"stage":"contacted"}),
            after: serde_json::json!({"stage":"warm"}),
            verb:"moveLead".into(), actor:"local".into() }).unwrap();
        let n = revert(&c, base).unwrap();
        let stage: String = c.query_row("select stage from leads where id='L1'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);          // one event (the warm move) reverted
        assert_eq!(stage, "contacted"); // back to the state at `base`
        let remaining: i64 = c.query_row("select count(*) from events", [], |r| r.get(0)).unwrap();
        assert_eq!(remaining, 1);  // the base event remains
    }

    #[test]
    fn move_lead_detects_version_conflict() {
        let c = conn_seeded_with_lead("L1", "researching");
        let err = move_lead(&c, "L1", "contacted", 99).unwrap_err();
        assert!(matches!(err, BoardError::VersionConflict));
        // and no write happened:
        let stage: String = c.query_row("select stage from leads where id='L1'", [], |r| r.get(0)).unwrap();
        assert_eq!(stage, "researching");
    }

    #[test]
    fn move_lead_succeeds_on_correct_version() {
        let c = conn_seeded_with_lead("L1", "researching");
        move_lead(&c, "L1", "contacted", 1).unwrap(); // seed_lead sets version 1
        let stage: String = c.query_row("select stage from leads where id='L1'", [], |r| r.get(0)).unwrap();
        assert_eq!(stage, "contacted");
    }

    #[test]
    fn cannot_reuse_existing_stage_id() {
        let c = { let c = rusqlite::Connection::open_in_memory().unwrap(); init(&c).unwrap(); c };
        // "researching" already exists from bootstrap; adding a stage that slugs to it must fail
        let err = add_stage(&c, "Researching", 9, "local").unwrap_err();
        assert!(matches!(err, BoardError::RetiredIdReuse));
    }

    #[test]
    fn add_stage_creates_new_stage_and_event() {
        let c = { let c = rusqlite::Connection::open_in_memory().unwrap(); init(&c).unwrap(); c };
        let id = add_stage(&c, "Follow up", 5, "local").unwrap();
        assert_eq!(id, "follow-up"); // slug::slugify("Follow up") -> "follow-up"
        let n: i64 = c.query_row("select count(*) from stages where id='follow-up'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        let ev: i64 = c.query_row("select count(*) from events where type='stage.created'", [], |r| r.get(0)).unwrap();
        assert_eq!(ev, 1);
    }

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
            c.execute("insert into rules(id,name,enabled,conditions,action) values('r1','no_intro_path',1,?1,'propose')",
                [serde_json::json!({"stage":"ready_to_contact"}).to_string()]).unwrap(); c };
        let err = retire_stage(&c, "ready_to_contact").unwrap_err();
        match err { BoardError::RuleBlocked(names) => assert_eq!(names, vec!["no_intro_path".to_string()]), _ => panic!("expected RuleBlocked") }
        // and the stage was NOT retired:
        let retired: Option<String> = c.query_row("select retired_at from stages where id='ready_to_contact'", [], |r| r.get(0)).unwrap();
        assert!(retired.is_none());
    }

    #[test]
    fn retire_empty_stage_succeeds() {
        let c = { let c=rusqlite::Connection::open_in_memory().unwrap(); init(&c).unwrap(); c };
        retire_stage(&c, "warm").unwrap(); // no cards, no rules
        let retired: Option<String> = c.query_row("select retired_at from stages where id='warm'", [], |r| r.get(0)).unwrap();
        assert!(retired.is_some());
    }

    #[test]
    fn disabled_rule_does_not_block_retire() {
        let c = { let c=rusqlite::Connection::open_in_memory().unwrap(); init(&c).unwrap();
            c.execute("insert into rules(id,name,enabled,conditions,action) values('r1','off_rule',0,?1,'propose')",
                [serde_json::json!({"stage":"warm"}).to_string()]).unwrap(); c };
        retire_stage(&c, "warm").unwrap(); // rule is disabled -> no block
        let retired: Option<String> = c.query_row("select retired_at from stages where id='warm'", [], |r| r.get(0)).unwrap();
        assert!(retired.is_some());
    }

    #[test]
    fn remap_dryrun_counts_without_writing() {
        let c = conn_seeded_with_lead("L1", "contacted");
        seed_lead(&c, "L2", "contacted");
        let r = remap_stage(&c, "contacted", "warm", None, true, false, false).unwrap();
        assert_eq!(r.affected, 2);
        let events: i64 = c.query_row("select count(*) from events", [], |r| r.get(0)).unwrap();
        assert_eq!(events, 0); // dryRun wrote nothing
        let still: i64 = c.query_row("select count(*) from leads where stage='contacted'", [], |r| r.get(0)).unwrap();
        assert_eq!(still, 2); // leads unchanged
    }

    #[test]
    fn remap_writes_one_event_per_lead() {
        let c = conn_seeded_with_lead("L1", "contacted");
        seed_lead(&c, "L2", "contacted");
        let r = remap_stage(&c, "contacted", "warm", None, false, false, false).unwrap();
        assert_eq!(r.affected, 2);
        let events: i64 = c.query_row("select count(*) from events", [], |r| r.get(0)).unwrap();
        assert_eq!(events, 2); // one per lead, never batched
        let moved: i64 = c.query_row("select count(*) from leads where stage='warm'", [], |r| r.get(0)).unwrap();
        assert_eq!(moved, 2);
    }

    #[test]
    fn remap_over_five_needs_confirm() {
        let c = { let c=rusqlite::Connection::open_in_memory().unwrap(); init(&c).unwrap(); c };
        for i in 0..6 { seed_lead(&c, &format!("L{i}"), "contacted"); } // 6 > 5
        let err = remap_stage(&c, "contacted", "warm", None, false, false, false).unwrap_err();
        assert!(matches!(err, BoardError::NeedsConfirm(6)));
        let events: i64 = c.query_row("select count(*) from events", [], |r| r.get(0)).unwrap();
        assert_eq!(events, 0); // blocked, no writes
        // exactly 5 proceeds without confirm (boundary):
        let c2 = { let c=rusqlite::Connection::open_in_memory().unwrap(); init(&c).unwrap(); c };
        for i in 0..5 { seed_lead(&c2, &format!("L{i}"), "contacted"); }
        let r = remap_stage(&c2, "contacted", "warm", None, false, false, false).unwrap();
        assert_eq!(r.affected, 5);
        // and with confirmed=true, 6 proceeds:
        let c3 = { let c=rusqlite::Connection::open_in_memory().unwrap(); init(&c).unwrap(); c };
        for i in 0..6 { seed_lead(&c3, &format!("L{i}"), "contacted"); }
        let r3 = remap_stage(&c3, "contacted", "warm", None, false, true, true).unwrap();
        assert_eq!(r3.affected, 6);
    }

    #[test]
    fn remap_is_atomic_bad_target_writes_nothing() {
        let c = { let c=rusqlite::Connection::open_in_memory().unwrap(); init(&c).unwrap(); c };
        for i in 0..3 { seed_lead(&c, &format!("L{i}"), "contacted"); }
        // remap to a NON-EXISTENT stage -> must fail cleanly with NO partial writes
        let err = remap_stage(&c, "contacted", "does_not_exist", None, false, false, false).unwrap_err();
        assert!(matches!(err, BoardError::NotFound));
        let events: i64 = c.query_row("select count(*) from events", [], |r| r.get(0)).unwrap();
        assert_eq!(events, 0);            // nothing written
        let still: i64 = c.query_row("select count(*) from leads where stage='contacted'", [], |r| r.get(0)).unwrap();
        assert_eq!(still, 3);            // all leads still in source
    }

    #[test]
    fn remap_retire_source_sets_retired_at_never_deletes() {
        let c = conn_seeded_with_lead("L1", "contacted");
        remap_stage(&c, "contacted", "warm", None, false, true, false).unwrap();
        let retired: Option<String> = c.query_row("select retired_at from stages where id='contacted'", [], |r| r.get(0)).unwrap();
        assert!(retired.is_some()); // retired, not deleted
        let exists: i64 = c.query_row("select count(*) from stages where id='contacted'", [], |r| r.get(0)).unwrap();
        assert_eq!(exists, 1); // row still there
    }

    #[test]
    fn append_context_merges_never_replaces() {
        let c = conn_seeded_with_lead("L1", "researching"); // seed_lead sets version 1
        append_context(&c, "L1", serde_json::json!({"fact":"CTO is Ana","source":"paste-1"}), 1).unwrap();
        // version bumped to 2 after first append:
        append_context(&c, "L1", serde_json::json!({"fact":"Series B","source":"paste-2"}), 2).unwrap();
        let ctx: String = c.query_row("select context from leads where id='L1'", [], |r| r.get(0)).unwrap();
        let v: serde_json::Value = serde_json::from_str(&ctx).unwrap();
        let facts = v["facts"].as_array().unwrap();
        assert_eq!(facts.len(), 2); // BOTH preserved
        assert_eq!(facts[0]["fact"], "CTO is Ana");
        assert_eq!(facts[1]["fact"], "Series B");
    }

    #[test]
    fn append_context_version_conflict_writes_nothing() {
        let c = conn_seeded_with_lead("L1", "researching");
        let err = append_context(&c, "L1", serde_json::json!({"fact":"x"}), 99).unwrap_err();
        assert!(matches!(err, BoardError::VersionConflict));
        let ctx: String = c.query_row("select context from leads where id='L1'", [], |r| r.get(0)).unwrap();
        assert_eq!(ctx, "{}"); // untouched
    }

    #[test]
    fn add_lead_creates_row_and_event() {
        let c = { let c=rusqlite::Connection::open_in_memory().unwrap(); init(&c).unwrap(); c };
        let id = add_lead(&c, "Ana Costa", Some("Acme"), "researching", "local").unwrap();
        let n: i64 = c.query_row("select count(*) from leads where id=?1", [&id], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        let ev: i64 = c.query_row("select count(*) from events where type='lead.created'", [], |r| r.get(0)).unwrap();
        assert_eq!(ev, 1);
    }

    #[test]
    fn attach_transcript_appends() {
        let c = conn_seeded_with_lead("L1", "researching");
        attach_transcript(&c, "L1", "raw call text", "they want a demo").unwrap();
        let t: String = c.query_row("select transcripts from leads where id='L1'", [], |r| r.get(0)).unwrap();
        let v: serde_json::Value = serde_json::from_str(&t).unwrap();
        assert_eq!(v.as_array().unwrap().len(), 1);
        assert_eq!(v[0]["summary"], "they want a demo");
    }

    #[test]
    fn revert_restores_retired_at() {
        let c = { let c=rusqlite::Connection::open_in_memory().unwrap(); init(&c).unwrap(); c };
        let before_seq: i64 = c.query_row("select coalesce(max(seq),0) from events", [], |r| r.get(0)).unwrap();
        retire_stage(&c, "warm").unwrap();
        let retired: Option<String> = c.query_row("select retired_at from stages where id='warm'", [], |r| r.get(0)).unwrap();
        assert!(retired.is_some());
        revert(&c, before_seq).unwrap();
        let after: Option<String> = c.query_row("select retired_at from stages where id='warm'", [], |r| r.get(0)).unwrap();
        assert!(after.is_none(), "revert must clear retired_at"); // was the bug
    }
    #[test]
    fn revert_merge_with_retire_source_unretires_source() {
        // The exact acceptance-test path: reverting a merge-with-retireSource must un-retire the source.
        let c = { let c=rusqlite::Connection::open_in_memory().unwrap(); init(&c).unwrap(); c };
        for id in ["A","B","C","D"] { seed_lead(&c, id, "contacted"); }
        let seq_before: i64 = c.query_row("select coalesce(max(seq),0) from events", [], |r| r.get(0)).unwrap();
        remap_stage(&c, "contacted", "won", None, false, true, true).unwrap();
        let retired: Option<String> = c.query_row("select retired_at from stages where id='contacted'", [], |r| r.get(0)).unwrap();
        assert!(retired.is_some());
        revert(&c, seq_before).unwrap();
        for id in ["A","B","C","D"] {
            let s: String = c.query_row(&format!("select stage from leads where id='{id}'"), [], |r| r.get(0)).unwrap();
            assert_eq!(s, "contacted");
        }
        let after: Option<String> = c.query_row("select retired_at from stages where id='contacted'", [], |r| r.get(0)).unwrap();
        assert!(after.is_none(), "reverting the merge must un-retire the source stage");
    }
    #[test]
    fn revert_reorder_restores_positions() {
        let c = { let c=rusqlite::Connection::open_in_memory().unwrap(); init(&c).unwrap(); c };
        let before_pos: i64 = c.query_row("select position from stages where id='researching'", [], |r| r.get(0)).unwrap();
        let seq_before: i64 = c.query_row("select coalesce(max(seq),0) from events", [], |r| r.get(0)).unwrap();
        reorder_stages(&c, &["won","warm","contacted","ready_to_contact","researching"]).unwrap();
        let moved: i64 = c.query_row("select position from stages where id='researching'", [], |r| r.get(0)).unwrap();
        assert_ne!(moved, before_pos);
        revert(&c, seq_before).unwrap();
        let restored: i64 = c.query_row("select position from stages where id='researching'", [], |r| r.get(0)).unwrap();
        assert_eq!(restored, before_pos, "revert must restore original positions");
    }
    #[test]
    fn revert_add_stage_removes_row() {
        let c = { let c=rusqlite::Connection::open_in_memory().unwrap(); init(&c).unwrap(); c };
        let seq_before: i64 = c.query_row("select coalesce(max(seq),0) from events", [], |r| r.get(0)).unwrap();
        let id = add_stage(&c, "Temp", 9, "local").unwrap();
        assert_eq!(c.query_row::<i64,_,_>("select count(*) from stages where id=?1",[&id],|r|r.get(0)).unwrap(), 1);
        revert(&c, seq_before).unwrap();
        assert_eq!(c.query_row::<i64,_,_>("select count(*) from stages where id=?1",[&id],|r|r.get(0)).unwrap(), 0, "revert must remove the created stage");
    }

    #[test]
    fn acceptance_stage_lifecycle_and_revert() {
        let c = { let c = rusqlite::Connection::open_in_memory().unwrap(); init(&c).unwrap(); c };

        // Create a stage, move four cards into it.
        let sid = add_stage(&c, "Follow up", 5, "local").unwrap();
        assert_eq!(sid, "follow-up");
        for id in ["A", "B", "C", "D"] {
            seed_lead(&c, id, "researching");      // seed_lead sets version 1
            move_lead(&c, id, &sid, 1).unwrap();   // researching(v1) -> follow-up(v2)
        }

        // Rename it twice, reorder it.
        rename_stage(&c, &sid, "Chasing").unwrap();
        rename_stage(&c, &sid, "Nudging").unwrap();
        reorder_stages(&c, &["researching", "follow-up", "ready_to_contact", "contacted", "warm", "won"]).unwrap();

        // A rule references it — merge must be BLOCKED until remapped.
        c.execute(
            "insert into rules(id,name,enabled,conditions,action) values('r','chase_rule',1,?1,'propose')",
            [serde_json::json!({"stage":"follow-up"}).to_string()],
        ).unwrap();
        let blocked = remap_stage(&c, "follow-up", "won", None, false, true, true);
        assert!(matches!(blocked, Err(BoardError::RuleBlocked(_))));

        // Remap the rule's reference away, then the merge succeeds.
        c.execute(
            "update rules set conditions=?1 where id='r'",
            [serde_json::json!({"stage":"won"}).to_string()],
        ).unwrap();

        // Watermark BEFORE the merge, so we can revert exactly the merge.
        let seq_before_merge: i64 = c.query_row("select max(seq) from events", [], |r| r.get(0)).unwrap();
        let r = remap_stage(&c, "follow-up", "won", None, false, true, true).unwrap();
        assert_eq!(r.affected, 4);
        for id in ["A", "B", "C", "D"] {
            let s: String = c.query_row(&format!("select stage from leads where id='{id}'"), [], |r| r.get(0)).unwrap();
            assert_eq!(s, "won");
        }

        // revert the merge -> all four back to follow-up.
        revert(&c, seq_before_merge).unwrap();
        for id in ["A", "B", "C", "D"] {
            let s: String = c.query_row(&format!("select stage from leads where id='{id}'"), [], |r| r.get(0)).unwrap();
            assert_eq!(s, "follow-up");
        }
    }
}
