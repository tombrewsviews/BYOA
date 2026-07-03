//! Remit canvas's agent skill bundle. Mirrors the data/pulse bundles: pulls
//! the routing skill from src-tauri/skills/remit/ at compile time and pairs it
//! with a per-project CLAUDE.md pointing the agent at it.

use crate::skill::SkillBundle;

const SKILL_ROUTING: &str = include_str!("../../skills/remit/SKILL.md");

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

pub const BUNDLE: SkillBundle = SkillBundle {
    canvas_id: "remit",
    files: &[("SKILL.md", SKILL_ROUTING)],
    claude_md: CLAUDE_MD,
};
