//! Agent CLI detection.
//!
//! The shell does not host an agent runtime — the user brings their own
//! CLI (Claude Code, Codex, Gemini CLI, opencode) authenticated against
//! their existing subscription. We detect what's on $PATH so the
//! first-run screen can show install instructions for the missing ones
//! and the agent-picker can grey out unavailable choices.
//!
//! Returned in a stable order so the frontend can render a fixed list.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AgentKind {
    Claude,
    Codex,
    Gemini,
    Opencode,
}

impl AgentKind {
    pub const ALL: [AgentKind; 4] = [
        AgentKind::Claude,
        AgentKind::Codex,
        AgentKind::Gemini,
        AgentKind::Opencode,
    ];

    pub fn binary(self) -> &'static str {
        match self {
            AgentKind::Claude => "claude",
            AgentKind::Codex => "codex",
            AgentKind::Gemini => "gemini",
            AgentKind::Opencode => "opencode",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            AgentKind::Claude => "Claude Code",
            AgentKind::Codex => "Codex",
            AgentKind::Gemini => "Gemini CLI",
            AgentKind::Opencode => "opencode",
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            AgentKind::Claude => "claude",
            AgentKind::Codex => "codex",
            AgentKind::Gemini => "gemini",
            AgentKind::Opencode => "opencode",
        }
    }

    pub fn install_hint(self) -> &'static str {
        match self {
            AgentKind::Claude => "npm install -g @anthropic-ai/claude-code",
            AgentKind::Codex => "npm install -g @openai/codex",
            AgentKind::Gemini => "npm install -g @google/gemini-cli",
            AgentKind::Opencode => "npm install -g opencode-ai",
        }
    }

    /// CLI flag that disables interactive permission prompts for this
    /// agent (the "let it run" mode). None if the agent doesn't have
    /// a stable equivalent — we won't fabricate one.
    pub fn skip_permissions_flag(self) -> Option<&'static str> {
        match self {
            AgentKind::Claude => Some("--dangerously-skip-permissions"),
            AgentKind::Codex => Some("--full-auto"),
            AgentKind::Gemini => Some("--yolo"),
            AgentKind::Opencode => None,
        }
    }

    /// Flag selecting this CLI's FASTEST model, so a seat answers in about the
    /// time a human takes to aim. A table is unplayable when every turn is a
    /// slow reasoning round-trip, and the game needs quick tactical calls rather
    /// than deep thought — the odds are simple arithmetic.
    ///
    /// None where the CLI has no stable model flag we can rely on; those launch
    /// with their own default rather than a guessed alias.
    pub fn fast_model_flag(self) -> Option<&'static str> {
        match self {
            // 'fable' is the speed tier and one of the aliases `claude --help`
            // documents; verified accepted against the installed CLI.
            AgentKind::Claude => Some("--model fable"),
            // NOT verified locally — neither CLI is installed here. Both flags
            // follow each tool's documented form; if one is wrong the CLI errors
            // on launch and the terminal shows it, rather than failing silently.
            AgentKind::Codex => Some("-m gpt-5-codex-mini"),
            AgentKind::Gemini => Some("-m gemini-2.5-flash"),
            AgentKind::Opencode => None,
        }
    }

    pub fn from_id(id: &str) -> Option<AgentKind> {
        AgentKind::ALL.into_iter().find(|a| a.id() == id)
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: &'static str,
    pub label: &'static str,
    pub binary: &'static str,
    pub install_hint: &'static str,
    pub installed: bool,
    pub path: Option<String>,
}

/// Where CLIs land when installed by the usual means. A GUI app launched from
/// Finder inherits almost no `$PATH` (`/usr/bin:/bin` and little else), so
/// walking only `$PATH` reports every agent as missing even when they are all
/// installed — which is exactly what happened. These are searched in addition.
fn extra_search_dirs() -> Vec<std::path::PathBuf> {
    let home = dirs::home_dir();
    let mut dirs_out: Vec<std::path::PathBuf> = vec![
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
        "/opt/local/bin".into(),
    ];
    if let Some(h) = home {
        for rel in [
            ".local/bin",           // claude's own installer, pipx, uv
            ".bun/bin",             // bun global
            ".cargo/bin",           // cargo install
            ".deno/bin",            // deno
            ".volta/bin",           // volta
            "Library/pnpm",         // pnpm global
            ".npm-global/bin",      // npm prefix override
            ".yarn/bin",            // yarn global
            ".nvm/current/bin",     // nvm's stable symlink, when present
        ] {
            dirs_out.push(h.join(rel));
        }
    }
    dirs_out
}

/// Absolute path to an agent's binary, if we can find one.
pub fn resolve_binary(kind: AgentKind) -> Option<String> {
    which(kind.binary())
}

fn which(binary: &str) -> Option<String> {
    // PATH lookup. We don't shell out to `which` to avoid spawning a process
    // per check; just walk $PATH and stat candidates, then the well-known
    // install dirs a Finder-launched app cannot see via $PATH.
    let from_path = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .unwrap_or_default();
    for dir in from_path.into_iter().chain(extra_search_dirs()) {
        let candidate = dir.join(binary);
        // is_file() follows symlinks, which is what we want: most of these are
        // symlinks into a version-managed store.
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
}

#[tauri::command]
pub fn detect_agents() -> Vec<AgentInfo> {
    AgentKind::ALL
        .iter()
        .map(|a| {
            let path = which(a.binary());
            AgentInfo {
                id: a.id(),
                label: a.label(),
                binary: a.binary(),
                install_hint: a.install_hint(),
                installed: path.is_some(),
                path,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn searches_beyond_path_so_a_finder_launch_still_finds_clis() {
        // A GUI app launched from Finder gets a bare PATH; regression for the
        // picker showing every agent as "not installed" while they were present.
        let dirs = extra_search_dirs();
        let home = dirs::home_dir().expect("home");
        assert!(dirs.contains(&home.join(".local/bin")), "~/.local/bin must be searched");
        assert!(dirs.iter().any(|d| d.ends_with("homebrew/bin")));
        assert!(dirs.iter().any(|d| d.ends_with("Library/pnpm")));
    }

    #[test]
    fn every_supported_cli_launches_on_its_fast_model() {
        // A table where each turn is a slow reasoning round-trip is unplayable,
        // so the CLIs that expose a model flag must default to their fast tier.
        assert_eq!(AgentKind::Claude.fast_model_flag(), Some("--model fable"));
        for k in [AgentKind::Codex, AgentKind::Gemini] {
            assert!(k.fast_model_flag().is_some(), "{} needs a fast model", k.id());
        }
        // opencode has no stable flag we rely on — better absent than invented
        assert_eq!(AgentKind::Opencode.fast_model_flag(), None);
    }

    #[test]
    fn ids_round_trip_through_from_id() {
        for k in AgentKind::ALL {
            assert_eq!(AgentKind::from_id(k.id()).map(|x| x.id()), Some(k.id()));
        }
        assert!(AgentKind::from_id("nope").is_none());
    }

    #[test]
    fn detect_returns_all_four_in_a_stable_order() {
        let found = detect_agents();
        assert_eq!(found.len(), 4);
        assert_eq!(
            found.iter().map(|a| a.id).collect::<Vec<_>>(),
            vec!["claude", "codex", "gemini", "opencode"]
        );
        // every entry claiming installed must carry a resolvable path
        for a in &found {
            assert_eq!(a.installed, a.path.is_some());
            if let Some(p) = &a.path {
                assert!(std::path::Path::new(p).is_file(), "{p} should exist");
            }
        }
    }
}
