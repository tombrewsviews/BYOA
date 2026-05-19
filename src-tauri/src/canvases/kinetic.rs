//! Kinetic canvas's agent skill bundle.
//!
//! Pulls the markdown files from src-tauri/skills/kinetic/ at
//! compile time and pairs them with the per-project CLAUDE.md
//! that lives at project root.

use crate::skill::SkillBundle;

const SKILL_ROUTING:    &str = include_str!("../../skills/kinetic/SKILL.md");
const SKILL_TYPOGRAPHY: &str = include_str!("../../skills/kinetic/typography-system.md");
const SKILL_MOTION:     &str = include_str!("../../skills/kinetic/motion-design.md");
const SKILL_COLOR:      &str = include_str!("../../skills/kinetic/color-system.md");
const SKILL_RENDER:     &str = include_str!("../../skills/kinetic/render-pipeline.md");
const SKILL_LAYERS:     &str = include_str!("../../skills/kinetic/layer-composition.md");

const CLAUDE_MD: &str = r#"# Kinetic Studio project

You are inside a Kinetic Studio desktop-editor project. **The agent
operating manual is at `.claude/skills/kinetic-studio/SKILL.md`** —
read it first. The skill has sibling files for typography, motion,
color, render, and layer-composition concerns; load whichever the
user's request maps to.

Short version:

- The only file you should edit is `./story.json`.
- Do NOT create new `.tsx` / `.jsx` Remotion components — the studio's
  composition is fixed and renders `story.json`.
- The Player and Timeline auto-refresh within ~300 ms of every write.
- Do not invoke `remotion-best-practices`, `superpowers:*`, or
  general Remotion skills here.

If `.claude/skills/kinetic-studio/SKILL.md` does not exist, ask the
user to reopen the project in Kinetic Studio (the studio writes the
skill on project open).
"#;

pub const BUNDLE: SkillBundle = SkillBundle {
    canvas_id: "kinetic-studio",
    files: &[
        ("SKILL.md",              SKILL_ROUTING),
        ("typography-system.md",  SKILL_TYPOGRAPHY),
        ("motion-design.md",      SKILL_MOTION),
        ("color-system.md",       SKILL_COLOR),
        ("render-pipeline.md",    SKILL_RENDER),
        ("layer-composition.md",  SKILL_LAYERS),
    ],
    claude_md: CLAUDE_MD,
};
