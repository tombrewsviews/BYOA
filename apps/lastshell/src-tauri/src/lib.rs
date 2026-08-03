//! Tauri 2 entry for standalone LAST SHELL: app state + command registration.
//!
//! Architecture (mirrors the other DreamStore apps):
//!   - the game runs in the webview (pure TS engine, ported unchanged)
//!   - the side terminal is a real PTY running the agent CLI (pty.rs)
//!   - the agent plays by editing `.lastshell/moves.json`; watch.rs notices
//!     and the frontend validates + applies the move (game.rs moves the bytes)
//!   - skill.rs installs the operating manual the agent reads

mod game;
mod paths;
mod pty;
mod skill;
mod watch;

use std::sync::Mutex;

use dashmap::DashMap;

pub struct AppState {
    pub ptys: DashMap<String, pty::PtySession>,
    /// Live moves.json watcher for the open table, if any.
    pub moves_watcher: Mutex<Option<watch::MovesWatcher>>,
}

/// Start watching a table's `.lastshell/` for agent moves. Replaces any
/// existing watcher (one table open at a time).
#[tauri::command]
fn game_watch(
    project: String,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let w = watch::spawn(std::path::PathBuf::from(&project), app)?;
    *state.moves_watcher.lock().map_err(|e| e.to_string())? = Some(w);
    Ok(())
}

/// Jump back to the DreamStore launcher.
#[tauri::command]
fn open_dreamstore() -> Result<(), String> {
    if std::process::Command::new("open")
        .args(["-b", "app.altramanera.dreamstore"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
    {
        return Ok(());
    }
    let path = std::path::PathBuf::from("/Applications/DreamStore.app");
    if !path.exists() {
        return Err("DreamStore.app not found".into());
    }
    std::process::Command::new("open")
        .arg(&path)
        .status()
        .map_err(|e| format!("open DreamStore: {e}"))
        .and_then(|s| {
            if s.success() {
                Ok(())
            } else {
                Err("open failed".into())
            }
        })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        ptys: DashMap::new(),
        moves_watcher: Mutex::new(None),
    };

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            game::game_ensure_project,
            game::game_write_state,
            game::game_read_moves,
            game::game_clear_moves,
            skill::skill_install,
            game_watch,
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_paste_prompt,
            open_dreamstore,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LAST SHELL");
}
