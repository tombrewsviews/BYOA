//! Pulse (music-visualizer) canvas's agent skill bundle.
//!
//! Mirrors the kinetic bundle: pulls the routing skill from
//! src-tauri/skills/pulse/ at compile time and pairs it with a
//! per-project CLAUDE.md pointing the agent at it.

use crate::skill::SkillBundle;

const SKILL_ROUTING: &str = include_str!("../../skills/pulse/SKILL.md");

const CLAUDE_MD: &str = r#"# Pulse project

You are inside a Pulse desktop-editor project — a live music visualizer.
**The agent operating manual is at `.claude/skills/pulse/SKILL.md`** —
read it first.

Short version:

- Edit `./project.json` for stems, effect stacks, bindings, and mix state.
- Edit/create shaders under `src/pulse/effects/<name>/` (in the app repo)
  for new visual behaviors; register them in `registry.ts`. Vite HMR
  reloads them live.
- NEVER edit `analysis.json` — it is the immutable analyzed timeline.
- Preserve bindings marked `"locked": true`. Author the next look in
  deck `B`; the user releases it onto live deck `A`.
"#;

pub const BUNDLE: SkillBundle = SkillBundle {
    canvas_id: "pulse",
    files: &[("SKILL.md", SKILL_ROUTING)],
    claude_md: CLAUDE_MD,
};
