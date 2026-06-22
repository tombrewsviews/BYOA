//! Data Explorer canvas's agent skill bundle. Mirrors the pulse bundle:
//! pulls the routing skill from src-tauri/skills/data/ at compile time and
//! pairs it with a per-project CLAUDE.md pointing the agent at it.

use crate::skill::SkillBundle;

const SKILL_ROUTING: &str = include_str!("../../skills/data/SKILL.md");

const CLAUDE_MD: &str = r#"# Data Explorer project

You are inside a DuckDB Data Explorer project — a live SQL + chart canvas.
**The agent operating manual is at `.claude/skills/data/SKILL.md`** — read it
first.

Short version:

- Edit `./query.json` to add sources and to write/refine the active cell's
  `sql` and `viz`. The canvas re-runs and re-renders.
- `viz.type` is one of table | bar | line | scatter; `x`/`y`/`color` are
  column names the SQL produces, or null.
- DuckDB SQL only; never INSTALL/LOAD remote extensions or hit the network.
- Read `query.json` before editing so you build on the user's edits.
"#;

pub const BUNDLE: SkillBundle = SkillBundle {
    canvas_id: "data",
    files: &[("SKILL.md", SKILL_ROUTING)],
    claude_md: CLAUDE_MD,
};
