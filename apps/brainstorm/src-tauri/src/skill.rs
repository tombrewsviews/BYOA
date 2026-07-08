//! Per-project agent skill installer for standalone Brainstorm.
//!
//! Materialises Brainstorm's SKILL.md into a shared per-user bundle
//! (`~/.brainstorm/skills-bundle/brainstorm/`), symlinks it into the
//! project's `.claude/skills/brainstorm/`, and writes the project-root
//! CLAUDE.md that points the agent at it. The symlink means a Brainstorm
//! update propagates to every existing project on next open without
//! rewriting per-project files.

use std::fs;
use std::path::{Path, PathBuf};

const SKILL_ROUTING: &str = include_str!("../skills/brainstorm/SKILL.md");

const CLAUDE_MD: &str = r#"# Brainstorm Canvas project

You are inside a Brainstorm Canvas desktop-editor project — a live Excalidraw
board you share with a human collaborator. **The agent operating manual is at
`.claude/skills/brainstorm/SKILL.md`** — read it first.

Short version:

- The board is live and shared. Use the `excalidraw` MCP (enabled by default in
  this project) to SEE it (`describe_scene`, `get_canvas_screenshot`) and to
  DRAW on it (`create_element`, `update_element`, …).
- Two modes: **prompted** (act when the user asks; drawing is allowed) and
  **continuous/watch** (observe + suggest only; do NOT modify the canvas; reply
  `NOTHING_TO_ADD` if you have nothing useful to say).
- `board.json` is only a seed marker — the live scene lives in the canvas
  server, not this file. Don't treat it as the document.
"#;

/// What Brainstorm ships as its agent skill bundle.
pub struct SkillBundle {
    /// (relative path, file contents) pairs. SKILL.md is first by convention.
    pub files: &'static [(&'static str, &'static str)],
    /// Per-project CLAUDE.md content pointing at the bundle.
    pub claude_md: &'static str,
}

pub const BRAINSTORM_BUNDLE: SkillBundle = SkillBundle {
    files: &[("SKILL.md", SKILL_ROUTING)],
    claude_md: CLAUDE_MD,
};

fn bundle_root() -> PathBuf {
    crate::paths::user_path("skills-bundle/brainstorm")
}

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
    if link.exists() || link.symlink_metadata().is_ok() {
        if link.is_dir()
            && fs::symlink_metadata(link)
                .map(|m| !m.file_type().is_symlink())
                .unwrap_or(false)
        {
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

/// Install the skill bundle for `project_path`: shared bundle + project symlink
/// + project-root CLAUDE.md.
pub fn write(project_path: &Path, bundle: &SkillBundle) -> std::io::Result<()> {
    let bundle_dir = materialise_bundle(bundle)?;
    let skill_link = project_path.join(".claude").join("skills").join("brainstorm");
    ensure_symlink(&bundle_dir, &skill_link)?;
    fs::write(project_path.join("CLAUDE.md"), bundle.claude_md)?;
    Ok(())
}
