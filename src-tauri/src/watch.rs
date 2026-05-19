//! Filesystem watcher for the active project's document.
//!
//! Watches whatever filename the active canvas plugin declares (see
//! `canvas.rs`). Uses notify-debouncer-mini so the tmp+rename pattern
//! used by save_doc doesn't double-fire. The watcher runs on its own
//! thread (debouncer-mini owns it); dropping the debouncer stops the
//! thread.
//!
//! Emits `doc://changed` on every settled change. The legacy
//! `story://changed` event is also emitted for backwards compatibility
//! with the frontend during the migration.

use std::path::PathBuf;
use std::time::Duration;

use notify_debouncer_mini::{
    new_debouncer, notify::RecursiveMode, DebounceEventResult, Debouncer,
};
use tauri::{AppHandle, Emitter};

pub type DocWatcher = Debouncer<notify::RecommendedWatcher>;

pub fn spawn(path: PathBuf, app: AppHandle) -> Result<DocWatcher, String> {
    let path_for_handler = path.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(200),
        move |res: DebounceEventResult| match res {
            Ok(events) => {
                if events.iter().any(|e| e.path == path_for_handler) {
                    let _ = app.emit::<()>("doc://changed", ());
                    // Legacy alias — frontend still listens on this.
                    let _ = app.emit::<()>("story://changed", ());
                }
            }
            Err(_) => {
                // Errors are non-fatal — most are transient. Don't
                // panic the watcher thread.
            }
        },
    )
    .map_err(|e| format!("watcher: {}", e))?;

    debouncer
        .watcher()
        .watch(&path, RecursiveMode::NonRecursive)
        .map_err(|e| format!("watch path: {}", e))?;

    Ok(debouncer)
}
