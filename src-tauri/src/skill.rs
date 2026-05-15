//! Per-project agent skill: writes skill.md and rc.zsh into
//! <project>/.kinetic-studio/ on every project_open and
//! projects_create. Idempotent overwrite keeps the skill in sync if
//! the studio binary updates.

use std::fs;
use std::path::Path;

pub const SKILL_TEMPLATE: &str = include_str!("../templates/skill.md");
pub const RC_ZSH: &str = include_str!("../templates/rc.zsh");

pub fn write(project_path: &Path) -> std::io::Result<()> {
    let meta_dir = project_path.join(".kinetic-studio");
    fs::create_dir_all(&meta_dir)?;
    fs::write(meta_dir.join("skill.md"), SKILL_TEMPLATE)?;
    fs::write(meta_dir.join("rc.zsh"), RC_ZSH)?;
    Ok(())
}
