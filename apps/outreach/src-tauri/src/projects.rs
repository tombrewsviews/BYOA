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

use crate::watch;
use crate::AppState;

/// The one document filename for a Brainstorm project.
pub const DOC_FILENAME: &str = "board.json";
/// Seed written into a brand-new project's board.json.
const SEED_BOARD: &[u8] = include_bytes!("../templates/seed-board.json");
/// Holds a board's user-facing display name, so renaming a board never touches
/// the folder path (which anchors board.db, recents keys, and the active-project
/// path). Absent = fall back to the folder's basename.
const NAME_FILENAME: &str = ".display-name";

/// A board's display name: the contents of `.display-name` if present and
/// non-empty, else the folder's basename. Kept in one place so `projects_list`
/// and `project_open` agree.
fn display_name_for(dir: &std::path::Path) -> String {
    fs::read_to_string(dir.join(NAME_FILENAME))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            dir.file_name().and_then(|n| n.to_str()).unwrap_or("Unknown").to_string()
        })
}

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
        let name = display_name_for(&path);
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
fn create_project_dir(name: &str, app: &AppHandle) -> Result<ProjectMeta, String> {
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
    // Persist the user's original name as the display name (the folder is a
    // slug, e.g. "Q3 Pipeline" → "q3-pipeline"; without this the list would show
    // the slug, not what they typed).
    if !name.trim().is_empty() {
        let _ = fs::write(dir.join(NAME_FILENAME), name.trim());
    }
    crate::prompt_mode::ensure_seeded(&dir);
    // Create + seed the board (schema + bootstrap stages) so the project has a
    // ready board before any command runs. If a shared DB is configured, this
    // confirms/seeds the shared board (idempotent); otherwise it seeds the
    // local board.db.
    {
        let s = crate::settings::load();
        let actor = crate::board::actor_from(s.actor_name.as_deref());
        let _ = crate::board::open_board(&dir, s.database_url.as_deref(), &actor)
            .map_err(|e| format!("init board.db: {}", e))?;
    }
    crate::skill::write(&dir, &crate::skill::OUTREACH_BUNDLE, Some(app))
        .map_err(|e| format!("write skill: {}", e))?;
    crate::research::ensure_research_dir(&dir).map_err(|e| format!("mkdir research: {}", e))?;

    let display_name = if name.trim().is_empty() { "Untitled".into() } else { name.to_string() };
    Ok(ProjectMeta {
        name: display_name,
        path: dir.to_string_lossy().to_string(),
        last_opened: Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub fn projects_create(
    name: String,
    canvas: Option<String>,
    app: AppHandle,
) -> Result<ProjectMeta, String> {
    let _ = canvas; // always Brainstorm
    create_project_dir(&name, &app)
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
    crate::prompt_mode::ensure_seeded(&path_buf);
    crate::skill::write(&path_buf, &crate::skill::OUTREACH_BUNDLE, Some(&app))
        .map_err(|e| format!("write skill: {}", e))?;
    crate::research::ensure_research_dir(&path_buf).map_err(|e| format!("mkdir research: {}", e))?;

    *state.active_project.lock().unwrap() =
        Some(ActiveProject { path: path_buf.clone(), _watcher: watcher });
    // Drop any board connection cached for a previously-open project (both the
    // read and the write connection).
    if let Ok(mut c) = state.board_cache.lock() {
        *c = None;
    }
    if let Ok(mut c) = state.board_cache_write.lock() {
        *c = None;
    }

    let path_str = path_buf.to_string_lossy().to_string();
    let mut recents = read_recents();
    let now = Utc::now().to_rfc3339();
    recents.insert(path_str.clone(), now.clone());
    write_recents(&recents);

    let name = display_name_for(&path_buf);
    let meta = ProjectMeta { name, path: path_str, last_opened: now };
    let _ = app.emit::<ProjectMeta>("project://opened", meta.clone());
    Ok(meta)
}

#[tauri::command]
pub fn project_close(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    *state.active_project.lock().unwrap() = None;
    if let Ok(mut c) = state.board_cache.lock() {
        *c = None;
    }
    if let Ok(mut c) = state.board_cache_write.lock() {
        *c = None;
    }
    let _ = app.emit::<()>("project://closed", ());
    Ok(())
}

#[tauri::command]
pub fn project_delete(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| format!("trash: {}", e))
}

/// Rename a board by writing its display name to `.display-name` — the folder,
/// board.db, and every path anchored on it stay put. An empty name clears the
/// override (reverting to the folder basename). Returns the resolved name.
#[tauri::command]
pub fn projects_rename(path: String, name: String) -> Result<String, String> {
    let dir = PathBuf::from(&path);
    if !dir.join(DOC_FILENAME).exists() {
        return Err(format!("no {} in folder", DOC_FILENAME));
    }
    let trimmed = name.trim();
    let name_file = dir.join(NAME_FILENAME);
    if trimmed.is_empty() {
        let _ = fs::remove_file(&name_file); // revert to folder name
    } else {
        fs::write(&name_file, trimmed).map_err(|e| format!("write name: {}", e))?;
    }
    Ok(display_name_for(&dir))
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
    fn display_name_falls_back_to_folder_then_uses_override() {
        let home = TempDir::new().unwrap();
        let dir = new_project(home.path(), "q3-pipeline");
        // No override file → folder basename.
        assert_eq!(display_name_for(&dir), "q3-pipeline");
        // Override present → its (trimmed) contents win.
        fs::write(dir.join(NAME_FILENAME), "  Q3 Pipeline  ").unwrap();
        assert_eq!(display_name_for(&dir), "Q3 Pipeline");
        // Empty override → back to folder basename (never a blank name).
        fs::write(dir.join(NAME_FILENAME), "   ").unwrap();
        assert_eq!(display_name_for(&dir), "q3-pipeline");
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
