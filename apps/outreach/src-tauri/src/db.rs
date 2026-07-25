//! `Db` seam: a small enum wrapping the DB handle, exposing the handful of
//! primitives the board verbs need (exec/query/savepoint). Written once here
//! so `board.rs` (Phase 3) can run over either SQLite (this task) or Postgres
//! (Task 2.2) without the verb/gate logic caring which backend it's on.
//!
//! Every signature in this file is chosen so the Postgres arm can slot in
//! without changing them — see the `// Pg arm: Task 2.2` markers below.

use rusqlite::Connection;

/// A query/exec parameter, backend-agnostic. Covers every param shape
/// `board.rs` uses today: plain strings, optional strings (nullable JSON
/// fields pulled via `value["x"].as_str()`), i64 (positions/versions/seq),
/// and JSON blobs (`value.to_string()`).
pub enum SqlParam<'a> {
    Text(&'a str),
    OptText(Option<&'a str>),
    Int(i64),
    Json(String),
}

impl SqlParam<'_> {
    /// Convert to rusqlite's param type for the SQLite arm.
    fn to_rusqlite(&self) -> &dyn rusqlite::ToSql {
        match self {
            SqlParam::Text(s) => s,
            SqlParam::OptText(s) => s,
            SqlParam::Int(n) => n,
            SqlParam::Json(s) => s,
        }
    }
}

/// Row accessor the verbs' mapping closures use — implemented once per
/// backend (rusqlite here; `postgres::Row` in Task 2.2) so the closure body
/// in `board.rs` is written once and runs over either.
pub trait Row {
    fn get_str(&self, i: usize) -> Result<String, DbError>;
    fn get_i64(&self, i: usize) -> Result<i64, DbError>;
    fn get_opt_str(&self, i: usize) -> Result<Option<String>, DbError>;
}

impl Row for rusqlite::Row<'_> {
    fn get_str(&self, i: usize) -> Result<String, DbError> {
        self.get::<_, String>(i).map_err(DbError::from)
    }

    fn get_i64(&self, i: usize) -> Result<i64, DbError> {
        self.get::<_, i64>(i).map_err(DbError::from)
    }

    fn get_opt_str(&self, i: usize) -> Result<Option<String>, DbError> {
        self.get::<_, Option<String>>(i).map_err(DbError::from)
    }
}

/// Errors from either backend. `board.rs`'s `BoardError::Sql` currently
/// wraps `rusqlite::Error` directly; Phase 3 maps `DbError` into
/// `BoardError`, so this stays convertible via `From`.
#[derive(Debug)]
pub enum DbError {
    Sqlite(rusqlite::Error),
    // Pg arm: Task 2.2 adds a `Pg(postgres::Error)` variant here.
}

impl From<rusqlite::Error> for DbError {
    fn from(e: rusqlite::Error) -> Self {
        DbError::Sqlite(e)
    }
}

impl std::fmt::Display for DbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DbError::Sqlite(e) => write!(f, "sqlite error: {e}"),
        }
    }
}

impl std::error::Error for DbError {}

/// The DB handle. SQLite arm only for now (Task 2.1); Task 2.2 adds
/// `Pg(postgres::Client)`.
pub enum Db {
    Sqlite(Connection),
    // Pg arm: Task 2.2 adds `Pg(postgres::Client)` here.
}

impl Db {
    /// Open an in-memory SQLite DB. Test/dev convenience.
    pub fn sqlite_in_memory() -> Result<Self, DbError> {
        Ok(Db::Sqlite(Connection::open_in_memory()?))
    }

    /// Open (or create) a SQLite DB file at `path`.
    pub fn open_sqlite(path: &std::path::Path) -> Result<Self, DbError> {
        Ok(Db::Sqlite(Connection::open(path)?))
    }

    /// Run a statement that doesn't return rows (insert/update/delete/ddl).
    /// Returns the number of rows affected.
    pub fn exec(&mut self, sql: &str, params: &[SqlParam]) -> Result<u64, DbError> {
        match self {
            Db::Sqlite(c) => {
                let rusqlite_params: Vec<&dyn rusqlite::ToSql> =
                    params.iter().map(|p| p.to_rusqlite()).collect();
                let n = c.execute(sql, rusqlite_params.as_slice())?;
                Ok(n as u64)
            } // Pg arm: Task 2.2 — translate ?N -> $N, run via postgres::Client::execute.
        }
    }

    /// Run a query expected to return zero or one row.
    pub fn query_opt<T, F: FnMut(&dyn Row) -> Result<T, DbError>>(
        &mut self,
        sql: &str,
        params: &[SqlParam],
        mut f: F,
    ) -> Result<Option<T>, DbError> {
        match self {
            Db::Sqlite(c) => {
                let rusqlite_params: Vec<&dyn rusqlite::ToSql> =
                    params.iter().map(|p| p.to_rusqlite()).collect();
                let mut stmt = c.prepare(sql)?;
                let mut rows = stmt.query(rusqlite_params.as_slice())?;
                match rows.next()? {
                    Some(row) => {
                        let wrapped: &dyn Row = row;
                        Ok(Some(f(wrapped)?))
                    }
                    None => Ok(None),
                }
            } // Pg arm: Task 2.2 — Client::query_opt, map the returned postgres::Row through f.
        }
    }

    /// Run a query, mapping every returned row.
    pub fn query_all<T, F: FnMut(&dyn Row) -> Result<T, DbError>>(
        &mut self,
        sql: &str,
        params: &[SqlParam],
        mut f: F,
    ) -> Result<Vec<T>, DbError> {
        match self {
            Db::Sqlite(c) => {
                let rusqlite_params: Vec<&dyn rusqlite::ToSql> =
                    params.iter().map(|p| p.to_rusqlite()).collect();
                let mut stmt = c.prepare(sql)?;
                let mut rows = stmt.query(rusqlite_params.as_slice())?;
                let mut out = Vec::new();
                while let Some(row) = rows.next()? {
                    let wrapped: &dyn Row = row;
                    out.push(f(wrapped)?);
                }
                Ok(out)
            } // Pg arm: Task 2.2 — Client::query, map each postgres::Row through f.
        }
    }

    /// Open a nestable savepoint named `name`.
    pub fn savepoint(&mut self, name: &str) -> Result<(), DbError> {
        match self {
            Db::Sqlite(c) => {
                c.execute_batch(&format!("SAVEPOINT {name};"))?;
                Ok(())
            } // Pg arm: Task 2.2 — `SAVEPOINT <name>` (Postgres supports the same SQL).
        }
    }

    /// Release (commit) a savepoint named `name`.
    pub fn release(&mut self, name: &str) -> Result<(), DbError> {
        match self {
            Db::Sqlite(c) => {
                c.execute_batch(&format!("RELEASE {name};"))?;
                Ok(())
            } // Pg arm: Task 2.2 — `RELEASE SAVEPOINT <name>`.
        }
    }

    /// Roll back to a savepoint named `name` (savepoint stays open; caller
    /// must still `release` it, matching SQLite's ROLLBACK TO semantics).
    pub fn rollback_to(&mut self, name: &str) -> Result<(), DbError> {
        match self {
            Db::Sqlite(c) => {
                c.execute_batch(&format!("ROLLBACK TO {name};"))?;
                Ok(())
            } // Pg arm: Task 2.2 — `ROLLBACK TO SAVEPOINT <name>`.
        }
    }

    /// Run an INSERT and return the generated sequence/id: `last_insert_rowid()`
    /// on SQLite, `RETURNING seq` on Postgres (Task 2.2).
    pub fn commit_event_returning_seq(
        &mut self,
        insert_sql: &str,
        params: &[SqlParam],
    ) -> Result<i64, DbError> {
        match self {
            Db::Sqlite(c) => {
                let rusqlite_params: Vec<&dyn rusqlite::ToSql> =
                    params.iter().map(|p| p.to_rusqlite()).collect();
                c.execute(insert_sql, rusqlite_params.as_slice())?;
                Ok(c.last_insert_rowid())
            } // Pg arm: Task 2.2 — append `RETURNING seq`, use query_one + row.get(0).
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_exec_query_savepoint_roundtrip() {
        let mut db = Db::sqlite_in_memory().unwrap();
        db.exec("create table t (id text primary key, n int)", &[]).unwrap();
        db.exec(
            "insert into t (id,n) values (?1,?2)",
            &[SqlParam::Text("a"), SqlParam::Int(1)],
        )
        .unwrap();
        let n = db
            .query_opt("select n from t where id=?1", &[SqlParam::Text("a")], |r| {
                Ok(r.get_i64(0)?)
            })
            .unwrap();
        assert_eq!(n, Some(1));
        // savepoint rollback
        db.savepoint("sp1").unwrap();
        db.exec(
            "insert into t (id,n) values (?1,?2)",
            &[SqlParam::Text("b"), SqlParam::Int(2)],
        )
        .unwrap();
        db.rollback_to("sp1").unwrap();
        db.release("sp1").unwrap();
        let cnt =
            db.query_opt("select count(*) from t", &[], |r| Ok(r.get_i64(0)?)).unwrap();
        assert_eq!(cnt, Some(1), "rolled-back insert must be gone");
    }

    #[test]
    fn sqlite_param_placeholders_are_question_mark_style() {
        // The SQLite arm passes ?N through untouched.
        let mut db = Db::sqlite_in_memory().unwrap();
        db.exec("create table t (id text)", &[]).unwrap();
        db.exec("insert into t values (?1)", &[SqlParam::Text("x")]).unwrap();
        assert_eq!(
            db.query_opt("select id from t where id=?1", &[SqlParam::Text("x")], |r| Ok(r
                .get_str(0)?))
                .unwrap(),
            Some("x".to_string())
        );
    }
}
