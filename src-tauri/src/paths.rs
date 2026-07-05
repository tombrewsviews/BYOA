//! Central user-level paths for DreamStore + one-time non-destructive
//! migration from the legacy KineticType locations.
//!
//! Two user-level dirs move: `~/.kinetic-studio/` -> `~/.dreamstore/`
//! (settings, recents, window, skills bundle, recipients) and
//! `~/KineticStudio/` -> `~/DreamStore Projects/` (the project pool).
//! Per-project `<project>/.kinetic-studio/` dirs are intentionally left
//! as legacy and are NOT touched here.

use std::path::{Path, PathBuf};

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

/// Rename `old` -> `new` only if `new` is absent and `old` exists.
fn migrate_one(old: &Path, new: &Path) {
    if new.exists() || !old.exists() {
        return;
    }
    match std::fs::rename(old, new) {
        Ok(()) => eprintln!("dreamstore: migrated {} -> {}", old.display(), new.display()),
        Err(e) => eprintln!("dreamstore: migrate {} failed: {}", old.display(), e),
    }
}

/// Testable core: migrate both legacy dirs under an explicit home.
fn migrate_in(home: &Path) {
    migrate_one(&home.join(".kinetic-studio"), &home.join(".dreamstore"));
    migrate_one(&home.join("KineticStudio"), &home.join("DreamStore Projects"));
}

/// Run the one-time migrations against the real home dir. Idempotent.
pub fn migrate_user_paths() {
    if let Some(home) = dirs::home_dir() {
        migrate_in(&home);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // migrate_in(home) is the testable core: takes an explicit home dir.
    #[test]
    fn migrates_legacy_user_dir_when_new_absent() {
        let home = TempDir::new().unwrap();
        let old = home.path().join(".kinetic-studio");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("settings.json"), b"{}").unwrap();

        migrate_in(home.path());

        let new = home.path().join(".dreamstore");
        assert!(new.join("settings.json").exists(), "content moved to new dir");
        assert!(!old.exists(), "old dir renamed away");
    }

    #[test]
    fn does_not_clobber_existing_new_dir() {
        let home = TempDir::new().unwrap();
        let old = home.path().join(".kinetic-studio");
        let new = home.path().join(".dreamstore");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("a.json"), b"OLD").unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join("a.json"), b"NEW").unwrap();

        migrate_in(home.path());

        assert_eq!(fs::read_to_string(new.join("a.json")).unwrap(), "NEW", "new preferred");
        assert!(old.exists(), "old left untouched when new exists");
    }

    #[test]
    fn migrates_legacy_projects_pool() {
        let home = TempDir::new().unwrap();
        let old = home.path().join("KineticStudio");
        fs::create_dir_all(old.join("proj1")).unwrap();

        migrate_in(home.path());

        assert!(home.path().join("DreamStore Projects").join("proj1").exists());
        assert!(!old.exists());
    }
}
