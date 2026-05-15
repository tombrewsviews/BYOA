//! Filesystem watcher for the active project's story.json.
//!
//! Uses notify-debouncer-mini so the tmp+rename pattern used by
//! save_story doesn't double-fire. The watcher runs on its own
//! thread (debouncer-mini owns it); calling `shutdown` drops the
//! debouncer which stops the thread.

use std::path::PathBuf;
use std::time::Duration;

use notify_debouncer_mini::{
    new_debouncer, notify::RecursiveMode, DebounceEventResult, Debouncer,
};
use tauri::{AppHandle, Emitter};

pub type StoryWatcher = Debouncer<notify::RecommendedWatcher>;

pub fn spawn(path: PathBuf, app: AppHandle) -> Result<StoryWatcher, String> {
    let path_for_handler = path.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(200),
        move |res: DebounceEventResult| match res {
            Ok(events) => {
                if events.iter().any(|e| e.path == path_for_handler) {
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
