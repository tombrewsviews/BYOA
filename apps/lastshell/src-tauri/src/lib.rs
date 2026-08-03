//! Tauri 2 entry for standalone LAST SHELL: app state + command registration.
//!
//! Architecture (mirrors the other DreamStore apps):
//!   - the game runs in the webview (pure TS engine, ported unchanged)
//!   - the side terminal is a real PTY running the agent CLI (pty.rs)
//!   - the agent plays by editing `.lastshell/moves.json`; watch.rs notices
//!     and the frontend validates + applies the move (game.rs moves the bytes)
//!   - skill.rs installs the operating manual the agent reads

mod agents;
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

/// Where to send someone who doesn't have DreamStore installed.
const DREAMSTORE_REPO: &str = "https://github.com/tombrewsviews/BYOA";

/// Jump back to the DreamStore launcher — or to the repo if it isn't installed.
///
/// Returns which of the two happened ("app" or "repo") so the UI can label the
/// button honestly instead of promising a launcher that isn't there.
#[tauri::command]
fn open_dreamstore() -> Result<&'static str, String> {
    // By bundle id first: finds the app wherever it actually lives.
    if std::process::Command::new("open")
        .args(["-b", "app.altramanera.dreamstore"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
    {
        return Ok("app");
    }
    let path = std::path::PathBuf::from("/Applications/DreamStore.app");
    if path.exists()
        && std::process::Command::new("open")
            .arg(&path)
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    {
        return Ok("app");
    }
    // Not installed (or it refused to launch) — send them to the source.
    std::process::Command::new("open")
        .arg(DREAMSTORE_REPO)
        .status()
        .map_err(|e| format!("open {DREAMSTORE_REPO}: {e}"))
        .and_then(|s| {
            if s.success() {
                Ok("repo")
            } else {
                Err(format!("could not open {DREAMSTORE_REPO}"))
            }
        })
}

/// Whether the DreamStore launcher is installed, so the UI can pick its label
/// up front rather than after the click.
#[tauri::command]
fn dreamstore_installed() -> bool {
    if std::path::PathBuf::from("/Applications/DreamStore.app").exists() {
        return true;
    }
    // Ask Launch Services, so a copy outside /Applications still counts.
    std::process::Command::new("mdfind")
        .args(["-count", "kMDItemCFBundleIdentifier == 'app.altramanera.dreamstore'"])
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .trim()
                .parse::<u32>()
                .unwrap_or(0)
                > 0
        })
        .unwrap_or(false)
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
            agents::detect_agents,
            game_watch,
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_paste_prompt,
            open_dreamstore,
            dreamstore_installed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LAST SHELL");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_repo_fallback_points_at_a_real_https_url() {
        // The `⌘` button opens this when DreamStore isn't installed, so a typo
        // here sends people nowhere.
        assert!(DREAMSTORE_REPO.starts_with("https://github.com/"));
        assert!(!DREAMSTORE_REPO.ends_with('/'));
        assert!(!DREAMSTORE_REPO.contains(".git"));
    }

    #[test]
    fn installed_check_answers_without_panicking() {
        // Shells out to mdfind; must degrade to false rather than blow up when
        // the tool is missing or the query returns nothing parseable.
        let _ = dreamstore_installed();
    }
}
