//! Generic per-project agent skill installer.
//!
//! The shell stays canvas-agnostic. Each canvas plugin owns a
//! `SkillBundle` describing what to ship (canvas id, file payloads,
//! project-root `CLAUDE.md`). The installer takes one and:
//!
//!   1. Materialises the bundle's files into a single shared location
//!      at `~/.kinetic-studio/skills-bundle/kinetic/` — overwriting it
//!      so app updates roll out automatically. (The `kinetic` segment
//!      is the studio's per-user namespace, not the canvas id.)
//!
//!   2. Symlinks the project's `.claude/skills/<canvas_id>/` at the
//!      shared bundle. Claude Code resolves the symlink and auto-
//!      discovers the SKILL.md + sibling .md files inside.
//!
//!   3. Writes the bundle's project-root `CLAUDE.md` (Claude Code
//!      unconditionally loads CLAUDE.md from CWD; this is belt-and-
//!      braces in case the skills directory isn't picked up).
//!
//!   4. Keeps the legacy `.kinetic-studio/skill.md` + `rc.zsh` for
//!      backwards compatibility with terminals that source rc.zsh.
//!
//! The symlink approach means an app update with new skill content
//! propagates to every existing project on next launch, without
//! rewriting per-project files.

use std::fs;
use std::path::{Path, PathBuf};

const RC_ZSH: &str = include_str!("../templates/rc.zsh");

/// What a canvas plugin ships as its agent skill bundle. The shell's
/// skill installer is generic over this; each canvas plugin owns
/// one. All paths are relative to the per-canvas skills-bundle
/// directory; SKILL.md is conventionally first.
pub struct SkillBundle {
    /// Canvas id (used in the on-disk path layout).
    pub canvas_id: &'static str,
    /// (relative path, file contents) pairs.
    pub files: &'static [(&'static str, &'static str)],
    /// The per-project CLAUDE.md content that points at this bundle.
    pub claude_md: &'static str,
}

fn bundle_root() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".kinetic-studio").join("skills-bundle").join("kinetic"))
        .unwrap_or_else(|| PathBuf::from(".kinetic-studio/skills-bundle/kinetic"))
}

/// Materialise the bundled skill files into the shared per-user
/// directory. Idempotent — overwrites every time so app updates land.
fn materialise_bundle(bundle: &SkillBundle) -> std::io::Result<PathBuf> {
    let root = bundle_root();
    fs::create_dir_all(&root)?;
    for (rel_path, contents) in bundle.files {
        fs::write(root.join(rel_path), contents)?;
    }
    Ok(root)
}

#[cfg(unix)]
fn ensure_symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    // Replace whatever is there (stale symlink, copy from a previous
    // app version, etc) with a fresh symlink at `link` pointing to
    // `target`.
    if link.exists() || link.symlink_metadata().is_ok() {
        // remove_dir_all handles both real dirs and symlinks-to-dirs
        // on macOS / Linux; for a broken symlink, remove_file works.
        if link.is_dir() && fs::symlink_metadata(link).map(|m| !m.file_type().is_symlink()).unwrap_or(false) {
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
    // Windows fallback: copy the bundle contents. Real symlinks need
    // admin or developer-mode, which is a worse default for the
    // mainstream user. v1 is macOS-only anyway (see spec).
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

pub fn write(project_path: &Path, bundle: &SkillBundle) -> std::io::Result<()> {
    // 1. ensure the shared bundle is fresh
    let bundle_dir = materialise_bundle(bundle)?;

    // 2. symlink it into the project's .claude/skills/<canvas_id>
    let skill_link = project_path
        .join(".claude")
        .join("skills")
        .join(bundle.canvas_id);
    ensure_symlink(&bundle_dir, &skill_link)?;

    // 3. project-root CLAUDE.md pointer
    fs::write(project_path.join("CLAUDE.md"), bundle.claude_md)?;

    // 4. legacy / rc.zsh path. We copy the routing skill here (not the
    //    whole bundle) since the rc.zsh alias loads exactly this file
    //    into --append-system-prompt. By convention SKILL.md is the
    //    first entry in `bundle.files`.
    let meta_dir = project_path.join(".kinetic-studio");
    fs::create_dir_all(&meta_dir)?;
    if let Some((_, routing)) = bundle.files.first() {
        fs::write(meta_dir.join("skill.md"), routing)?;
    }
    fs::write(meta_dir.join("rc.zsh"), RC_ZSH)?;

    Ok(())
}
