//! story.json read/write commands. All writes are atomic (tmp + rename).
//!
//! The project root is resolved once at app startup and stored in AppState
//! so commands can't be tricked into writing outside it.

use std::path::PathBuf;
use tauri::State;

use crate::AppState;

#[tauri::command]
pub fn save_story(
    json: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Validate JSON shape before touching the disk.
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| format!("invalid story json: {}", e))?;

    let target: PathBuf = state.project_root.join("story.json");
    let tmp: PathBuf = state.project_root.join("story.json.tmp");

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
    let target: PathBuf = state.project_root.join("story.json");
    std::fs::read_to_string(&target).map_err(|e| format!("read: {}", e))
}
