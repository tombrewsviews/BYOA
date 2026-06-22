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

/// Read the column schema of an *executed* statement into Column structs.
///
/// IMPORTANT: in duckdb 1.x the statement schema is populated only after the
/// query has run; `column_names`/`column_type` panic ("Option::unwrap() on a
/// None value") on a prepared-but-unexecuted statement. Callers must execute
/// first — use `run_columns_of` for prepare+execute+read in one step.
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

/// Prepare `sql`, execute it (so the schema is populated), and return its
/// columns. The single supported way to get column metadata for a query in
/// duckdb 1.x. Use a `LIMIT 0` query when you only want the shape.
fn run_columns_of(conn: &duckdb::Connection, sql: &str) -> Vec<Column> {
    // execute() materialises the schema without us iterating rows; after it
    // returns, the statement's schema is available to columns_of.
    match run_columns_of_inner(conn, sql) {
        Ok(cols) => cols,
        Err(_) => Vec::new(),
    }
}

fn run_columns_of_inner(conn: &duckdb::Connection, sql: &str) -> Result<Vec<Column>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    stmt.execute([]).map_err(|e| e.to_string())?;
    Ok(columns_of(&stmt))
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
        Ok(run_columns_of(conn, &format!("SELECT * FROM \"{id}\" LIMIT 0")))
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
        let mut rows_iter = stmt.query([]).map_err(|e| e.to_string())?;
        // The schema is populated only after query() runs, so read the
        // columns from the now-executed statement (via the Rows handle) into
        // owned values; this releases the borrow before we iterate rows.
        let columns: Vec<Column> = rows_iter
            .as_ref()
            .map(columns_of)
            .unwrap_or_default();
        let ncols = columns.len();
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
            let columns = run_columns_of(conn, &format!("SELECT * FROM \"{id}\" LIMIT 0"));
            out.push(SourceSchema { id, columns });
        }
        Ok(out)
    })
}

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NodeResult {
    pub columns: Vec<Column>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
    pub truncated: bool,
    pub error: Option<String>,
}

/// Topologically sort node ids from a graph Value's `edges`. Err on cycle.
fn topo_order(
    nodes: &[serde_json::Value],
    edges: &[serde_json::Value],
) -> Result<Vec<String>, String> {
    use std::collections::HashMap;
    let ids: Vec<String> = nodes
        .iter()
        .filter_map(|n| n.get("id").and_then(|v| v.as_str()).map(String::from))
        .collect();
    let mut indeg: HashMap<String, usize> = ids.iter().map(|id| (id.clone(), 0)).collect();
    let edge_pairs: Vec<(String, String)> = edges
        .iter()
        .filter_map(|e| {
            Some((
                e.get("from")?.as_str()?.to_string(),
                e.get("to")?.as_str()?.to_string(),
            ))
        })
        .collect();
    for (_f, t) in &edge_pairs {
        // Only increment in-degree for known nodes; skip dangling edges.
        if let Some(e) = indeg.get_mut(t) {
            *e += 1;
        }
    }
    let mut queue: Vec<String> = ids.iter().filter(|id| indeg[*id] == 0).cloned().collect();
    let mut out = Vec::new();
    while let Some(id) = queue.pop() {
        out.push(id.clone());
        for (f, t) in &edge_pairs {
            if f == &id {
                if let Some(e) = indeg.get_mut(t) {
                    *e -= 1;
                    if *e == 0 {
                        queue.push(t.clone());
                    }
                }
                // Edges to unknown nodes (dangling) are silently ignored.
            }
        }
    }
    if out.len() != ids.len() {
        return Err("cycle detected in graph".into());
    }
    Ok(out)
}

/// Substitute {{id}} tokens with quoted view names ("id").
///
/// Walks the string char-by-char (not byte-by-byte) so multi-byte UTF-8
/// characters are preserved exactly. Only `{{ id }}` where id matches
/// `[A-Za-z0-9_]+` is substituted; any other `{{...}}` is left as-is.
fn substitute_tokens(sql: &str) -> String {
    let mut result = String::with_capacity(sql.len());
    let chars: Vec<char> = sql.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if i + 1 < chars.len() && chars[i] == '{' && chars[i + 1] == '{' {
            // Find the closing `}}` by scanning forward from position i+2.
            let rest_start = i + 2;
            let rest: String = chars[rest_start..].iter().collect();
            if let Some(close) = rest.find("}}") {
                let inner = rest[..close].trim();
                if !inner.is_empty()
                    && inner
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '_')
                {
                    result.push('"');
                    result.push_str(inner);
                    result.push('"');
                    // Advance past `{{ ... }}`: 2 open + inner chars + 2 close.
                    i = rest_start + rest[..close].chars().count() + 2;
                    continue;
                }
            }
        }
        result.push(chars[i]);
        i += 1;
    }
    result
}

/// Read columns + capped rows from a view named `view_id`.
fn read_view(
    conn: &duckdb::Connection,
    view_id: &str,
) -> Result<(Vec<Column>, Vec<Vec<serde_json::Value>>, bool), String> {
    let sql = format!("SELECT * FROM \"{view_id}\" LIMIT {}", ROW_CAP + 1);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut rows_iter = stmt.query([]).map_err(|e| e.to_string())?;
    // Schema only available after query() — read from Rows handle.
    let columns: Vec<Column> = rows_iter.as_ref().map(columns_of).unwrap_or_default();
    let ncols = columns.len();
    let mut rows = Vec::new();
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
    Ok((columns, rows, truncated))
}

/// Evaluate source + sql nodes in topo order; chart = passthrough of upstream;
/// semantic = placeholder error (Task 4 replaces).
pub fn evaluate_graph(
    conn: &duckdb::Connection,
    project_dir: &std::path::Path,
    graph: &serde_json::Value,
) -> Result<std::collections::HashMap<String, NodeResult>, String> {
    use std::collections::HashMap;
    let empty: Vec<serde_json::Value> = vec![];
    let nodes = graph
        .get("nodes")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);
    let edges = graph
        .get("edges")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);
    let order = topo_order(nodes, edges)?;
    let by_id: HashMap<String, &serde_json::Value> = nodes
        .iter()
        .filter_map(|n| Some((n.get("id")?.as_str()?.to_string(), n)))
        .collect();
    let upstream = |id: &str| -> Vec<String> {
        edges
            .iter()
            .filter_map(|e| {
                let f = e.get("from")?.as_str()?;
                let t = e.get("to")?.as_str()?;
                if t == id { Some(f.to_string()) } else { None }
            })
            .collect()
    };
    let mut out: HashMap<String, NodeResult> = HashMap::new();
    for id in &order {
        let node = match by_id.get(id) {
            Some(n) => n,
            None => continue,
        };
        let kind = node.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        let mut nr = NodeResult::default();
        let result: Result<(), String> = (|| {
            match kind {
                "source" => {
                    let src = node
                        .get("source")
                        .ok_or("source node missing source spec")?;
                    let path = src
                        .get("path")
                        .and_then(|v| v.as_str())
                        .ok_or("source missing path")?;
                    let file_kind = src
                        .get("fileKind")
                        .and_then(|v| v.as_str())
                        .unwrap_or("csv");
                    let reader = read_fn(file_kind)?;
                    let abs = resolve_path(&project_dir.to_string_lossy(), path);
                    let abs_str = abs.to_string_lossy().replace('\'', "''");
                    conn.execute_batch(&format!(
                        "CREATE OR REPLACE VIEW \"{id}\" AS SELECT * FROM {reader}('{abs_str}');"
                    ))
                    .map_err(|e| e.to_string())?;
                }
                "sql" => {
                    let raw_sql = node.get("sql").and_then(|v| v.as_str()).unwrap_or("");
                    let sub = substitute_tokens(raw_sql);
                    conn.execute_batch(&format!(
                        "CREATE OR REPLACE VIEW \"{id}\" AS {sub};"
                    ))
                    .map_err(|e| e.to_string())?;
                }
                "chart" => {
                    let ups = upstream(id);
                    if let Some(up) = ups.first() {
                        conn.execute_batch(&format!(
                            "CREATE OR REPLACE VIEW \"{id}\" AS SELECT * FROM \"{up}\";"
                        ))
                        .map_err(|e| e.to_string())?;
                    } else {
                        return Ok(()); // empty result
                    }
                }
                "semantic" => {
                    nr.error = Some("semantic not yet implemented".into());
                    return Ok(());
                }
                _ => {
                    nr.error = Some(format!("unknown node kind: {kind}"));
                    return Ok(());
                }
            }
            let (columns, rows, truncated) = read_view(conn, id)?;
            nr.row_count = rows.len();
            nr.columns = columns;
            nr.rows = rows;
            nr.truncated = truncated;
            Ok(())
        })();
        if let Err(e) = result {
            nr.error = Some(e);
        }
        out.insert(id.clone(), nr);
    }
    Ok(out)
}

#[tauri::command]
pub fn data_evaluate(
    project_path: String,
    graph_json: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let graph: serde_json::Value =
        serde_json::from_str(&graph_json).map_err(|e| format!("parse graph: {e}"))?;
    let project_dir = std::path::PathBuf::from(&project_path);
    let report = with_conn(&state.data_engine, &project_path, |conn| {
        evaluate_graph(conn, &project_dir, &graph)
    })?;
    let value = serde_json::json!({ "nodes": report });
    // Write last_result.json for the agent to perceive pipeline state.
    let meta = project_dir.join(".kinetic-studio");
    let _ = std::fs::create_dir_all(&meta);
    if let Ok(pretty) = serde_json::to_string_pretty(&value) {
        let _ = std::fs::write(meta.join("last_result.json"), pretty);
    }
    Ok(value)
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

    /// Regression: reading column metadata must work. In duckdb 1.x the
    /// statement schema is only populated after the query is executed, so
    /// `columns_of` (which calls column_names/column_type) panics with
    /// "Option::unwrap() on a None value" unless the statement has been run.
    /// This reproduces the runtime crash that escaped the original tests
    /// (which only used COUNT(*) via query_row, never columns_of).
    #[test]
    fn columns_of_returns_schema_for_query() {
        let conn = duckdb::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE t(region VARCHAR, total INTEGER); INSERT INTO t VALUES ('w', 10);",
        )
        .unwrap();
        let cols = run_columns_of(&conn, "SELECT region, total FROM t");
        assert_eq!(
            cols.iter().map(|c| c.name.clone()).collect::<Vec<_>>(),
            vec!["region".to_string(), "total".to_string()]
        );
        // Types are non-empty (exact spelling is duckdb's, we just need them).
        assert!(cols.iter().all(|c| !c.r#type.is_empty()));
    }

    /// A LIMIT 0 probe (the data_open_source / data_schema pattern) must also
    /// yield columns without panicking.
    #[test]
    fn columns_of_returns_schema_for_limit_zero_probe() {
        let conn = duckdb::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t(a INTEGER, b VARCHAR);")
            .unwrap();
        let cols = run_columns_of(&conn, "SELECT * FROM t LIMIT 0");
        assert_eq!(
            cols.iter().map(|c| c.name.clone()).collect::<Vec<_>>(),
            vec!["a".to_string(), "b".to_string()]
        );
    }

    #[test]
    fn substitute_tokens_preserves_utf8() {
        let input = "SELECT * FROM {{n1}} WHERE name = 'café'";
        let expected = "SELECT * FROM \"n1\" WHERE name = 'café'";
        assert_eq!(substitute_tokens(input), expected);
    }

    #[test]
    fn topo_order_ignores_dangling_edge() {
        let nodes = vec![serde_json::json!({"id": "a", "kind": "source"})];
        let edges = vec![serde_json::json!({"from": "a", "to": "ghost"})];
        let result = topo_order(&nodes, &edges).expect("should not panic or error");
        assert_eq!(result, vec!["a".to_string()]);
    }

    #[test]
    fn evaluate_source_then_sql_chain() {
        let dir = tempfile::tempdir().unwrap();
        let csv = dir.path().join("sales.csv");
        std::fs::write(&csv, "region,amount\nw,10\nw,5\ne,20\n").unwrap();
        let abs = csv.to_string_lossy().replace('\'', "''");

        // Build a graph: source(n1) -> sql(n2: aggregate)
        let graph = serde_json::json!({
            "version": 2,
            "nodes": [
                { "id": "n1", "kind": "source", "title": "S",
                  "source": { "path": abs, "fileKind": "csv" }, "ui": {"x":0,"y":0} },
                { "id": "n2", "kind": "sql", "title": "Agg",
                  "sql": "SELECT region, SUM(amount) AS total FROM {{n1}} GROUP BY 1 ORDER BY 1",
                  "ui": {"x":1,"y":0} }
            ],
            "edges": [ { "from": "n1", "to": "n2" } ],
            "selected": null
        });

        let conn = duckdb::Connection::open_in_memory().unwrap();
        let report = evaluate_graph(&conn, dir.path(), &graph).unwrap();
        let n2 = report.get("n2").unwrap();
        assert_eq!(n2.columns.iter().map(|c| c.name.clone()).collect::<Vec<_>>(),
            vec!["region".to_string(), "total".to_string()]);
        assert_eq!(n2.row_count, 2); // e, w
        assert!(n2.error.is_none());
    }
}
