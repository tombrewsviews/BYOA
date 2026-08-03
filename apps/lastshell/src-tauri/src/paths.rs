//! User-level paths. LAST SHELL shares DreamStore's `~/.dreamstore/` bundle
//! directory (so the shell can list its skill) but owns its own project pool.

use std::path::PathBuf;

pub fn user_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".dreamstore"))
        .unwrap_or_else(|| PathBuf::from(".dreamstore"))
}

pub fn user_path(rel: &str) -> PathBuf {
    user_dir().join(rel)
}

pub fn projects_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join("DreamStore Projects"))
        .unwrap_or_else(|| PathBuf::from("DreamStore Projects"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_path_is_under_dot_dreamstore() {
        assert!(user_path("skills-bundle").ends_with(".dreamstore/skills-bundle"));
    }

    #[test]
    fn projects_dir_is_dreamstore_projects() {
        assert!(projects_dir().ends_with("DreamStore Projects"));
    }
}
