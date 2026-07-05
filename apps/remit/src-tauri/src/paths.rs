//! Central user-level paths for standalone Remit.
//!
//! Fully isolated from the DreamStore shell: Remit owns `~/.remit/`
//! (recipients, recents, skills bundle) and `~/Remit Projects/` (the
//! project pool). There is NO migration from any legacy location — this
//! app is independent and starts clean.

use std::path::PathBuf;

pub fn user_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".remit"))
        .unwrap_or_else(|| PathBuf::from(".remit"))
}

pub fn user_path(rel: &str) -> PathBuf {
    user_dir().join(rel)
}

pub fn projects_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join("Remit Projects"))
        .unwrap_or_else(|| PathBuf::from("Remit Projects"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_path_is_under_dot_remit() {
        let p = user_path("remit-recipients.json");
        assert!(p.ends_with(".remit/remit-recipients.json"));
    }

    #[test]
    fn projects_dir_is_remit_projects() {
        assert!(projects_dir().ends_with("Remit Projects"));
    }
}
