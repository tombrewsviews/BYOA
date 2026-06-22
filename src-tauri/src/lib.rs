//! Tauri 2 entry: app state, command registration, plugin init.

mod agent_chat;
mod agents;
mod brainstorm_canvas;
mod canvas;
mod canvases;
mod data;
mod data_semantic;
mod doc;
mod git;
mod history;
mod preview;
mod projects;
mod prompt_mode;
mod pty;
mod pulse;
mod selection;
mod settings;
mod skill;
mod stage;
mod video;
mod watch;
mod window_state;

use std::sync::Mutex;

use dashmap::DashMap;

pub struct AppState {
    pub active_project: Mutex<Option<projects::ActiveProject>>,
    pub ptys: DashMap<String, pty::PtySession>,
    pub agent_chats: DashMap<String, agent_chat::AgentChatTurn>,
    /// The Brainstorm Canvas server process, if the Brainstorm app started one.
    pub canvas_server: brainstorm_canvas::CanvasServer,
    pub data_engine: data::DataEngine,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        active_project: Mutex::new(None),
        ptys: DashMap::new(),
        agent_chats: DashMap::new(),
        canvas_server: brainstorm_canvas::CanvasServer::default(),
        data_engine: data::DataEngine::default(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .setup(|app| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                window_state::apply_initial(&window);
                // Kill the Brainstorm canvas server (if any) when the main
                // window closes, so its localhost server + port don't leak.
                let handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        brainstorm_canvas::shutdown(&handle.state::<AppState>());
                    }
                });
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
            projects::active_project_path,
            doc::apply_patch,
            doc::load_doc,
            doc::save_doc,
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_paste_prompt,
            agent_chat::agent_chat_run_turn,
            agent_chat::agent_chat_cancel,
            prompt_mode::get_prompt_mode,
            prompt_mode::set_prompt_mode,
            selection::set_selection,
            video::import_local_video,
            video::import_local_image,
            video::download_youtube,
            video::export_video,
            window_state::save_window_state,
            window_state::get_view_mode,
            window_state::set_view_mode,
            agents::detect_agents,
            settings::get_settings,
            settings::set_default_agent,
            settings::set_skip_permissions,
            settings::set_agent_starting_command,
            pulse::pulse_import,
            pulse::pulse_write_analysis,
            pulse::pulse_import_asset,
            git::git_current_branch,
            git::git_branch,
            git::git_commit_all,
            git::git_merge,
            stage::open_stage_window,
            stage::close_stage_window,
            brainstorm_canvas::brainstorm_canvas_start,
            brainstorm_canvas::brainstorm_canvas_open_window,
            brainstorm_canvas::brainstorm_canvas_close_window,
            data::data_open_source,
            data::data_run_sql,
            data::data_schema,
            data::data_evaluate,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
