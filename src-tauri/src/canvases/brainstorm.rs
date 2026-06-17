//! Brainstorm Canvas's agent skill bundle.
//!
//! Mirrors the kinetic/pulse bundles: pulls the routing skill from
//! src-tauri/skills/brainstorm/ at compile time and pairs it with a
//! per-project CLAUDE.md pointing the agent at it. The canvas itself is a
//! live Excalidraw board served by a local canvas server; the agent reaches
//! it through the `excalidraw` MCP (seeded into the project's `.mcp.json`).

use crate::skill::SkillBundle;

const SKILL_ROUTING: &str = include_str!("../../skills/brainstorm/SKILL.md");

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

pub const BUNDLE: SkillBundle = SkillBundle {
    canvas_id: "brainstorm",
    files: &[("SKILL.md", SKILL_ROUTING)],
    claude_md: CLAUDE_MD,
};
