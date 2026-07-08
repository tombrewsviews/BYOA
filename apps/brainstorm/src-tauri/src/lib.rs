//! Tauri 2 entry for standalone Brainstorm: app state + command registration.

mod agent_chat;
mod agents;
mod doc;
mod paths;
mod projects;
mod prompt_mode;
mod pty;
mod selection;
mod settings;
mod skill;
mod watch;

use std::sync::Mutex;

use dashmap::DashMap;

pub struct AppState {
    pub active_project: Mutex<Option<projects::ActiveProject>>,
    pub ptys: DashMap<String, pty::PtySession>,
    pub agent_chats: DashMap<String, agent_chat::AgentChatTurn>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
