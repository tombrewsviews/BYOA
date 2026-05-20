//! Per-project prompt mode.
//!
//! Determines how the agent should integrate the user's next prompt into
//! the existing story:
//!
//!   - "replace" : wipe story.beats and write a fresh sequence from the prompt.
//!   - "append"  : leave existing beats untouched, add new ones at the end.
//!   - "insert"  : insert new beats at the playhead position (placeholder —
//!                 the agent currently treats this like append, since the
//!                 playhead is a UI concept not visible to the agent yet).
//!
//! Stored in `<project>/.kinetic-studio/prompt-mode` (single line, lowercased).
//! Default is "append" if the file is missing or unreadable. The agent skill
//! reads this on each turn and obeys.

use std::path::PathBuf;

use tauri::State;

use crate::AppState;

const DEFAULT_MODE: &str = "append";

fn active_path(state: &AppState) -> Result<PathBuf, String> {
    state
        .active_project
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|p| p.path.clone())
        .ok_or_else(|| "no active project".into())
}

fn mode_file(state: &AppState) -> Result<PathBuf, String> {
    let p = active_path(state)?;
    Ok(p.join(".kinetic-studio").join("prompt-mode"))
}

#[tauri::command]
pub fn get_prompt_mode(state: State<'_, AppState>) -> Result<String, String> {
    let file = mode_file(&state)?;
    match std::fs::read_to_string(&file) {
        Ok(s) => {
            let trimmed = s.trim().to_ascii_lowercase();
            if trimmed == "replace" || trimmed == "append" || trimmed == "insert" {
                Ok(trimmed)
            } else {
                Ok(DEFAULT_MODE.into())
            }
        }
        Err(_) => Ok(DEFAULT_MODE.into()),
    }
}

/// Seed `<project>/.kinetic-studio/prompt-mode` with the default if it
/// doesn't exist yet. Called on project open so the agent's skill — which
/// reads this file FIRST on every turn — never hits a missing-file error
/// on a fresh project. (The mode is otherwise only written when the user
/// clicks a prompt-mode button.) Best-effort: a failure here is non-fatal,
/// the agent falls back to the same "append" default.
pub fn ensure_seeded(project_path: &std::path::Path) {
    let file = project_path.join(".kinetic-studio").join("prompt-mode");
    if file.exists() {
        return;
    }
    if let Some(parent) = file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&file, format!("{}\n", DEFAULT_MODE));
}

#[tauri::command]
pub fn set_prompt_mode(
    mode: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let trimmed = mode.trim().to_ascii_lowercase();
    if trimmed != "replace" && trimmed != "append" && trimmed != "insert" {
        return Err(format!(
            "invalid prompt mode '{}' (want replace|append|insert)",
            trimmed
        ));
    }
    let file = mode_file(&state)?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("mkdir .kinetic-studio: {}", e))?;
    }
    std::fs::write(&file, format!("{}\n", trimmed))
        .map_err(|e| format!("write prompt-mode: {}", e))?;
    Ok(())
}
