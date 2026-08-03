//! Per-project agent skill installer.
//!
//! Materialises LAST SHELL's SKILL.md into the shared per-user bundle
//! (`~/.dreamstore/skills-bundle/lastshell/`), symlinks it into the project's
//! `.claude/skills/lastshell/`, and writes a project CLAUDE.md pointing the
//! agent at it. The symlink means an app update reaches every existing table on
//! next open without rewriting per-project files.

use std::fs;
use std::path::{Path, PathBuf};

const SKILL_ROUTING: &str = include_str!("../../skills/lastshell/SKILL.md");

const CLAUDE_MD: &str = r#"# LAST SHELL table

You are a player at a LAST SHELL table — shotgun roulette against humans on one
device. **Your operating manual is `.claude/skills/lastshell/SKILL.md`** — read
it before your first move.

Short version:

- You play by editing files, not by calling functions:
  read `.lastshell/game-state.json`, write `.lastshell/moves.json`.
- **Drive your own turns.** `.lastshell/turn.txt` changes every time the app
  republishes state. Read it; if unchanged since your last move, `sleep 1` and
  read again. When it changes, re-read the state and act. Loop until
  `phase` is `gameOver`. Never stop to ask whether it is your turn — and never
  ask to be told when the state updated. That is what `turn.txt` is for.
- `awaitingSeat` tells you whose turn it is. If it is `null`, it is a human's
  turn — **do nothing and go back to waiting**. If it is a number, that seat is
  yours.
- A `USE_ITEM` move does **not** end your turn: wait for the next tick and act
  again (a glass reveal arrives as `view.peekedShell`).
- Pick only from `legalActions`. Copy `turn` verbatim. Never write a move for a
  seat that is not `awaitingSeat`.
- `thoughts` is shown on screen to the whole table. Say what actually drove the
  move — the humans use it to argue with you.
- You may hold up to 3 seats. `awaitingPersona.tier` is who to be this turn:
  `reckless` (instinct), `steady` (odds), `sharp` (reads the table).
- **You cannot see the shell order** — only the remaining count, the public
  live/blank composition, and the revealed spent tray. That is deliberate. Play
  the odds honestly.
"#;

pub struct SkillBundle {
    pub files: &'static [(&'static str, &'static str)],
    pub claude_md: &'static str,
}

pub const LASTSHELL_BUNDLE: SkillBundle = SkillBundle {
    files: &[("SKILL.md", SKILL_ROUTING)],
    claude_md: CLAUDE_MD,
};

fn bundle_root() -> PathBuf {
    crate::paths::user_path("skills-bundle/lastshell")
}

fn materialise_bundle(bundle: &SkillBundle) -> std::io::Result<PathBuf> {
    let root = bundle_root();
    fs::create_dir_all(&root)?;
    for (rel, contents) in bundle.files {
        fs::write(root.join(rel), contents)?;
    }
    Ok(root)
}

#[cfg(unix)]
fn ensure_symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    if link.exists() || link.symlink_metadata().is_ok() {
        let is_real_dir = fs::symlink_metadata(link)
            .map(|m| !m.file_type().is_symlink())
            .unwrap_or(false);
        if link.is_dir() && is_real_dir {
            fs::remove_dir_all(link)?;
        } else {
            fs::remove_file(link).or_else(|_| fs::remove_dir_all(link))?;
        }
    }
    if let Some(parent) = link.parent() {
        fs::create_dir_all(parent)?;
    }
    std::os::unix::fs::symlink(target, link)
}

#[cfg(not(unix))]
fn ensure_symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    if let Some(parent) = link.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::create_dir_all(link)?;
    for entry in fs::read_dir(target)? {
        let entry = entry?;
        fs::copy(entry.path(), link.join(entry.file_name()))?;
    }
    Ok(())
}

/// Install the bundle for `project_path`: shared bundle + symlink + CLAUDE.md.
pub fn write(project_path: &Path, bundle: &SkillBundle) -> std::io::Result<()> {
    let bundle_dir = materialise_bundle(bundle)?;
    let link = project_path.join(".claude").join("skills").join("lastshell");
    ensure_symlink(&bundle_dir, &link)?;
    fs::write(project_path.join("CLAUDE.md"), bundle.claude_md)?;
    Ok(())
}

#[tauri::command]
pub fn skill_install(project: String) -> Result<(), String> {
    write(Path::new(&project), &LASTSHELL_BUNDLE).map_err(|e| format!("install skill: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn skill_md_is_embedded_and_mentions_the_protocol() {
        assert!(SKILL_ROUTING.contains("moves.json"));
        assert!(SKILL_ROUTING.contains("game-state.json"));
        // the three personas must be documented
        assert!(SKILL_ROUTING.contains("reckless"));
        assert!(SKILL_ROUTING.contains("steady"));
        assert!(SKILL_ROUTING.contains("sharp"));
    }

    #[test]
    fn claude_md_warns_against_moving_for_humans() {
        assert!(CLAUDE_MD.contains("never") || CLAUDE_MD.contains("Never"));
        assert!(CLAUDE_MD.contains("awaitingSeat"));
    }

    #[test]
    fn write_creates_claude_md_and_a_skill_link() {
        let dir = tempdir().unwrap();
        write(dir.path(), &LASTSHELL_BUNDLE).unwrap();
        assert!(dir.path().join("CLAUDE.md").exists());
        let link = dir.path().join(".claude/skills/lastshell");
        assert!(link.exists(), "skill dir should exist");
        assert!(link.join("SKILL.md").exists(), "SKILL.md reachable via link");
    }
}
