//! Tauri 2 entry: app state, command registration, plugin init.

mod pty;
mod story;

use std::path::PathBuf;

use dashmap::DashMap;

pub struct AppState {
    pub project_root: PathBuf,
    pub ptys: DashMap<String, pty::PtySession>,
}

fn resolve_project_root() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir)
        .parent()
        .expect("src-tauri has a parent")
        .to_path_buf()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        project_root: resolve_project_root(),
        ptys: DashMap::new(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            story::save_story,
            story::load_story,
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
