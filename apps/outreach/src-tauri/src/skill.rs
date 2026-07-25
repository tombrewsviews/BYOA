//! Per-project agent skill installer for standalone Outreach.
//!
//! Materialises Outreach's SKILL.md into a shared per-user bundle
//! (`~/.outreach/skills-bundle/outreach/`), symlinks it into the
//! project's `.claude/skills/outreach/`, writes the project-root CLAUDE.md
//! that points the agent at it, and registers the Outreach MCP server in the
//! project's `.mcp.json`. The symlink means an Outreach update propagates to
//! every existing project on next open without rewriting per-project files.

use std::fs;
use std::path::{Path, PathBuf};

const SKILL_ROUTING: &str = include_str!("../skills/outreach/SKILL.md");

const CLAUDE_MD: &str = r#"# Outreach board project

You are the agent for an **Outreach** lead board — a kanban of prospect cards you
operate through the `outreach` MCP (enabled in this project). **Read the operating
manual first: `.claude/skills/outreach/SKILL.md`.**

Short version: ingest pasted research, enrich leads additively (never clobber),
summarize transcripts, and propose card moves through the dryRun/confirm gates.
Never auto-send a message. Never lose a lead's history.
"#;

/// What Outreach ships as its agent skill bundle.
pub struct SkillBundle {
    /// (relative path, file contents) pairs. SKILL.md is first by convention.
    pub files: &'static [(&'static str, &'static str)],
    /// Per-project CLAUDE.md content pointing at the bundle.
    pub claude_md: &'static str,
}

pub const OUTREACH_BUNDLE: SkillBundle = SkillBundle {
    files: &[("SKILL.md", SKILL_ROUTING)],
    claude_md: CLAUDE_MD,
};

fn bundle_root() -> PathBuf {
    crate::paths::user_path("skills-bundle/outreach")
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

/// Resolve (mcp server.js, board-cli) absolute paths. Overridable via
/// OUTREACH_MCP_SERVER / OUTREACH_BOARD_CLI env (set by the bundled app's
/// launcher). Dev fallback: the paths in the repo/target tree relative to the
/// app. NOTE: bundle-mode resource resolution is finalized when the app is
/// packaged (see Task 6 / packaging); v1 relies on the env overrides or dev
/// paths for the end-to-end agent flow.
fn mcp_paths() -> (String, String) {
    let server = std::env::var("OUTREACH_MCP_SERVER").unwrap_or_else(|_| {
        // dev: built MCP bundle in the app tree
        "apps/outreach/mcp/dist/server.js".to_string()
    });
    let cli = std::env::var("OUTREACH_BOARD_CLI").unwrap_or_else(|_| {
        "board-cli".to_string() // dev: on PATH or resolved by the caller
    });
    (server, cli)
}

/// Build the `env` map for the `outreach` MCP server entry: always
/// `OUTREACH_PROJECT` + `BOARD_CLI`, plus `DATABASE_URL`/`OUTREACH_ACTOR` when
/// set (so board-cli shares the UI's board + actor). `actor_name` is the raw
/// display name — board-cli slugifies it itself. Omitting both when unset
/// keeps `.mcp.json` local-first: board-cli falls back to local SQLite + the
/// "local" actor.
fn mcp_env(
    project_dir: &Path,
    board_cli: &str,
    database_url: Option<&str>,
    actor_name: Option<&str>,
) -> serde_json::Map<String, serde_json::Value> {
    let mut env = serde_json::Map::new();
    env.insert(
        "OUTREACH_PROJECT".into(),
        project_dir.to_string_lossy().as_ref().into(),
    );
    env.insert("BOARD_CLI".into(), board_cli.into());

    if let Some(url) = database_url.filter(|u| !u.trim().is_empty()) {
        env.insert("DATABASE_URL".into(), url.into());
    }
    if let Some(name) = actor_name.filter(|n| !n.trim().is_empty()) {
        env.insert("OUTREACH_ACTOR".into(), name.into());
    }
    env
}

/// Register the outreach MCP server in the project's `.mcp.json` so the
/// terminal agent has the board verbs on open. Points at the built MCP server
/// (node dist/server.js) and passes the project dir + board-cli path via env,
/// plus the shared DB url + actor name when configured in Settings.
fn write_mcp_config(project_dir: &Path) -> std::io::Result<()> {
    let (server_js, board_cli) = mcp_paths();
    let s = crate::settings::load();
    let env = mcp_env(
        project_dir,
        &board_cli,
        s.database_url.as_deref(),
        s.actor_name.as_deref(),
    );
    let config = serde_json::json!({
        "mcpServers": {
            "outreach": {
                "command": "node",
                "args": [server_js],
                "env": serde_json::Value::Object(env)
            }
        }
    });
    std::fs::write(
        project_dir.join(".mcp.json"),
        serde_json::to_string_pretty(&config).unwrap(),
    )
}

/// Install the skill bundle for `project_path`: shared bundle + project symlink
/// + project-root CLAUDE.md + `.mcp.json` MCP registration.
pub fn write(project_path: &Path, bundle: &SkillBundle) -> std::io::Result<()> {
    let bundle_dir = materialise_bundle(bundle)?;
    let skill_link = project_path.join(".claude").join("skills").join("outreach");
    ensure_symlink(&bundle_dir, &skill_link)?;
    fs::write(project_path.join("CLAUDE.md"), bundle.claude_md)?;
    write_mcp_config(project_path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn write_mcp_config_registers_outreach_server_with_project_dir() {
        let dir = TempDir::new().unwrap();
        write_mcp_config(dir.path()).unwrap();
        let txt = fs::read_to_string(dir.path().join(".mcp.json")).unwrap();
        assert!(txt.contains("mcpServers"));
        assert!(txt.contains("\"outreach\""));
        assert!(txt.contains("OUTREACH_PROJECT"));
        assert!(txt.contains(&dir.path().to_string_lossy().to_string()));
    }

    #[test]
    fn outreach_bundle_starts_with_skill_md_and_encodes_lose_nothing() {
        assert_eq!(OUTREACH_BUNDLE.files[0].0, "SKILL.md");
        assert!(OUTREACH_BUNDLE.files[0].1.contains("lose nothing"));
    }

    #[test]
    fn mcp_env_includes_db_url_and_actor_when_set() {
        let e = mcp_env(Path::new("/p"), "cli", Some("postgres://x"), Some("Ada"));
        assert_eq!(e.get("DATABASE_URL").unwrap(), "postgres://x");
        assert_eq!(e.get("OUTREACH_ACTOR").unwrap(), "Ada");
        assert_eq!(e.get("OUTREACH_PROJECT").unwrap(), "/p");
    }

    #[test]
    fn mcp_env_omits_db_url_and_actor_when_unset() {
        let e = mcp_env(Path::new("/p"), "cli", None, None);
        assert!(e.get("DATABASE_URL").is_none());
        assert!(e.get("OUTREACH_ACTOR").is_none());
        assert!(e.get("OUTREACH_PROJECT").is_some());
    }
}
