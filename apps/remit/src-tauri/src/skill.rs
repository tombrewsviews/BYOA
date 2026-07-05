//! Per-project agent skill installer for standalone Remit.
//!
//! Materialises Remit's SKILL.md into a shared per-user bundle
//! (`~/.remit/skills-bundle/remit/`), symlinks it into the project's
//! `.claude/skills/remit/`, and writes the project-root `CLAUDE.md` that
//! points the agent at it. The symlink means a Remit update propagates to
//! every existing project on next open without rewriting per-project files.

use std::fs;
use std::path::{Path, PathBuf};

const SKILL_ROUTING: &str = include_str!("../skills/remit/SKILL.md");

const CLAUDE_MD: &str = r#"# Remit project

You are inside a Remit project — a bank-transfer form filler for the Maybank
remittance form. **The agent operating manual is at
`.claude/skills/remit/SKILL.md`** — read it first.

Short version:

- Edit `./remit.json` to set the per-transfer values (recipient, bank, amount,
  payment details, date). The fixed sender (Design Drives Growth Inc.) is baked
  into the app — you don't set it here.
- `senderAccount` is "MYR" or "USD" (which of the two sender accounts to debit).
- `amount.currency` "MYR" fills the "In RM" slot; anything else fills the
  "In Foreign Currency" slot. Only one is used.
- The user exports a filled page-1 PDF from the form panel; you just author the
  values in `remit.json`. Read it before editing so you build on the user's edits.
"#;

/// What Remit ships as its agent skill bundle.
pub struct SkillBundle {
    /// (relative path, file contents) pairs. SKILL.md is first by convention.
    pub files: &'static [(&'static str, &'static str)],
    /// Per-project CLAUDE.md content pointing at the bundle.
    pub claude_md: &'static str,
}

pub const REMIT_BUNDLE: SkillBundle = SkillBundle {
    files: &[("SKILL.md", SKILL_ROUTING)],
    claude_md: CLAUDE_MD,
};

fn bundle_root() -> PathBuf {
    crate::paths::user_path("skills-bundle/remit")
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
    let skill_link = project_path.join(".claude").join("skills").join("remit");
    ensure_symlink(&bundle_dir, &skill_link)?;
    fs::write(project_path.join("CLAUDE.md"), bundle.claude_md)?;
    Ok(())
}
