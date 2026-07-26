//! Project lifecycle commands for standalone Brainstorm.
//!
//! Decoupled from the shell's canvas registry: the document is always
//! `board.json` (a seed marker — the live scene lives in the canvas server).
//! Multi-project model preserved: the frontend lists, creates, opens and
//! deletes boards.

use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::skill;
use crate::watch;
use crate::AppState;

/// The one document filename for a Brainstorm project.
pub const DOC_FILENAME: &str = "board.json";
/// Seed written into a brand-new project's board.json.
const SEED_BOARD: &[u8] = include_bytes!("../templates/seed-board.json");

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub name: String,
    pub path: String,
    pub last_opened: String,
}

pub struct ActiveProject {
    pub path: PathBuf,
    pub _watcher: watch::DocWatcher,
}

fn recents_path() -> PathBuf {
    crate::paths::user_path("recents.json")
}

fn read_recents() -> std::collections::HashMap<String, String> {
    fs::read_to_string(recents_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_recents(map: &std::collections::HashMap<String, String>) {
    if let Some(parent) = recents_path().parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(map) {
        let _ = fs::write(recents_path(), json);
    }
}

pub fn active_path(state: &AppState) -> Result<PathBuf, String> {
    state
        .active_project
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|p| p.path.clone())
        .ok_or_else(|| "no active project".into())
}

#[tauri::command]
pub fn projects_list(canvas: Option<String>) -> Result<Vec<ProjectMeta>, String> {
    // `canvas` is accepted for frontend compatibility (BrainstormApp passes
    // { canvas: "brainstorm" }) but every project here is a Brainstorm
    // project, so the only filter is "does the folder contain board.json".
    let _ = canvas;
    let home = crate::paths::projects_dir();
    fs::create_dir_all(&home).map_err(|e| format!("mkdir home: {}", e))?;

    let recents = read_recents();
    let mut out: Vec<ProjectMeta> = vec![];

    for entry in fs::read_dir(&home).map_err(|e| format!("readdir: {}", e))? {
        let entry = entry.map_err(|e| format!("entry: {}", e))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if !path.join(DOC_FILENAME).exists() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown")
            .to_string();
        let path_str = path.to_string_lossy().to_string();
        let last_opened = recents.get(&path_str).cloned().unwrap_or_else(|| {
            fs::metadata(&path)
                .ok()
                .and_then(|m| m.modified().ok())
                .map(|t| chrono::DateTime::<Utc>::from(t).to_rfc3339())
                .unwrap_or_else(|| Utc::now().to_rfc3339())
        });
        out.push(ProjectMeta { name, path: path_str, last_opened });
    }
    out.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    Ok(out)
}

/// Create + seed a new Brainstorm project folder.
fn create_project_dir(name: &str) -> Result<ProjectMeta, String> {
    let home = crate::paths::projects_dir();
    fs::create_dir_all(&home).map_err(|e| format!("mkdir home: {}", e))?;

    let base_slug = slug::slugify(if name.trim().is_empty() { "untitled" } else { name });
    let mut dir = home.join(&base_slug);
    let mut n = 2;
    while dir.exists() {
        dir = home.join(format!("{}-{}", base_slug, n));
        n += 1;
    }
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir project: {}", e))?;
    fs::write(dir.join(DOC_FILENAME), SEED_BOARD).map_err(|e| format!("write doc: {}", e))?;
    skill::write(&dir, &skill::BRAINSTORM_BUNDLE).map_err(|e| format!("write skill: {}", e))?;
    crate::prompt_mode::ensure_seeded(&dir);
    // NOTE: `.mcp.json` is deliberately NOT seeded here. It must point at the
    // MCP entry bundled in this .app (resolved via the Tauri AppHandle, which
    // we don't have at create time), and `brainstorm_canvas_start` writes it
    // with the resolved port every time a board opens. Seeding a guess here
    // only risks leaving a stale/wrong config in place.

    let display_name = if name.trim().is_empty() { "Untitled".into() } else { name.to_string() };
    Ok(ProjectMeta {
        name: display_name,
        path: dir.to_string_lossy().to_string(),
        last_opened: Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub fn projects_create(name: String, canvas: Option<String>) -> Result<ProjectMeta, String> {
    let _ = canvas; // always Brainstorm
    create_project_dir(&name)
}

#[tauri::command]
pub fn project_open(
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ProjectMeta, String> {
    let path_buf = PathBuf::from(&path);
    let doc = path_buf.join(DOC_FILENAME);
    if !doc.exists() {
        return Err(format!("no {} in folder", DOC_FILENAME));
    }
    fs::read_to_string(&doc).map_err(|e| format!("read doc: {}", e))?;

    let watcher = watch::spawn(doc.clone(), app.clone()).map_err(|e| format!("watcher: {}", e))?;
    skill::write(&path_buf, &skill::BRAINSTORM_BUNDLE).map_err(|e| format!("write skill: {}", e))?;
    crate::prompt_mode::ensure_seeded(&path_buf);

    *state.active_project.lock().unwrap() =
        Some(ActiveProject { path: path_buf.clone(), _watcher: watcher });

    let path_str = path_buf.to_string_lossy().to_string();
    let mut recents = read_recents();
    let now = Utc::now().to_rfc3339();
    recents.insert(path_str.clone(), now.clone());
    write_recents(&recents);

    let name = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();
    let meta = ProjectMeta { name, path: path_str, last_opened: now };
    let _ = app.emit::<ProjectMeta>("project://opened", meta.clone());
    Ok(meta)
}

#[tauri::command]
pub fn project_close(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    *state.active_project.lock().unwrap() = None;
    let _ = app.emit::<()>("project://closed", ());
    Ok(())
}

#[tauri::command]
pub fn project_delete(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| format!("trash: {}", e))
}

/// The active project's absolute path (used by secondary webviews / the
/// canvas server to locate the project the main window has open).
#[tauri::command]
pub fn active_project_path(state: State<'_, AppState>) -> Result<String, String> {
    active_path(&state).map(|p| p.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use tempfile::TempDir;

    // File-level helpers only (the #[tauri::command] wrappers need a running
    // app). Exercises seeding and the board.json project filter.

    fn new_project(home: &Path, name: &str) -> PathBuf {
        let dir = home.join(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(DOC_FILENAME), SEED_BOARD).unwrap();
        dir
    }

    #[test]
    fn seed_is_valid_excalidraw_marker() {
        let v: serde_json::Value = serde_json::from_slice(SEED_BOARD).unwrap();
        assert_eq!(v["type"], "excalidraw", "seed is an excalidraw doc");
        assert!(v.get("elements").is_some(), "seed has an elements array");
    }

    #[test]
    fn only_board_json_dirs_count_as_projects() {
        let home = TempDir::new().unwrap();
        let board = new_project(home.path(), "my-board");
        let other = home.path().join("not-a-board");
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join("story.json"), b"{}").unwrap();

        assert!(board.join(DOC_FILENAME).exists());
        assert!(!other.join(DOC_FILENAME).exists());
    }
}
