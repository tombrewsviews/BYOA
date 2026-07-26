//! Tauri 2 entry for standalone Outreach: app state + command registration.

mod agent_chat;
mod agents;
pub mod board;
mod board_window;
mod db;
mod doc;
mod paths;
mod projects;
mod prompt_mode;
mod pty;
mod research;
mod selection;
pub mod settings;
mod skill;
mod watch;

use std::sync::Mutex;

use dashmap::DashMap;
use tauri::Manager;

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
    /// Cached board DB connection for READS (list/snapshot/get). Reused across
    /// commands (opening a shared Postgres board is a slow remote connect — see
    /// `board::CachedBoard`). Keyed internally by project+url+actor; reset on
    /// project open/close. The 5s poll's snapshot lives here.
    pub board_cache: Mutex<Option<board::CachedBoard>>,
    /// Cached board DB connection for WRITES (move/archive/delete/add/…). A
    /// SEPARATE connection so a user's action never has to wait behind an
    /// in-flight read snapshot holding the read connection's mutex — that
    /// contention made every drag/click take ~1s on a shared board.
    pub board_cache_write: Mutex<Option<board::CachedBoard>>,
    /// Serializes the shared-board warm-up so many concurrent `board_ensure_
    /// connected` calls (two windows, poll ticks, the badge poll) don't each
    /// start their own slow Neon connect — a stampede that thrashed the app.
    /// The first caller connects; the rest wait on this lock and then no-op
    /// because the cache is already filled.
    pub board_warm_lock: Mutex<()>,
}

impl AppState {
    /// Kill every live PTY child (the agent CLI and its subprocesses). Called on
    /// app exit: without it, a running agent's process tree outlives the app and
    /// the exit hangs (or the reader/flusher threads panic emitting into a
    /// torn-down app). Best-effort — a kill error on one PTY must not stop the
    /// others.
    pub fn kill_all_ptys(&self) {
        for entry in self.ptys.iter() {
            if let Ok(mut child) = entry.value().child.lock() {
                let _ = child.kill();
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        active_project: Mutex::new(None),
        ptys: DashMap::new(),
        agent_chats: DashMap::new(),
        board_cache: Mutex::new(None),
        board_cache_write: Mutex::new(None),
        board_warm_lock: Mutex::new(()),
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
            projects::projects_rename,
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
            settings::set_database_url,
            settings::set_actor_name,
            prompt_mode::get_prompt_mode,
            prompt_mode::set_prompt_mode,
            selection::set_selection,
            research::research_folder_open,
            research::attach_file,
            research::reveal_file,
            open_dreamstore,
            board::board_list_stages,
            board::board_get_config,
            board::board_list_leads,
            board::board_snapshot,
            board::board_get_lead,
            board::board_add_lead,
            board::board_move_lead,
            board::board_set_lead_archived,
            board::board_delete_lead,
            board::board_append_context,
            board::board_draft_message,
            board::board_attach_transcript,
            board::board_rename_stage,
            board::board_reorder_stages,
            board::board_add_stage,
            board::board_retire_stage,
            board::board_unretire_stage,
            board::board_remap_stage,
            board::board_list_rules,
            board::board_revert,
            board::board_save_shared_url,
            board::board_ensure_connected,
            board::board_connection_status,
            board::board_list_actors,
            board::board_notifications,
            board::board_mark_notifications_read,
            board_window::board_window_open,
            board_window::board_window_close,
            board_window::board_select_lead,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // On exit, reap PTY children so a running agent process tree doesn't
            // keep the app alive (the quit-hang) or crash the emit threads.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                app.state::<AppState>().kill_all_ptys();
            }
        });
}
