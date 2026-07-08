//! Tauri 2 entry for standalone Brainstorm: minimal shell scaffold.
//!
//! This is a scaffolding stub — no domain modules yet. Tasks 3+ add
//! projects/doc/agent modules and wire up AppState + command handlers.

mod paths;
mod watch;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
