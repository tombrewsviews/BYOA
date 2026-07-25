//! SQLite data layer for the Outreach board (`board.db`).
//!
//! Schema + default-stage bootstrap live here (Task 1.1). Later tasks add
//! commit(), revert(), and the board verbs to this same file.

use rusqlite::Connection;

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

/// Apply `ev.after` to its target row and record the event, atomically.
/// Returns the event's `seq`.
pub fn commit(c: &Connection, ev: &Event) -> rusqlite::Result<i64> {
    let now = chrono::Utc::now().to_rfc3339();
    c.execute_batch("begin;")?;
    let result = (|| -> rusqlite::Result<()> {
        match ev.kind.as_str() {
            "lead.stage" => {
                c.execute(
                    "update leads set stage = ?1, updated_at = ?2, version = version + 1 where id = ?3",
                    rusqlite::params![ev.after["stage"].as_str(), &now, ev.entity_id],
                )?;
            }
            "lead.context" => {
                c.execute(
                    "update leads set context = ?1, updated_at = ?2, version = version + 1 where id = ?3",
                    rusqlite::params![ev.after.to_string(), &now, ev.entity_id],
                )?;
            }
            "lead.messages" => {
                c.execute(
                    "update leads set messages = ?1, updated_at = ?2, version = version + 1 where id = ?3",
                    rusqlite::params![ev.after.to_string(), &now, ev.entity_id],
                )?;
            }
            "lead.transcripts" => {
                c.execute(
                    "update leads set transcripts = ?1, updated_at = ?2, version = version + 1 where id = ?3",
                    rusqlite::params![ev.after.to_string(), &now, ev.entity_id],
                )?;
            }
            "stage.renamed" => {
                c.execute(
                    "update stages set label = ?1, version = version + 1 where id = ?2",
                    rusqlite::params![ev.after["label"].as_str(), ev.entity_id],
                )?;
            }
            _ => {
                // other kinds applied by their verbs in later tasks
            }
        }

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
}
