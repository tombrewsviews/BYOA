//! Central user-level paths for standalone Brainstorm.
//!
//! Fully isolated from the DreamStore shell: Brainstorm owns `~/.brainstorm/`
//! (recipients, recents, skills bundle) and `~/Brainstorm Projects/` (the
//! project pool). There is NO migration from any legacy location — this
//! app is independent and starts clean.

use std::path::PathBuf;

pub fn user_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".brainstorm"))
        .unwrap_or_else(|| PathBuf::from(".brainstorm"))
}

pub fn user_path(rel: &str) -> PathBuf {
    user_dir().join(rel)
}

pub fn projects_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join("Brainstorm Projects"))
        .unwrap_or_else(|| PathBuf::from("Brainstorm Projects"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_path_is_under_dot_brainstorm() {
        let p = user_path("brainstorm-recipients.json");
        assert!(p.ends_with(".brainstorm/brainstorm-recipients.json"));
    }

    #[test]
    fn projects_dir_is_brainstorm_projects() {
        assert!(projects_dir().ends_with("Brainstorm Projects"));
    }
}
