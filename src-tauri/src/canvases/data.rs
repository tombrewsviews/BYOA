//! Data Explorer canvas's agent skill bundle. Mirrors the pulse bundle:
//! pulls the routing skill from src-tauri/skills/data/ at compile time and
//! pairs it with a per-project CLAUDE.md pointing the agent at it.

use crate::skill::SkillBundle;

const SKILL_ROUTING: &str = include_str!("../../skills/data/SKILL.md");

const CLAUDE_MD: &str = r#"# Lens project

You are inside a Lens project — a reactive data canvas with a node graph.
**The agent operating manual is at `.claude/skills/data/SKILL.md`** — read it
first.

Short version:

- Edit `./query.json` to compose a pipeline: source → SQL → semantic(AI) →
  chart nodes, wired by edges.
- SQL nodes reference upstreams via `{{nodeId}}` (the node's view) and MUST
  have an edge from that upstream.
- Semantic nodes run AI ops (classify, extract, filter, label) via the user's
  agent CLI; use `op`, `inputColumn`, `outputColumn`, `instruction`, `labels`,
  `sampleLimit`.
- Read `./.kinetic-studio/last_result.json` after each run to see every node's
  result (columns, rows, errors).
- DuckDB SQL only; never INSTALL/LOAD remote extensions or hit the network.
- Read `query.json` before editing so you build on the user's edits.
"#;

pub const BUNDLE: SkillBundle = SkillBundle {
    canvas_id: "data",
    files: &[("SKILL.md", SKILL_ROUTING)],
    claude_md: CLAUDE_MD,
};
