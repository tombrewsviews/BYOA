//! Tauri 2 entry for standalone Remit: app state + command registration.

mod migrate;
mod paths;
mod remit;
mod skill;
mod watch;

use std::sync::Mutex;

use remit::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // One-time, non-destructive copy of pre-separation Remit data from the
    // DreamStore shell into this app's isolated dirs. Idempotent (marker-gated).
    migrate::migrate_once();

    let state = AppState { active_project: Mutex::new(None) };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            remit::projects_list,
            remit::projects_create,
            remit::project_open,
            remit::project_close,
            remit::project_delete,
            remit::open_dreamstore,
            remit::load_doc,
            remit::save_doc,
            remit::remit_export,
            remit::remit_recipients_load,
            remit::remit_recipients_save,
            remit::remit_duplicate,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
