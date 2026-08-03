//! Game project I/O — the agent-facing file protocol.
//!
//! A project is a directory under `~/DreamStore Projects/<slug>/` holding a
//! `.lastshell/` folder with:
//!
//!   game-state.json  the app writes; PUBLIC info only (see protocol.ts)
//!   moves.json       the agent writes; one move at a time
//!   table.json       seat configuration
//!
//! The app is the referee: it validates every move against the pure reducer
//! before applying it (frontend `validateMove`). Rust only moves bytes.

use std::fs;
use std::path::{Path, PathBuf};

pub const DIR: &str = ".lastshell";
pub const STATE_FILE: &str = "game-state.json";
pub const MOVES_FILE: &str = "moves.json";
/// One line the agent can block on with a shell watch, so it learns a new turn
/// began without anyone telling it. See `game_write_state`.
pub const TICK_FILE: &str = "turn.txt";

fn game_dir(project: &Path) -> PathBuf {
    project.join(DIR)
}

/// Create the project + `.lastshell/` scaffolding. Idempotent.
pub fn ensure_project(name: &str) -> Result<PathBuf, String> {
    let slug = slug::slugify(if name.trim().is_empty() { "table" } else { name });
    let root = crate::paths::projects_dir().join(format!("lastshell-{slug}"));
    fs::create_dir_all(game_dir(&root)).map_err(|e| format!("create project: {e}"))?;
    Ok(root)
}

/// Atomic write (tmp + rename) so a watching agent never reads a half file.
/// The temp name appends rather than replaces the extension, so `turn.txt`
/// stages as `turn.txt.tmp` and not `turn.json.tmp`.
fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let mut tmp_name = path.file_name().unwrap_or_default().to_os_string();
    tmp_name.push(".tmp");
    let tmp = path.with_file_name(tmp_name);
    fs::write(&tmp, contents).map_err(|e| format!("write tmp: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("rename: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn game_ensure_project(name: String) -> Result<String, String> {
    ensure_project(&name).map(|p| p.to_string_lossy().to_string())
}

/// Publish the state the agent is allowed to see.
///
/// Writes the tick file LAST, so an agent watching `turn.txt` never wakes to a
/// half-written or stale `game-state.json`.
#[tauri::command]
pub fn game_write_state(project: String, json: String, tick: String) -> Result<(), String> {
    let dir = game_dir(Path::new(&project));
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {e}"))?;
    write_atomic(&dir.join(STATE_FILE), &json)?;
    write_atomic(&dir.join(TICK_FILE), &tick)
}

/// Read whatever the agent last wrote. `None` when the file is absent.
#[tauri::command]
pub fn game_read_moves(project: String) -> Result<Option<String>, String> {
    let path = game_dir(Path::new(&project)).join(MOVES_FILE);
    match fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("read moves: {e}")),
    }
}

/// Consume the move file so the same move can't be applied twice.
#[tauri::command]
pub fn game_clear_moves(project: String) -> Result<(), String> {
    let path = game_dir(Path::new(&project)).join(MOVES_FILE);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("clear moves: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn write_then_read_roundtrips() {
        let dir = tempdir().unwrap();
        let project = dir.path().to_path_buf();
        fs::create_dir_all(game_dir(&project)).unwrap();
        game_write_state(
            project.to_string_lossy().to_string(),
            r#"{"turn":1}"#.to_string(),
            "turn 1 seat 2\n".to_string(),
        )
        .unwrap();
        let state = fs::read_to_string(game_dir(&project).join(STATE_FILE)).unwrap();
        assert_eq!(state, r#"{"turn":1}"#);
        // the tick file must land too — it is the agent's wake signal
        let tick = fs::read_to_string(game_dir(&project).join(TICK_FILE)).unwrap();
        assert!(tick.contains("turn 1"));
    }

    #[test]
    fn missing_moves_file_is_none_not_an_error() {
        let dir = tempdir().unwrap();
        let got = game_read_moves(dir.path().to_string_lossy().to_string()).unwrap();
        assert!(got.is_none());
    }

    #[test]
    fn clearing_an_absent_move_file_is_ok() {
        let dir = tempdir().unwrap();
        assert!(game_clear_moves(dir.path().to_string_lossy().to_string()).is_ok());
    }

    #[test]
    fn atomic_write_leaves_no_tmp_behind() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("x.json");
        write_atomic(&p, "{}").unwrap();
        assert!(p.exists());
        assert!(!dir.path().join("x.json.tmp").exists());
        // a non-json target stages as <name>.tmp, not <stem>.json.tmp
        let t = dir.path().join("turn.txt");
        write_atomic(&t, "turn 3\n").unwrap();
        assert_eq!(fs::read_to_string(&t).unwrap(), "turn 3\n");
        assert!(!dir.path().join("turn.txt.tmp").exists());
        assert!(!dir.path().join("turn.json.tmp").exists());
    }
}
