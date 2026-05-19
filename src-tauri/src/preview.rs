//! Project preview MP4s.
//!
//! Each project has a tiny rendered preview at
//! `<project>/.kinetic-studio/preview.mp4`. The projects-list cards show
//! it (frame 0 as a still, plays on hover). We render via a Node script
//! (`scripts/project-preview.ts`) so the existing Remotion CLI does all
//! the heavy lifting and we don't have to re-implement rendering inside
//! Rust.
//!
//! Renders are fired-and-forgotten from `project_close`. If two closes
//! land for the same project in quick succession the renders just run
//! serially (tmp file lives next to the final, and we atomic-move).
//!
//! Staleness: preview is considered stale if `story.json`'s mtime is
//! newer than `preview.mp4`'s mtime. The card shows a dot when stale.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::thread;

use once_cell::sync::Lazy;

/// Repo root — discovered once. The Node script lives there and so do
/// its dependencies / node_modules. In dev `cargo run` runs the binary
/// out of `<repo>/src-tauri/target/debug/`, so the repo is two parents
/// up. In a packaged .app the binary moves; we keep a Lazy cache so a
/// bad guess only happens once.
static REPO_ROOT: Lazy<Mutex<Option<PathBuf>>> = Lazy::new(|| Mutex::new(None));

fn find_repo_root() -> Option<PathBuf> {
    if let Some(r) = REPO_ROOT.lock().ok().and_then(|g| g.clone()) {
        return Some(r);
    }
    // Try ancestors of the current exe and the CWD looking for
    // `scripts/project-preview.ts`. First hit wins.
    let mut candidates: Vec<PathBuf> = vec![];
    if let Ok(exe) = std::env::current_exe() {
        candidates.extend(exe.ancestors().map(|p| p.to_path_buf()));
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.extend(cwd.ancestors().map(|p| p.to_path_buf()));
    }
    for c in candidates {
        if c.join("scripts/project-preview.ts").exists()
            && c.join("package.json").exists()
        {
            let _ = REPO_ROOT.lock().map(|mut g| *g = Some(c.clone()));
            return Some(c);
        }
    }
    None
}

/// Fire-and-forget render of the given project's preview. Returns
/// immediately; the render runs on a detached thread so closing a
/// project doesn't block the UI.
pub fn spawn_render(project_path: &Path) {
    let project = project_path.to_path_buf();
    let repo = match find_repo_root() {
        Some(r) => r,
        None => {
            log::warn!("preview: repo root not found, skipping render");
            return;
        }
    };
    thread::spawn(move || {
        let status = Command::new("npx")
            .arg("tsx")
            .arg("scripts/project-preview.ts")
            .arg(project.to_string_lossy().to_string())
            .current_dir(&repo)
            .status();
        match status {
            Ok(s) if s.success() => {
                log::info!("preview rendered: {}", project.display());
            }
            Ok(s) => {
                log::warn!("preview render failed ({}): {}", s, project.display());
            }
            Err(e) => {
                log::warn!("preview render spawn failed: {}", e);
            }
        }
    });
}
