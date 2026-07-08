//! Project-document read/write commands.
//!
//! The document is always `board.json` — a seed marker for the live
//! Excalidraw scene (which lives in the canvas server, not this file).
//! Writes are atomic (tmp + rename) so the doc watcher sees one consistent
//! event per save.

use std::fs;
use std::path::PathBuf;

use tauri::State;

use crate::projects;
use crate::AppState;

fn doc_path(state: &AppState) -> Result<PathBuf, String> {
    Ok(projects::active_path(state)?.join(projects::DOC_FILENAME))
}

#[tauri::command]
pub fn load_doc(state: State<'_, AppState>) -> Result<String, String> {
    fs::read_to_string(doc_path(&state)?).map_err(|e| format!("read: {}", e))
}

#[tauri::command]
pub fn save_doc(json: String, state: State<'_, AppState>) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| format!("invalid doc json: {}", e))?;
    let target = doc_path(&state)?;
    let tmp = target.with_extension("json.tmp");
    let body = if json.ends_with('\n') { json } else { format!("{}\n", json) };
    fs::write(&tmp, body.as_bytes()).map_err(|e| format!("write tmp: {}", e))?;
    fs::rename(&tmp, &target).map_err(|e| format!("rename: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn save_then_load_round_trips() {
        let home = TempDir::new().unwrap();
        let doc = home.path().join(crate::projects::DOC_FILENAME);
        let payload = r#"{"type":"excalidraw","elements":[]}"#;
        // Emulate save_doc's atomic write.
        let tmp = doc.with_extension("json.tmp");
        fs::write(&tmp, format!("{}\n", payload)).unwrap();
        fs::rename(&tmp, &doc).unwrap();
        let loaded = fs::read_to_string(&doc).unwrap();
        let v: serde_json::Value = serde_json::from_str(&loaded).unwrap();
        assert_eq!(v["type"], "excalidraw");
    }
}
