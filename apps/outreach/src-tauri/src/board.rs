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
        _ => {
            // other kinds applied by their verbs in later tasks
        }
    }
    Ok(())
}

/// Apply `ev.after` to its target row and record the event, atomically.
/// Returns the event's `seq`.
pub fn commit(c: &Connection, ev: &Event) -> rusqlite::Result<i64> {
    let now = chrono::Utc::now().to_rfc3339();
    c.execute_batch("begin;")?;
    let result = (|| -> rusqlite::Result<()> {
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
        Ok(())
    })();
    match result {
        Ok(()) => c.execute_batch("commit;")?,
        Err(e) => {
            c.execute_batch("rollback;")?;
            return Err(e);
        }
    }

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
/// single `stage.reordered` event (event-only — apply_state has no arm for it).
pub fn reorder_stages(c: &Connection, ids: &[&str]) -> Result<(), BoardError> {
    c.execute_batch("begin;")?;
    let result = (|| -> Result<(), BoardError> {
        for (i, id) in ids.iter().enumerate() {
            c.execute(
                "update stages set position = ?1 where id = ?2",
                rusqlite::params![i as i64, id],
            )?;
        }
        Ok(())
    })();
    match result {
        Ok(()) => c.execute_batch("commit;")?,
        Err(e) => {
            c.execute_batch("rollback;")?;
            return Err(e);
        }
    }

    commit(
        c,
        &Event {
            kind: "stage.reordered".into(),
            entity_id: "board".into(),
            before: serde_json::Value::Null,
            after: serde_json::json!({"ids": ids}),
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
    c.execute(
        "update stages set retired_at = ?1, version = version + 1 where id = ?2",
        rusqlite::params![&now, id],
    )?;

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
}
