//! Tauri 2 entry: app state, command registration, plugin init.

mod projects;
mod pty;
mod seed;
mod story;
mod watch;

use std::sync::Mutex;

use dashmap::DashMap;

pub struct AppState {
    pub active_project: Mutex<Option<projects::ActiveProject>>,
    pub ptys: DashMap<String, pty::PtySession>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        active_project: Mutex::new(None),
        ptys: DashMap::new(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            projects::projects_list,
            projects::projects_create,
            projects::project_open,
            projects::project_close,
            projects::project_reveal,
            projects::project_delete,
            story::save_story,
            story::load_story,
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_paste_prompt,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
