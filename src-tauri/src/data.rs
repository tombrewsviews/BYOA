//! Local DuckDB engine — one in-memory connection per active project.
//!
//! Sources are registered as VIEWs over on-disk files (read_csv_auto /
//! read_parquet / read_json_auto), so "opening" a source is just a view;
//! there is no import step and nothing in the engine to persist. The
//! query.json document is the persisted artifact (handled by doc.rs).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::AppState;
use tauri::State;

/// The per-project DuckDB connection. Keyed by project path; opening a
/// different project replaces it. In-memory database.
#[derive(Default)]
pub struct DataEngine(pub Mutex<Option<(PathBuf, duckdb::Connection)>>);

#[derive(serde::Serialize, Clone)]
pub struct Column {
    pub name: String,
    pub r#type: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<Column>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
    pub truncated: bool,
}

#[derive(serde::Serialize)]
pub struct SourceSchema {
    pub id: String,
    pub columns: Vec<Column>,
}

const ROW_CAP: usize = 5_000;

/// Sanitize a file stem into a SQL identifier (letters/digits/underscore,
/// not starting with a digit). Falls back to "src" if empty.
fn sanitize_id(stem: &str) -> String {
    let mut s: String = stem
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    if s.is_empty() {
        s = "src".into();
    }
    if s.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
        s = format!("_{s}");
    }
    s
}

/// The read function for a given source kind.
fn read_fn(kind: &str) -> Result<&'static str, String> {
    match kind {
        "csv" => Ok("read_csv_auto"),
        "parquet" => Ok("read_parquet"),
        "json" => Ok("read_json_auto"),
        other => Err(format!("unknown source kind: {other}")),
    }
}

/// Ensure a connection exists for `project_path`, creating (or replacing,
/// if the path changed) an in-memory connection. Returns a locked guard.
fn with_conn<T>(
    engine: &DataEngine,
    project_path: &str,
    f: impl FnOnce(&duckdb::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = engine.0.lock().map_err(|e| e.to_string())?;
    let want = PathBuf::from(project_path);
    let need_new = match guard.as_ref() {
        Some((p, _)) => p != &want,
        None => true,
    };
    if need_new {
        let conn = duckdb::Connection::open_in_memory().map_err(|e| e.to_string())?;
        *guard = Some((want.clone(), conn));
    }
    let (_, conn) = guard.as_ref().unwrap();
    f(conn)
}

/// Resolve a possibly-relative source path against the project dir.
fn resolve_path(project_path: &str, path: &str) -> PathBuf {
    let p = Path::new(path);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        Path::new(project_path).join(p)
    }
}

/// Read the column schema of a prepared statement into Column structs.
fn columns_of(stmt: &duckdb::Statement) -> Vec<Column> {
    let names = stmt.column_names();
    (0..names.len())
        .map(|i| Column {
            name: names[i].clone(),
            r#type: stmt
                .column_type(i)
                .to_string(),
        })
        .collect()
}

#[tauri::command]
pub fn data_open_source(
    project_path: String,
    path: String,
    kind: String,
    state: State<'_, AppState>,
) -> Result<Vec<Column>, String> {
    let reader = read_fn(&kind)?;
    let abs = resolve_path(&project_path, &path);
    let abs_str = abs.to_string_lossy().replace('\'', "''");
    let stem = abs
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("src");
    let id = sanitize_id(stem);
    with_conn(&state.data_engine, &project_path, |conn| {
        conn.execute_batch(&format!(
            "CREATE OR REPLACE VIEW \"{id}\" AS SELECT * FROM {reader}('{abs_str}');"
        ))
        .map_err(|e| e.to_string())?;
        let stmt = conn
            .prepare(&format!("SELECT * FROM \"{id}\" LIMIT 0"))
            .map_err(|e| e.to_string())?;
        Ok(columns_of(&stmt))
    })
}

#[tauri::command]
pub fn data_run_sql(
    project_path: String,
    sql: String,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    with_conn(&state.data_engine, &project_path, |conn| {
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        // Collect column metadata before calling query() to avoid
        // simultaneous mutable+immutable borrows of `stmt`.
        let columns = columns_of(&stmt);
        let ncols = columns.len();
        let mut rows_iter = stmt.query([]).map_err(|e| e.to_string())?;
        let mut rows: Vec<Vec<serde_json::Value>> = Vec::new();
        let mut truncated = false;
        while let Some(row) = rows_iter.next().map_err(|e| e.to_string())? {
            if rows.len() >= ROW_CAP {
                truncated = true;
                break;
            }
            let mut out = Vec::with_capacity(ncols);
            for i in 0..ncols {
                out.push(value_to_json(row, i));
            }
            rows.push(out);
        }
        let row_count = rows.len();
        Ok(QueryResult {
            columns,
            rows,
            row_count,
            truncated,
        })
    })
}

/// Convert a DuckDB cell to JSON. Falls back to string for types we don't
/// special-case, so the grid always has something to show.
fn value_to_json(row: &duckdb::Row, i: usize) -> serde_json::Value {
    use serde_json::Value;
    if let Ok(v) = row.get::<usize, Option<i64>>(i) {
        return v.map(Value::from).unwrap_or(Value::Null);
    }
    if let Ok(v) = row.get::<usize, Option<f64>>(i) {
        return v.map(Value::from).unwrap_or(Value::Null);
    }
    if let Ok(v) = row.get::<usize, Option<bool>>(i) {
        return v.map(Value::from).unwrap_or(Value::Null);
    }
    if let Ok(v) = row.get::<usize, Option<String>>(i) {
        return v.map(Value::from).unwrap_or(Value::Null);
    }
    Value::Null
}

#[tauri::command]
pub fn data_schema(
    project_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<SourceSchema>, String> {
    with_conn(&state.data_engine, &project_path, |conn| {
        let mut stmt = conn
            .prepare("SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'")
            .map_err(|e| e.to_string())?;
        let names: Vec<String> = stmt
            .query_map([], |r| r.get::<usize, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        let mut out = Vec::new();
        for id in names {
            let cstmt = conn
                .prepare(&format!("SELECT * FROM \"{id}\" LIMIT 0"))
                .map_err(|e| e.to_string())?;
            out.push(SourceSchema {
                id,
                columns: columns_of(&cstmt),
            });
        }
        Ok(out)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn view_over_csv_counts_rows() {
        let dir = tempfile::tempdir().unwrap();
        let csv = dir.path().join("t.csv");
        std::fs::write(&csv, "a,b\n1,x\n2,y\n3,z\n").unwrap();

        let conn = duckdb::Connection::open_in_memory().unwrap();
        let abs = csv.to_string_lossy().to_string();
        conn.execute_batch(&format!(
            "CREATE OR REPLACE VIEW t AS SELECT * FROM read_csv_auto('{abs}');"
        ))
        .unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM t", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 3);
    }

    #[test]
    fn reserved_word_view_name_works() {
        let dir = tempfile::tempdir().unwrap();
        let csv = dir.path().join("order.csv");
        std::fs::write(&csv, "id,val\n1,a\n2,b\n").unwrap();

        let conn = duckdb::Connection::open_in_memory().unwrap();
        let abs = csv.to_string_lossy().to_string();
        let id = sanitize_id("order");
        conn.execute_batch(&format!(
            "CREATE OR REPLACE VIEW \"{id}\" AS SELECT * FROM read_csv_auto('{abs}');"
        ))
        .unwrap();
        let n: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM \"{id}\""), [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 2);
    }

    #[test]
    fn sanitize_id_rules() {
        assert_eq!(sanitize_id("sales-2024"), "sales_2024");
        assert_eq!(sanitize_id("2024data"), "_2024data");
        assert_eq!(sanitize_id(""), "src");
    }
}
