//! story.json read/write commands. All writes are atomic (tmp + rename).
//!
//! Operates on the currently-active project. Errors if no project is
//! open.

use std::path::PathBuf;
use tauri::State;

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

#[tauri::command]
pub fn save_story(
    json: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| format!("invalid story json: {}", e))?;

    let root = active_path(&state)?;
    let target: PathBuf = root.join("story.json");
    let tmp: PathBuf = root.join("story.json.tmp");

    let body = if json.ends_with('\n') {
        json
    } else {
        format!("{}\n", json)
    };

    std::fs::write(&tmp, body.as_bytes())
        .map_err(|e| format!("write tmp: {}", e))?;
    std::fs::rename(&tmp, &target)
        .map_err(|e| format!("rename: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn load_story(state: State<'_, AppState>) -> Result<String, String> {
    let root = active_path(&state)?;
    std::fs::read_to_string(root.join("story.json"))
        .map_err(|e| format!("read: {}", e))
}
