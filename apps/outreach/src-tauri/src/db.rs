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

    /// Convert to postgres's param type for the Pg arm.
    fn to_postgres(&self) -> &(dyn postgres::types::ToSql + Sync) {
        match self {
            SqlParam::Text(s) => s,
            SqlParam::OptText(s) => s,
            SqlParam::Int(n) => n,
            SqlParam::Json(s) => s,
        }
    }
}

/// Adapt a `&[SqlParam]` slice into the `&[&(dyn ToSql + Sync)]` shape
/// `postgres::Client`'s query methods expect.
fn to_pg_params<'a>(params: &'a [SqlParam]) -> Vec<&'a (dyn postgres::types::ToSql + Sync)> {
    params.iter().map(|p| p.to_postgres()).collect()
}

/// Translate SQLite-style `?N` placeholders to Postgres-style `$N`
/// (regex-free: scan for `?` followed by an ASCII digit run, copy the run
/// after `$`; anything else is copied verbatim).
pub fn translate_placeholders(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len());
    let mut chars = sql.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '?' && chars.peek().is_some_and(|d| d.is_ascii_digit()) {
            out.push('$');
            while let Some(d) = chars.peek() {
                if d.is_ascii_digit() {
                    out.push(*d);
                    chars.next();
                } else {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
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

impl Row for postgres::Row {
    fn get_str(&self, i: usize) -> Result<String, DbError> {
        self.try_get::<_, String>(i).map_err(DbError::from)
    }

    fn get_i64(&self, i: usize) -> Result<i64, DbError> {
        self.try_get::<_, i64>(i).map_err(DbError::from)
    }

    fn get_opt_str(&self, i: usize) -> Result<Option<String>, DbError> {
        self.try_get::<_, Option<String>>(i).map_err(DbError::from)
    }
}

/// Errors from either backend. `board.rs`'s `BoardError::Sql` currently
/// wraps `rusqlite::Error` directly; Phase 3 maps `DbError` into
/// `BoardError`, so this stays convertible via `From`.
#[derive(Debug)]
pub enum DbError {
    Sqlite(rusqlite::Error),
    Pg(postgres::Error),
    /// TLS setup failure connecting to Postgres (`connect_pg`'s one extra
    /// failure mode; native_tls::Error isn't a postgres::Error, so it can't
    /// fold into `Pg`).
    Tls(native_tls::Error),
    /// A stored JSON blob (event `before`, lead context/messages/transcripts)
    /// failed to parse — a corrupt DB-layer value, distinct from a query error.
    Json(String),
}

impl From<rusqlite::Error> for DbError {
    fn from(e: rusqlite::Error) -> Self {
        DbError::Sqlite(e)
    }
}

impl From<postgres::Error> for DbError {
    fn from(e: postgres::Error) -> Self {
        DbError::Pg(e)
    }
}

impl From<native_tls::Error> for DbError {
    fn from(e: native_tls::Error) -> Self {
        DbError::Tls(e)
    }
}

impl std::fmt::Display for DbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DbError::Sqlite(e) => write!(f, "sqlite error: {e}"),
            DbError::Pg(e) => write!(f, "postgres error: {e}"),
            DbError::Tls(e) => write!(f, "tls error: {e}"),
            DbError::Json(e) => write!(f, "json error: {e}"),
        }
    }
}

impl std::error::Error for DbError {}

/// The DB handle. SQLite arm (Task 2.1) plus the Postgres arm (Task 2.2).
//
// NOTE (Task 2.3): Postgres DDL must declare every integer column as
// `bigint` so `Row::get_i64` (which reads i64) works uniformly — esp.
// events.seq (identity) and all `version` columns.
pub enum Db {
    Sqlite(Connection),
    Pg { client: postgres::Client, tx_depth: u32 },
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

    /// Connect to a Postgres database (Neon requires TLS, `sslmode=require`).
    ///
    /// A 10s connect timeout is set so an unreachable or slow database fails
    /// with a clear error instead of hanging the caller indefinitely — the
    /// board-open path is user-facing (the app blocks on it), so a dead DB
    /// must never freeze the app.
    pub fn connect_pg(url: &str) -> Result<Self, DbError> {
        let connector = native_tls::TlsConnector::new()?;
        let connector = postgres_native_tls::MakeTlsConnector::new(connector);
        let mut config: postgres::Config = url.parse()?;
        config.connect_timeout(std::time::Duration::from_secs(10));
        let client = config.connect(connector)?;
        Ok(Db::Pg { client, tx_depth: 0 })
    }

    /// Is this handle known to be unusable? For Postgres, true once the client's
    /// connection has dropped (non-blocking check — no round-trip). SQLite is a
    /// local file handle that doesn't drop, so always false. Used to evict a dead
    /// cached connection so the next command reconnects instead of erroring.
    pub fn is_dead(&self) -> bool {
        match self {
            Db::Sqlite(_) => false,
            Db::Pg { client, .. } => client.is_closed(),
        }
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
            }
            Db::Pg { client, .. } => {
                let n = client.execute(&translate_placeholders(sql), &to_pg_params(params))?;
                Ok(n)
            }
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
            }
            Db::Pg { client, .. } => {
                match client.query_opt(&translate_placeholders(sql), &to_pg_params(params))? {
                    Some(row) => {
                        let wrapped: &dyn Row = &row;
                        Ok(Some(f(wrapped)?))
                    }
                    None => Ok(None),
                }
            }
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
            }
            Db::Pg { client, .. } => {
                let rows = client.query(&translate_placeholders(sql), &to_pg_params(params))?;
                let mut out = Vec::new();
                for row in &rows {
                    let wrapped: &dyn Row = row;
                    out.push(f(wrapped)?);
                }
                Ok(out)
            }
        }
    }

    /// Open a nestable savepoint named `name`.
    pub fn savepoint(&mut self, name: &str) -> Result<(), DbError> {
        match self {
            Db::Sqlite(c) => {
                c.execute_batch(&format!("SAVEPOINT {name};"))?;
                Ok(())
            }
            Db::Pg { client, tx_depth } => {
                if *tx_depth == 0 {
                    client.batch_execute("BEGIN")?;
                }
                client.batch_execute(&format!("SAVEPOINT {name}"))?;
                *tx_depth += 1;
                Ok(())
            }
        }
    }

    /// Release (commit) a savepoint named `name`.
    pub fn release(&mut self, name: &str) -> Result<(), DbError> {
        match self {
            Db::Sqlite(c) => {
                c.execute_batch(&format!("RELEASE {name};"))?;
                Ok(())
            }
            Db::Pg { client, tx_depth } => {
                client.batch_execute(&format!("RELEASE SAVEPOINT {name}"))?;
                *tx_depth -= 1;
                if *tx_depth == 0 {
                    client.batch_execute("COMMIT")?;
                }
                Ok(())
            }
        }
    }

    /// Roll back to a savepoint named `name` (savepoint stays open; caller
    /// must still `release` it, matching SQLite's ROLLBACK TO semantics).
    pub fn rollback_to(&mut self, name: &str) -> Result<(), DbError> {
        match self {
            Db::Sqlite(c) => {
                c.execute_batch(&format!("ROLLBACK TO {name};"))?;
                Ok(())
            }
            Db::Pg { client, tx_depth: _ } => {
                client.batch_execute(&format!("ROLLBACK TO SAVEPOINT {name}"))?;
                Ok(())
            }
        }
    }

    /// Run a multi-statement SQL string. SQLite arm uses `execute_batch`
    /// directly (its native multi-statement form). Postgres has no
    /// single-call batch API here, so the Pg arm splits on `;` and execs
    /// each non-empty statement individually.
    pub fn exec_batch(&mut self, sql: &str) -> Result<(), DbError> {
        match self {
            Db::Sqlite(c) => {
                c.execute_batch(sql)?;
                Ok(())
            }
            Db::Pg { client, .. } => {
                for stmt in sql.split(';') {
                    let stmt = stmt.trim();
                    if !stmt.is_empty() {
                        client.batch_execute(stmt)?;
                    }
                }
                Ok(())
            }
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
            }
            Db::Pg { client, .. } => {
                let sql = format!("{} returning seq", translate_placeholders(insert_sql));
                let row = client.query_one(&sql, &to_pg_params(params))?;
                Ok(row.get::<_, i64>(0))
            }
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
    fn translate_placeholders_qmark_to_dollar() {
        assert_eq!(
            translate_placeholders("select * from t where a=?1 and b=?2"),
            "select * from t where a=$1 and b=$2"
        );
        assert_eq!(
            translate_placeholders("insert into t values (?1,?2,?3)"),
            "insert into t values ($1,$2,$3)"
        );
        // ?10 must not be mangled into ?1 + 0
        assert_eq!(translate_placeholders("x=?10"), "x=$10");
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
