//! Project-document read/write commands.
//!
//! Routes through the active canvas plugin (see `canvas.rs`). The shell
//! never names the filename — it asks the canvas. v1's only canvas is
//! kinetic typography, whose document is `story.json`; future canvases
//! will declare their own filename.
//!
//! All writes are atomic (tmp + rename) so the project-folder watcher
//! sees one consistent event per save.
//!
//! `save_story` / `load_story` are kept as deprecated aliases so the
//! existing frontend keeps working during the substrate migration.

use std::path::PathBuf;
use tauri::State;

use crate::canvas;
use crate::AppState;

fn active_path(state: &AppState) -> Result<PathBuf, String> {
    state
        .active_project
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|p| p.path.clone())
        .ok_or_else(|| "no active project".into())
}

fn doc_path(state: &AppState) -> Result<PathBuf, String> {
    Ok(active_path(state)?.join(canvas::active().doc_filename()))
}

#[tauri::command]
pub fn save_doc(json: String, state: State<'_, AppState>) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| format!("invalid doc json: {}", e))?;

    let target = doc_path(&state)?;
    let tmp = target.with_extension("json.tmp");

    let body = if json.ends_with('\n') {
        json
    } else {
        format!("{}\n", json)
    };

    std::fs::write(&tmp, body.as_bytes()).map_err(|e| format!("write tmp: {}", e))?;
    std::fs::rename(&tmp, &target).map_err(|e| format!("rename: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn load_doc(state: State<'_, AppState>) -> Result<String, String> {
    std::fs::read_to_string(doc_path(&state)?).map_err(|e| format!("read: {}", e))
}