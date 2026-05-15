//! Tauri 2 entry: app state, command registration, plugin init.

mod story;

use std::path::PathBuf;

pub struct AppState {
    pub project_root: PathBuf,
}

fn resolve_project_root() -> PathBuf {
    // src-tauri/Cargo.toml is at <project_root>/src-tauri/Cargo.toml, so the
    // workspace root is the parent of CARGO_MANIFEST_DIR.
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
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            story::save_story,
            story::load_story,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
