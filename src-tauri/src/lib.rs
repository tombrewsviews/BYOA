//! Tauri 2 entry: app state, command registration, plugin init.

mod pty;
mod story;
mod watch;

use std::path::PathBuf;
use std::sync::Mutex;

use dashmap::DashMap;
use tauri::Manager;

pub struct AppState {
    pub project_root: PathBuf,
    pub ptys: DashMap<String, pty::PtySession>,
    pub watcher: Mutex<Option<watch::StoryWatcher>>,
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
    let project_root = resolve_project_root();
    let state = AppState {
        project_root: project_root.clone(),
        ptys: DashMap::new(),
        watcher: Mutex::new(None),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .setup(move |app| {
            let story_path = project_root.join("story.json");
            match watch::spawn(story_path, app.handle().clone()) {
                Ok(w) => {
                    let state = app.state::<AppState>();
                    *state.watcher.lock().unwrap() = Some(w);
                }
                Err(e) => {
                    eprintln!("[watch] startup failed: {}", e);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
