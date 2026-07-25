//! Per-project selection state — written by the editor so the agent
//! skill can read it on each turn and obey `insert` / `replace`
//! correctly.
//!
//! Stored at `<project>/.kinetic-studio/selection`. Either the literal
//! string `none` (no beat selected) or a single integer line — the
//! selected beat's index. Missing/unreadable file → treated as none.

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

fn selection_file(state: &AppState) -> Result<PathBuf, String> {
    let p = active_path(state)?;
    Ok(p.join(".kinetic-studio").join("selection"))
}

#[tauri::command]
pub fn set_selection(
    index: Option<i64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let file = selection_file(&state)?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("mkdir .kinetic-studio: {}", e))?;
    }
    let body = match index {
        Some(i) if i >= 0 => format!("{}\n", i),
        _ => "none\n".to_string(),
    };
    std::fs::write(&file, body).map_err(|e| format!("write selection: {}", e))
}
