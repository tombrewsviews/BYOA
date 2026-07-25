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
}
