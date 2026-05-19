//! Tauri 2 entry: app state, command registration, plugin init.

mod agents;
mod canvas;
mod canvases;
mod doc;
mod preview;
mod projects;
mod prompt_mode;
mod pty;
mod selection;
mod settings;
mod skill;
mod video;
mod watch;
mod window_state;

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
        .setup(|app| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                window_state::apply_initial(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            projects::projects_list,
            projects::projects_create,
            projects::project_open,
            projects::project_close,
            projects::project_reveal,
            projects::project_delete,
            doc::save_doc,
            doc::load_doc,
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_paste_prompt,
            prompt_mode::get_prompt_mode,
            prompt_mode::set_prompt_mode,
            selection::set_selection,
            video::import_local_video,
            video::import_local_image,
            video::download_youtube,
            window_state::save_window_state,
            agents::detect_agents,
            settings::get_settings,
            settings::set_default_agent,
            settings::set_skip_permissions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
