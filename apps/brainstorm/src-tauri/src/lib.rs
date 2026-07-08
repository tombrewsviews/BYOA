//! Tauri 2 entry for standalone Brainstorm: app state + command registration.

mod doc;
mod paths;
mod projects;
mod skill;
mod watch;

use std::sync::Mutex;

pub struct AppState {
    pub active_project: Mutex<Option<projects::ActiveProject>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState { active_project: Mutex::new(None) };

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
