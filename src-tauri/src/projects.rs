//! Project lifecycle commands.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::seed::SEED_STORY;
use crate::watch;
use crate::AppState;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub name: String,
    pub path: String,
    pub beats: usize,
    pub last_opened: String,
}

pub struct ActiveProject {
    pub path: PathBuf,
    pub _watcher: watch::StoryWatcher,
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

fn count_beats(story_path: &Path) -> usize {
    fs::read_to_string(story_path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("beats").and_then(|b| b.as_array()).map(|a| a.len()))
        .unwrap_or(0)
}

#[tauri::command]
pub fn projects_list() -> Result<Vec<ProjectMeta>, String> {
    let home = home_dir();
    fs::create_dir_all(&home).map_err(|e| format!("mkdir home: {}", e))?;

    let recents = read_recents();
    let mut out: Vec<ProjectMeta> = vec![];

    for entry in fs::read_dir(&home).map_err(|e| format!("readdir: {}", e))? {
        let entry = entry.map_err(|e| format!("entry: {}", e))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let story = path.join("story.json");
        if !story.exists() {
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
        out.push(ProjectMeta {
            name,
            path: path_str,
            beats: count_beats(&story),
            last_opened,
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
    fs::write(dir.join("story.json"), SEED_STORY)
        .map_err(|e| format!("write story: {}", e))?;
    fs::create_dir_all(dir.join(".kinetic-studio"))
        .map_err(|e| format!("mkdir meta: {}", e))?;
    crate::skill::write(&dir).map_err(|e| format!("write skill: {}", e))?;

    let display_name = if name.trim().is_empty() {
        "Untitled".into()
    } else {
        name
    };

    let path_str = dir.to_string_lossy().to_string();

    Ok(ProjectMeta {
        name: display_name,
        path: path_str,
        beats: count_beats(&dir.join("story.json")),
        last_opened: Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub fn project_open(
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ProjectMeta, String> {
    let path_buf = PathBuf::from(&path);
    let story = path_buf.join("story.json");
    if !story.exists() {
        return Err("no story.json in folder".into());
    }
    fs::read_to_string(&story).map_err(|e| format!("read story: {}", e))?;

    let watcher = watch::spawn(story.clone(), app.clone())
        .map_err(|e| format!("watcher: {}", e))?;
    crate::skill::write(&path_buf).map_err(|e| format!("write skill: {}", e))?;

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

    let meta = ProjectMeta {
        name,
        path: path_str,
        beats: count_beats(&story),
        last_opened: now,
    };
    let _ = app.emit::<ProjectMeta>("project://opened", meta.clone());
    Ok(meta)
}

#[tauri::command]
pub fn project_close(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    *state.active_project.lock().unwrap() = None;
    let _ = app.emit::<()>("project://closed", ());
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
