//! Central user-level paths for standalone Outreach.
//!
//! Fully isolated from Brainstorm and the DreamStore shell: Outreach owns
//! `~/.outreach/` (skills bundle, per-user state) and `~/Outreach Projects/`
//! (the project pool). There is NO migration from any legacy location — this
//! app is independent and starts clean.

use std::path::PathBuf;

pub fn user_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".outreach"))
        .unwrap_or_else(|| PathBuf::from(".outreach"))
}

pub fn user_path(rel: &str) -> PathBuf {
    user_dir().join(rel)
}

pub fn projects_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join("Outreach Projects"))
        .unwrap_or_else(|| PathBuf::from("Outreach Projects"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_path_is_under_dot_outreach() {
        let p = user_path("state.json");
        assert!(p.ends_with(".outreach/state.json"));
    }

    #[test]
    fn projects_dir_is_outreach_projects() {
        assert!(projects_dir().ends_with("Outreach Projects"));
    }
}
