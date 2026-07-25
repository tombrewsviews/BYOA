//! Tauri 2 entry for standalone Brainstorm: app state + command registration.

mod agent_chat;
mod agents;
// board module added in Phase 1
mod doc;
mod migrate;
mod paths;
mod projects;
mod prompt_mode;
mod pty;
mod selection;
mod settings;
mod watch;

use std::sync::Mutex;

use dashmap::DashMap;

/// Launch the DreamStore launcher app. Standalone Brainstorm is independent,
/// but the user can jump back to the store from here. Tries the app bundle by
/// its identifier first (works once DreamStore is a registered/installed .app);
/// falls back to the launcher's own location in /Applications.
#[tauri::command]
fn open_dreamstore() -> Result<(), String> {
    // `open -b <bundle-id>` launches a registered app regardless of its path.
    if std::process::Command::new("open")
        .args(["-b", "app.altramanera.dreamstore"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
    {
        return Ok(());
    }
    // Fallback: the launcher lives in /Applications itself; only the
    // installed apps live under /Applications/DreamStore/.
    let path = std::path::PathBuf::from("/Applications/DreamStore.app");
    if !path.exists() {
        return Err("DreamStore is not installed".to_string());
    }
    std::process::Command::new("open")
        .arg(&path)
        .status()
        .map_err(|e| format!("open DreamStore: {}", e))
        .and_then(|s| if s.success() { Ok(()) } else { Err("open failed".into()) })
}

pub struct AppState {
    pub active_project: Mutex<Option<projects::ActiveProject>>,
    pub ptys: DashMap<String, pty::PtySession>,
    pub agent_chats: DashMap<String, agent_chat::AgentChatTurn>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // One-time, non-destructive copy of pre-separation Brainstorm boards from
    // the DreamStore shell into this app's isolated dirs. Idempotent
    // (marker-gated).
    migrate::migrate_once();

    let state = AppState {
        active_project: Mutex::new(None),
        ptys: DashMap::new(),
        agent_chats: DashMap::new(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            projects::projects_list,
            projects::projects_create,
            projects::project_open,
            projects::project_close,
            projects::project_delete,
            projects::active_project_path,
            doc::load_doc,
            doc::save_doc,
            agent_chat::agent_chat_run_turn,
            agent_chat::agent_chat_cancel,
            agents::detect_agents,
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_paste_prompt,
            settings::get_settings,
            settings::set_default_agent,
            settings::set_skip_permissions,
            settings::set_agent_starting_command,
            prompt_mode::get_prompt_mode,
            prompt_mode::set_prompt_mode,
            selection::set_selection,
            open_dreamstore,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
