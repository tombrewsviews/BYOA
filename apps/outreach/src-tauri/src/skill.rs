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

use tauri::AppHandle;

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

/// Resolve the three things the `.mcp.json` command line needs, as ABSOLUTE
/// paths wherever possible: (node binary, bundled server.js, board-cli binary).
///
/// The external agent CLI launches `node server.js` in a minimal, Finder-style
/// environment, so bare names ("node", relative "server.js") don't resolve in a
/// packaged app. We resolve each against the running app:
/// - **server.js:** `<resource_dir>/mcp/server.bundle.js` when packaged (the
///   Tauri `bundle.resources` entry), else the dev bundle in the repo tree.
/// - **board-cli:** a sibling of the running executable (`Contents/MacOS/` in the
///   `.app`, the target dir in dev), else bare `board-cli`.
/// - **node:** the first existing candidate among common install locations
///   (Homebrew, /usr/local, system), else bare `node`.
/// Env overrides (`OUTREACH_MCP_SERVER` / `OUTREACH_BOARD_CLI` / `OUTREACH_NODE`)
/// win when set, for dev and troubleshooting.
fn mcp_paths(app: Option<&AppHandle>) -> (String, String, String) {
    let node = std::env::var("OUTREACH_NODE").unwrap_or_else(|_| resolve_node());
    let server = std::env::var("OUTREACH_MCP_SERVER").unwrap_or_else(|_| resolve_server_js(app));
    let cli = std::env::var("OUTREACH_BOARD_CLI").unwrap_or_else(|_| resolve_board_cli());
    (node, server, cli)
}

/// The bundled MCP server. Packaged: `<resource_dir>/mcp/server.bundle.js`.
/// Dev fallback: the built bundle relative to the repo working dir.
fn resolve_server_js(app: Option<&AppHandle>) -> String {
    use tauri::Manager;
    if let Some(app) = app {
        if let Ok(res) = app.path().resource_dir() {
            let p = res.join("mcp").join("server.bundle.js");
            if p.exists() {
                return p.to_string_lossy().into_owned();
            }
        }
    }
    "apps/outreach/mcp/dist/server.bundle.js".to_string()
}

/// The `board-cli` binary. It sits beside the running executable in both the
/// packaged app (`Outreach.app/Contents/MacOS/board-cli`) and the dev target
/// dir. Falls back to bare `board-cli` (PATH) if the sibling isn't found.
fn resolve_board_cli() -> String {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("board-cli");
            if p.exists() {
                return p.to_string_lossy().into_owned();
            }
        }
    }
    "board-cli".to_string()
}

/// Find a `node` binary. A Finder-launched app has a minimal PATH that often
/// excludes Homebrew/nvm, so we probe the common absolute install locations
/// before giving up on bare `node`.
fn resolve_node() -> String {
    const CANDIDATES: &[&str] = &[
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ];
    for c in CANDIDATES {
        if Path::new(c).exists() {
            return c.to_string();
        }
    }
    "node".to_string()
}

/// Build the `env` map for the `outreach` MCP server entry: always
/// `OUTREACH_PROJECT` + `BOARD_CLI` only. The shared DB URL and actor name are
/// deliberately NOT written here: board-cli runs on this machine and reads them
/// from the app's settings store directly, so a live Postgres credential never
/// lands in plaintext in a per-board `.mcp.json`. Local-first still holds — with
/// no DB URL configured, board-cli falls back to local SQLite.
fn mcp_env(project_dir: &Path, board_cli: &str) -> serde_json::Map<String, serde_json::Value> {
    let mut env = serde_json::Map::new();
    env.insert(
        "OUTREACH_PROJECT".into(),
        project_dir.to_string_lossy().as_ref().into(),
    );
    env.insert("BOARD_CLI".into(), board_cli.into());
    env
}

/// Register the outreach MCP server in the project's `.mcp.json` so the
/// terminal agent has the board verbs on open. Writes ABSOLUTE paths (resolved
/// against the running app) for the node binary, the bundled server, and
/// board-cli, so the config works when the agent CLI launches it from a
/// minimal, Finder-style environment.
fn write_mcp_config(project_dir: &Path, app: Option<&AppHandle>) -> std::io::Result<()> {
    let (node, server_js, board_cli) = mcp_paths(app);
    let env = mcp_env(project_dir, &board_cli);
    let config = serde_json::json!({
        "mcpServers": {
            "outreach": {
                "command": node,
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
/// + project-root CLAUDE.md + `.mcp.json` MCP registration. `app` is the running
/// Tauri handle, used to resolve the bundled MCP server's absolute path; pass
/// `None` only where no handle is available (falls back to dev paths).
pub fn write(
    project_path: &Path,
    bundle: &SkillBundle,
    app: Option<&AppHandle>,
) -> std::io::Result<()> {
    let bundle_dir = materialise_bundle(bundle)?;
    let skill_link = project_path.join(".claude").join("skills").join("outreach");
    ensure_symlink(&bundle_dir, &skill_link)?;
    fs::write(project_path.join("CLAUDE.md"), bundle.claude_md)?;
    write_mcp_config(project_path, app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn write_mcp_config_registers_outreach_server_with_project_dir() {
        let dir = TempDir::new().unwrap();
        write_mcp_config(dir.path(), None).unwrap();
        let txt = fs::read_to_string(dir.path().join(".mcp.json")).unwrap();
        assert!(txt.contains("mcpServers"));
        assert!(txt.contains("\"outreach\""));
        assert!(txt.contains("OUTREACH_PROJECT"));
        assert!(txt.contains(&dir.path().to_string_lossy().to_string()));
    }

    #[test]
    fn mcp_paths_honors_env_overrides() {
        // Overrides are the deterministic, dev/troubleshooting path — assert they
        // flow through verbatim. (Uses set_var in a single-threaded unit test.)
        std::env::set_var("OUTREACH_NODE", "/x/node");
        std::env::set_var("OUTREACH_MCP_SERVER", "/x/server.js");
        std::env::set_var("OUTREACH_BOARD_CLI", "/x/board-cli");
        let (node, server, cli) = mcp_paths(None);
        assert_eq!(node, "/x/node");
        assert_eq!(server, "/x/server.js");
        assert_eq!(cli, "/x/board-cli");
        std::env::remove_var("OUTREACH_NODE");
        std::env::remove_var("OUTREACH_MCP_SERVER");
        std::env::remove_var("OUTREACH_BOARD_CLI");
    }

    #[test]
    fn resolve_node_falls_back_to_bare_node() {
        // Without an override and with no candidate guaranteed to exist in CI, the
        // result is either an absolute candidate path or the bare "node" fallback.
        let n = resolve_node();
        assert!(n == "node" || Path::new(&n).is_absolute());
    }

    #[test]
    fn outreach_bundle_starts_with_skill_md_and_encodes_lose_nothing() {
        assert_eq!(OUTREACH_BUNDLE.files[0].0, "SKILL.md");
        assert!(OUTREACH_BUNDLE.files[0].1.contains("lose nothing"));
    }

    #[test]
    fn mcp_env_has_only_project_and_cli() {
        let e = mcp_env(Path::new("/p"), "cli");
        assert_eq!(e.get("OUTREACH_PROJECT").unwrap(), "/p");
        assert_eq!(e.get("BOARD_CLI").unwrap(), "cli");
        assert_eq!(e.len(), 2);
    }

    #[test]
    fn mcp_env_never_contains_the_secret() {
        // The DB URL and actor must never be written into .mcp.json — board-cli
        // reads them from the app's settings store, not this file.
        let e = mcp_env(Path::new("/p"), "cli");
        assert!(e.get("DATABASE_URL").is_none());
        assert!(e.get("OUTREACH_ACTOR").is_none());
    }
}
