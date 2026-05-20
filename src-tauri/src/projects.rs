//! Project lifecycle commands.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::canvas;
use crate::watch;
use crate::AppState;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub name: String,
    pub path: String,
    pub beats: usize,
    pub last_opened: String,
    /// Absolute path to the cached preview MP4, or None if the project
    /// has never been rendered. The frontend feeds this to
    /// `convertFileSrc` to get an `asset://` URL it can render.
    pub preview_path: Option<String>,
    /// True if `story.json` has been modified since the preview was
    /// rendered. The card shows a small dot when true.
    pub preview_stale: bool,
}

pub struct ActiveProject {
    pub path: PathBuf,
    pub _watcher: watch::DocWatcher,
}

fn home_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join("KineticStudio"))
        .unwrap_or_else(|| PathBuf::from(".").join("KineticStudio"))
}

fn recents_path() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".kinetic-studio").join("recents.json"))
        .unwrap_or_else(|| PathBuf::from(".kinetic-studio/recents.json"))
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

/// Build preview metadata for a project: returns (path_if_exists,
/// stale). Stale = the canvas doc's mtime is newer than the preview's
/// mtime (or preview doesn't exist at all but the doc does).
fn preview_meta(project_dir: &Path) -> (Option<String>, bool) {
    let preview = project_dir.join(".kinetic-studio").join("preview.mp4");
    let doc = project_dir.join(canvas::active().doc_filename());
    let preview_mtime = fs::metadata(&preview).ok().and_then(|m| m.modified().ok());
    let doc_mtime = fs::metadata(&doc).ok().and_then(|m| m.modified().ok());
    match (preview_mtime, doc_mtime) {
        (Some(pm), Some(sm)) => {
            let path = preview.to_string_lossy().to_string();
            (Some(path), sm > pm)
        }
        (Some(_), None) => {
            let path = preview.to_string_lossy().to_string();
            (Some(path), false)
        }
        (None, _) => (None, true),
    }
}

#[tauri::command]
pub fn projects_list() -> Result<Vec<ProjectMeta>, String> {
    let home = home_dir();
    fs::create_dir_all(&home).map_err(|e| format!("mkdir home: {}", e))?;

    let recents = read_recents();
    let mut out: Vec<ProjectMeta> = vec![];

    let canvas = canvas::active();
    for entry in fs::read_dir(&home).map_err(|e| format!("readdir: {}", e))? {
        let entry = entry.map_err(|e| format!("entry: {}", e))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let doc = path.join(canvas.doc_filename());
        if !doc.exists() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown")
            .to_string();
        let path_str = path.to_string_lossy().to_string();
        let last_opened = recents
            .get(&path_str)
            .cloned()
            .unwrap_or_else(|| {
                fs::metadata(&path)
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .map(|t| chrono::DateTime::<Utc>::from(t).to_rfc3339())
                    .unwrap_or_else(|| Utc::now().to_rfc3339())
            });
        let (preview_path, preview_stale) = preview_meta(&path);
        out.push(ProjectMeta {
            name,
            path: path_str,
            beats: canvas.summarise(&path).count,
            last_opened,
            preview_path,
            preview_stale,
        });
    }
    out.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    Ok(out)
}

#[tauri::command]
pub fn projects_create(name: String) -> Result<ProjectMeta, String> {
    let home = home_dir();
    fs::create_dir_all(&home).map_err(|e| format!("mkdir home: {}", e))?;

    let base_slug = slug::slugify(if name.trim().is_empty() {
        "untitled"
    } else {
        &name
    });
    let mut dir = home.join(&base_slug);
    let mut n = 2;
    while dir.exists() {
        dir = home.join(format!("{}-{}", base_slug, n));
        n += 1;
    }
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir project: {}", e))?;
    let canvas = canvas::active();
    fs::write(dir.join(canvas.doc_filename()), canvas.seed_bytes())
        .map_err(|e| format!("write doc: {}", e))?;
    fs::create_dir_all(dir.join(".kinetic-studio"))
        .map_err(|e| format!("mkdir meta: {}", e))?;
    crate::skill::write(&dir, canvas.skill_bundle())
        .map_err(|e| format!("write skill: {}", e))?;
    crate::prompt_mode::ensure_seeded(&dir);

    let display_name = if name.trim().is_empty() {
        "Untitled".into()
    } else {
        name
    };

    let path_str = dir.to_string_lossy().to_string();

    let (preview_path, preview_stale) = preview_meta(&dir);
    Ok(ProjectMeta {
        name: display_name,
        path: path_str,
        beats: canvas.summarise(&dir).count,
        last_opened: Utc::now().to_rfc3339(),
        preview_path,
        preview_stale,
    })
}

#[tauri::command]
pub fn project_open(
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ProjectMeta, String> {
    let path_buf = PathBuf::from(&path);
    let canvas = canvas::active();
    let doc = path_buf.join(canvas.doc_filename());
    if !doc.exists() {
        return Err(format!("no {} in folder", canvas.doc_filename()));
    }
    fs::read_to_string(&doc).map_err(|e| format!("read doc: {}", e))?;

    let watcher = watch::spawn(doc.clone(), app.clone())
        .map_err(|e| format!("watcher: {}", e))?;
    crate::skill::write(&path_buf, canvas.skill_bundle())
        .map_err(|e| format!("write skill: {}", e))?;
    crate::prompt_mode::ensure_seeded(&path_buf);

    let mut active = state.active_project.lock().unwrap();
    *active = Some(ActiveProject {
        path: path_buf.clone(),
        _watcher: watcher,
    });
    drop(active);

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

    let (preview_path, preview_stale) = preview_meta(&path_buf);
    let meta = ProjectMeta {
        name,
        path: path_str,
        beats: canvas.summarise(&path_buf).count,
        last_opened: now,
        preview_path,
        preview_stale,
    };
    let _ = app.emit::<ProjectMeta>("project://opened", meta.clone());
    Ok(meta)
}

#[tauri::command]
pub fn project_close(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    // Snapshot which project we're closing BEFORE clearing state so we
    // can fire off a preview render against its path.
    let closing_path = state
        .active_project
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|p| p.path.clone()));
    *state.active_project.lock().unwrap() = None;
    let _ = app.emit::<()>("project://closed", ());
    // Fire-and-forget: render the preview MP4 in the background.
    if let Some(p) = closing_path {
        crate::preview::spawn_render(&p);
    }
    Ok(())
}

#[tauri::command]
pub fn project_reveal(path: String) -> Result<(), String> {
    // macOS: open the folder in Finder. Best-effort.
    let _ = std::process::Command::new("open").arg(&path).spawn();
    Ok(())
}

#[tauri::command]
pub fn project_delete(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| format!("trash: {}", e))
}
