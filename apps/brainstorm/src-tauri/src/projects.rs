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
/// The board's user-facing display name, one line of UTF-8.
///
/// Deliberately a sibling file rather than a field in `board.json`: autosave
/// rewrites board.json wholesale (`saveBoard` rebuilds the scene from scratch
/// roughly once a second during activity), so a name stored there would be
/// erased by the next save after a rename. The folder is never renamed either —
/// its path is the board's identity for recents, the watcher and `.mcp.json`.
const NAME_FILENAME: &str = "board-name.txt";
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

/// The name stored in `board-name.txt`, if a usable one is there.
fn read_display_name(dir: &std::path::Path) -> Option<String> {
    let raw = fs::read_to_string(dir.join(NAME_FILENAME)).ok()?;
    let name = raw.lines().next().unwrap_or("").trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

/// A board's display name: the stored one, else the folder name (so boards
/// created before naming existed keep showing exactly what they show today).
fn display_name(dir: &std::path::Path) -> String {
    read_display_name(dir).unwrap_or_else(|| {
        dir.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown")
            .to_string()
    })
}

fn write_display_name(dir: &std::path::Path, name: &str) -> Result<(), String> {
    fs::write(dir.join(NAME_FILENAME), name).map_err(|e| format!("write name: {}", e))
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
        let name = display_name(&path);
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

    // Persist the name as typed — the folder is a slug, which loses
    // capitalization and spacing.
    let display = if name.trim().is_empty() { "Untitled" } else { name.trim() };
    write_display_name(&dir, display)?;

    Ok(ProjectMeta {
        name: display.to_string(),
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

    let meta = ProjectMeta { name: display_name(&path_buf), path: path_str, last_opened: now };
    let _ = app.emit::<ProjectMeta>("project://opened", meta.clone());
    Ok(meta)
}

#[tauri::command]
pub fn project_close(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    *state.active_project.lock().unwrap() = None;
    let _ = app.emit::<()>("project://closed", ());
    Ok(())
}

/// Set a board's display name. Only touches `board-name.txt` — the folder is
/// not moved, so renaming can never invalidate an open board's path.
fn rename_project(path: &std::path::Path, name: &str) -> Result<ProjectMeta, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("name cannot be empty".into());
    }
    if !path.join(DOC_FILENAME).exists() {
        return Err(format!("no {} in folder", DOC_FILENAME));
    }
    write_display_name(path, name)?;

    let path_str = path.to_string_lossy().to_string();
    let last_opened = read_recents()
        .get(&path_str)
        .cloned()
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    Ok(ProjectMeta { name: name.to_string(), path: path_str, last_opened })
}

#[tauri::command]
pub fn project_rename(path: String, name: String) -> Result<ProjectMeta, String> {
    rename_project(&PathBuf::from(&path), &name)
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
    fn display_name_falls_back_to_folder_name() {
        let home = TempDir::new().unwrap();
        let dir = new_project(home.path(), "brainstorm-session-6");
        assert_eq!(read_display_name(&dir), None);
        assert_eq!(display_name(&dir), "brainstorm-session-6");
    }

    #[test]
    fn stored_display_name_wins_over_folder_name() {
        let home = TempDir::new().unwrap();
        let dir = new_project(home.path(), "brainstorm-session-6");
        write_display_name(&dir, "Payments architecture").unwrap();
        assert_eq!(display_name(&dir), "Payments architecture");
    }

    #[test]
    fn blank_name_file_falls_back_to_folder_name() {
        let home = TempDir::new().unwrap();
        let dir = new_project(home.path(), "my-board");
        fs::write(dir.join(NAME_FILENAME), "   \n").unwrap();
        assert_eq!(display_name(&dir), "my-board");
    }

    #[test]
    fn display_name_reads_only_the_first_line_trimmed() {
        let home = TempDir::new().unwrap();
        let dir = new_project(home.path(), "my-board");
        fs::write(dir.join(NAME_FILENAME), "  Sprint plan  \nignored\n").unwrap();
        assert_eq!(display_name(&dir), "Sprint plan");
    }

    #[test]
    fn rename_writes_the_name_and_keeps_the_folder_put() {
        let home = TempDir::new().unwrap();
        let dir = new_project(home.path(), "brainstorm-session-6");
        let meta = rename_project(&dir, "  Payments architecture  ").unwrap();
        assert_eq!(meta.name, "Payments architecture", "trimmed");
        assert_eq!(meta.path, dir.to_string_lossy(), "path unchanged");
        assert!(dir.exists(), "folder was not moved");
        assert_eq!(display_name(&dir), "Payments architecture");
    }

    #[test]
    fn rename_rejects_a_blank_name() {
        let home = TempDir::new().unwrap();
        let dir = new_project(home.path(), "my-board");
        assert!(rename_project(&dir, "   ").is_err());
        assert!(!dir.join(NAME_FILENAME).exists(), "nothing written");
    }

    #[test]
    fn rename_rejects_a_folder_that_is_not_a_board() {
        let home = TempDir::new().unwrap();
        let dir = home.path().join("not-a-board");
        fs::create_dir_all(&dir).unwrap();
        assert!(rename_project(&dir, "Whatever").is_err());
        assert!(!dir.join(NAME_FILENAME).exists(), "no stray name file");
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
