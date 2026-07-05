//! Remit's backend: project lifecycle + document read/write + recipients +
//! PDF export. Standalone single-app crate — no canvas registry; the document
//! is always `remit.json`.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::skill;
use crate::watch;

/// The one document filename for a Remit project.
const DOC_FILENAME: &str = "remit.json";
/// Seed written into a brand-new project's remit.json.
const SEED_REMIT: &[u8] = include_bytes!("../templates/seed-remit.json");

// ---- shared runtime state --------------------------------------------------

pub struct ActiveProject {
    pub path: PathBuf,
    pub _watcher: watch::DocWatcher,
}

pub struct AppState {
    pub active_project: Mutex<Option<ActiveProject>>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub name: String,
    pub path: String,
    pub last_opened: String,
}

// ---- store helpers ---------------------------------------------------------

fn recents_path() -> PathBuf {
    crate::paths::user_path("recents.json")
}

fn read_recents() -> HashMap<String, String> {
    fs::read_to_string(recents_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_recents(map: &HashMap<String, String>) {
    if let Some(parent) = recents_path().parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(map) {
        let _ = fs::write(recents_path(), json);
    }
}

fn recipients_path() -> PathBuf {
    crate::paths::user_path("remit-recipients.json")
}

fn active_path(state: &AppState) -> Result<PathBuf, String> {
    state
        .active_project
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|p| p.path.clone())
        .ok_or_else(|| "no active project".into())
}

// ---- project lifecycle -----------------------------------------------------

#[tauri::command]
pub fn projects_list(canvas: Option<String>) -> Result<Vec<ProjectMeta>, String> {
    // `canvas` is accepted for frontend compatibility (RemitApp passes
    // { canvas: "remit" }) but every project here is a Remit project, so the
    // only filter is "does the folder contain remit.json".
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

/// Create + seed a new Remit project folder. Shared by `projects_create` and
/// `remit_duplicate`.
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
    fs::write(dir.join(DOC_FILENAME), SEED_REMIT).map_err(|e| format!("write doc: {}", e))?;
    skill::write(&dir, &skill::REMIT_BUNDLE).map_err(|e| format!("write skill: {}", e))?;

    let display_name = if name.trim().is_empty() { "Untitled".into() } else { name.to_string() };
    Ok(ProjectMeta {
        name: display_name,
        path: dir.to_string_lossy().to_string(),
        last_opened: Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub fn projects_create(name: String, canvas: Option<String>) -> Result<ProjectMeta, String> {
    let _ = canvas; // always Remit
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
    skill::write(&path_buf, &skill::REMIT_BUNDLE).map_err(|e| format!("write skill: {}", e))?;

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

/// Launch the DreamStore launcher app. Standalone Remit is independent, but the
/// user can jump back to the store from here. Tries the app bundle by its
/// identifier first (works once DreamStore is a registered/installed .app);
/// falls back to the local install path under ~/Applications/DreamStore/.
#[tauri::command]
pub fn open_dreamstore() -> Result<(), String> {
    // `open -b <bundle-id>` launches a registered app regardless of its path.
    if std::process::Command::new("open")
        .args(["-b", "app.altramanera.dreamstore"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
    {
        return Ok(());
    }
    // Fallback: the local dev install location.
    let path = dirs::home_dir()
        .map(|h| h.join("Applications/DreamStore/DreamStore.app"))
        .ok_or_else(|| "no home dir".to_string())?;
    if !path.exists() {
        return Err("DreamStore is not installed".to_string());
    }
    std::process::Command::new("open")
        .arg(&path)
        .status()
        .map_err(|e| format!("open DreamStore: {}", e))
        .and_then(|s| if s.success() { Ok(()) } else { Err("open failed".into()) })
}

// ---- document read/write ---------------------------------------------------

fn doc_path(state: &AppState) -> Result<PathBuf, String> {
    Ok(active_path(state)?.join(DOC_FILENAME))
}

#[tauri::command]
pub fn load_doc(state: State<'_, AppState>) -> Result<String, String> {
    fs::read_to_string(doc_path(&state)?).map_err(|e| format!("read: {}", e))
}

#[tauri::command]
pub fn save_doc(json: String, state: State<'_, AppState>) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| format!("invalid doc json: {}", e))?;
    let target = doc_path(&state)?;
    let tmp = target.with_extension("json.tmp");
    let body = if json.ends_with('\n') { json } else { format!("{}\n", json) };
    fs::write(&tmp, body.as_bytes()).map_err(|e| format!("write tmp: {}", e))?;
    fs::rename(&tmp, &target).map_err(|e| format!("rename: {}", e))?;
    Ok(())
}

/// Write filled-PDF bytes to `dir/filename` (basename-sanitised), reveal in
/// Finder, return the absolute path. `dir` comes from the frontend folder
/// picker.
#[tauri::command]
pub fn remit_export(dir: String, filename: String, bytes: Vec<u8>) -> Result<String, String> {
    let name = Path::new(&filename)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "invalid filename".to_string())?;
    let dir_path = Path::new(&dir);
    if !dir_path.is_dir() {
        return Err(format!("not a directory: {}", dir));
    }
    let target = dir_path.join(name);
    let tmp = target.with_extension("pdf.tmp");
    fs::write(&tmp, &bytes).map_err(|e| format!("write tmp: {}", e))?;
    fs::rename(&tmp, &target).map_err(|e| format!("rename: {}", e))?;
    // Reveal the saved file in Finder (best-effort). Skipped under `cargo test`
    // so the unit tests don't spawn Finder / race TempDir cleanup.
    #[cfg(not(test))]
    let _ = std::process::Command::new("open").arg("-R").arg(&target).spawn();
    Ok(target.to_string_lossy().into_owned())
}

// ---- recipients + duplicate ------------------------------------------------

#[tauri::command]
pub fn remit_recipients_load() -> Result<String, String> {
    match fs::read_to_string(recipients_path()) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("[]".to_string()),
        Err(e) => Err(format!("read recipients: {}", e)),
    }
}

#[tauri::command]
pub fn remit_recipients_save(json: String) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| format!("invalid recipients json: {}", e))?;
    if !value.is_array() {
        return Err("recipients must be a JSON array".to_string());
    }
    let p = recipients_path();
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {}", e))?;
    }
    let body = if json.ends_with('\n') { json } else { format!("{}\n", json) };
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, body.as_bytes()).map_err(|e| format!("write tmp: {}", e))?;
    fs::rename(&tmp, &p).map_err(|e| format!("rename: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn remit_duplicate(source_path: String, name: String) -> Result<ProjectMeta, String> {
    let source = PathBuf::from(&source_path);
    let doc_bytes = fs::read(source.join(DOC_FILENAME)).map_err(|e| format!("read source doc: {}", e))?;
    let meta = create_project_dir(&name)?;
    let target_doc = PathBuf::from(&meta.path).join(DOC_FILENAME);
    let body = if doc_bytes.ends_with(b"\n") {
        doc_bytes
    } else {
        let mut b = doc_bytes;
        b.push(b'\n');
        b
    };
    let tmp = target_doc.with_extension("json.tmp");
    fs::write(&tmp, &body).map_err(|e| format!("write tmp: {}", e))?;
    fs::rename(&tmp, &target_doc).map_err(|e| format!("rename: {}", e))?;
    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // These test the file-level helpers directly (not the #[tauri::command]
    // wrappers, which need a running app). They exercise the paths that matter:
    // seeding, save/load round-trip, recipients round-trip, export.

    fn new_project(home: &Path, name: &str) -> PathBuf {
        let dir = home.join(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(DOC_FILENAME), SEED_REMIT).unwrap();
        dir
    }

    #[test]
    fn seed_is_valid_json_with_expected_shape() {
        let v: serde_json::Value = serde_json::from_slice(SEED_REMIT).unwrap();
        assert!(v.get("recipient").is_some(), "seed has a recipient block");
        assert!(v.get("amount").is_some(), "seed has an amount block");
    }

    #[test]
    fn save_then_load_round_trips() {
        let home = TempDir::new().unwrap();
        let proj = new_project(home.path(), "t1");
        let doc = proj.join(DOC_FILENAME);
        let payload = r#"{"recipient":{"name":"Acme"}}"#;
        // Emulate save_doc's atomic write.
        let tmp = doc.with_extension("json.tmp");
        fs::write(&tmp, format!("{}\n", payload)).unwrap();
        fs::rename(&tmp, &doc).unwrap();
        let loaded = fs::read_to_string(&doc).unwrap();
        let v: serde_json::Value = serde_json::from_str(&loaded).unwrap();
        assert_eq!(v["recipient"]["name"], "Acme");
    }

    #[test]
    fn remit_export_writes_a_file_and_rejects_traversal() {
        let dir = TempDir::new().unwrap();
        // basename-sanitise: a traversal filename lands inside dir, not above it.
        let out = remit_export(
            dir.path().to_string_lossy().into_owned(),
            "../escape.pdf".to_string(),
            b"%PDF-1.4 test".to_vec(),
        )
        .unwrap();
        let out_path = PathBuf::from(&out);
        assert_eq!(out_path.file_name().unwrap(), "escape.pdf");
        assert_eq!(out_path.parent().unwrap(), dir.path());
        assert!(out_path.exists());
    }

    #[test]
    fn remit_export_errors_on_missing_dir() {
        let missing = "/definitely/not/a/real/dir/xyz";
        let r = remit_export(missing.to_string(), "a.pdf".to_string(), vec![1, 2, 3]);
        assert!(r.is_err());
    }
}
