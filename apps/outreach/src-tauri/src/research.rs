//! Research ingestion (v1): a per-board `research/` folder the user drops files
//! into. The terminal/chat agent runs with the board folder as its cwd, so it
//! reaches these files at the relative path `research/` and ingests them on
//! command (see the "Ingesting research files" section of SKILL.md). The app's
//! only job here is to own the folder and reveal it in Finder.

use std::path::{Path, PathBuf};

use tauri::State;

use crate::projects;
use crate::AppState;

/// The `research/` folder for a given board directory.
pub fn research_dir(project_dir: &Path) -> PathBuf {
    project_dir.join("research")
}

/// Create the board's `research/` folder if it doesn't exist. Called on board
/// create and open so the folder is always there for the user to drop files in.
pub fn ensure_research_dir(project_dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(research_dir(project_dir))
}

/// Reveal the active board's `research/` folder in Finder, creating it first if
/// missing. macOS-only (`open`), matching the app's target platform.
#[tauri::command]
pub fn research_folder_open(state: State<'_, AppState>) -> Result<(), String> {
    let dir = research_dir(&projects::active_path(&state)?);
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir research: {}", e))?;
    std::process::Command::new("open")
        .arg(&dir)
        .status()
        .map_err(|e| format!("open research folder: {}", e))
        .and_then(|s| if s.success() { Ok(()) } else { Err("open failed".into()) })
}

/// Copy a picked file into the active board at `attachments/<lead_id>/<name>`
/// and return the stored absolute path. Used to attach a presentation (or any
/// file) to a lead — the frontend records the returned path on the lead's
/// context. Keeps attachments inside the board folder so they travel with it.
#[tauri::command]
pub fn attach_file(
    state: State<'_, AppState>,
    lead_id: String,
    src_path: String,
) -> Result<String, String> {
    let src = std::path::PathBuf::from(&src_path);
    let name = src
        .file_name()
        .ok_or_else(|| "source has no file name".to_string())?;
    let dir = projects::active_path(&state)?
        .join("attachments")
        .join(&lead_id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir attachments: {}", e))?;
    let dest = dir.join(name);
    std::fs::copy(&src, &dest).map_err(|e| format!("copy attachment: {}", e))?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Reveal a stored file in Finder (e.g. an attachment), so the user can open it.
#[tauri::command]
pub fn reveal_file(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .args(["-R", &path])
        .status()
        .map_err(|e| format!("reveal: {}", e))
        .and_then(|s| if s.success() { Ok(()) } else { Err("reveal failed".into()) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn research_dir_is_research_under_project() {
        let project = Path::new("/tmp/board");
        assert_eq!(research_dir(project), PathBuf::from("/tmp/board/research"));
    }

    #[test]
    fn ensure_creates_the_folder_when_missing() {
        let project = TempDir::new().unwrap();
        let dir = research_dir(project.path());
        assert!(!dir.exists());
        ensure_research_dir(project.path()).unwrap();
        assert!(dir.is_dir());
    }

    #[test]
    fn ensure_is_idempotent_when_already_present() {
        let project = TempDir::new().unwrap();
        ensure_research_dir(project.path()).unwrap();
        // Second call must not error even though the folder already exists.
        ensure_research_dir(project.path()).unwrap();
        assert!(research_dir(project.path()).is_dir());
    }
}
