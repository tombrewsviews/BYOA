//! Watches the project's `.lastshell/moves.json` for agent-written moves.
//!
//! Debounced (notify-debouncer-mini) so the tmp+rename write pattern doesn't
//! double-fire. Watches the DIRECTORY, not the file: the agent may create
//! moves.json fresh each turn, and a watch on a non-existent path fails.
//!
//! Emits `moves://changed`; the frontend then reads, validates, and applies.

use std::path::{Path, PathBuf};
use std::time::Duration;

use notify_debouncer_mini::{
    new_debouncer, notify::RecursiveMode, DebounceEventResult, Debouncer,
};
use tauri::{AppHandle, Emitter};

pub type MovesWatcher = Debouncer<notify::RecommendedWatcher>;

pub fn spawn(project: PathBuf, app: AppHandle) -> Result<MovesWatcher, String> {
    let dir = project.join(crate::game::DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("watch mkdir: {e}"))?;
    let target = dir.join(crate::game::MOVES_FILE);

    let mut debouncer = new_debouncer(
        Duration::from_millis(150),
        move |res: DebounceEventResult| {
            if let Ok(events) = res {
                if events.iter().any(|e| paths_match(&e.path, &target)) {
                    let _ = app.emit::<()>("moves://changed", ());
                }
            }
            // Errors are transient; never panic the watcher thread.
        },
    )
    .map_err(|e| format!("watcher: {e}"))?;

    debouncer
        .watcher()
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("watch path: {e}"))?;

    Ok(debouncer)
}

/// Compare by file name so the tmp→final rename still matches the target.
fn paths_match(changed: &Path, target: &Path) -> bool {
    changed.file_name() == target.file_name()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_moves_file_by_name() {
        let t = Path::new("/a/.lastshell/moves.json");
        assert!(paths_match(Path::new("/b/.lastshell/moves.json"), t));
        assert!(!paths_match(Path::new("/a/.lastshell/game-state.json"), t));
    }
}
