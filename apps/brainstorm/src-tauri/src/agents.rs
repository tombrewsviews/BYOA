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

fn which(binary: &str) -> Option<String> {
    // PATH lookup. We don't shell out to `which` to avoid spawning a
    // process per check; just walk $PATH and stat candidates.
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(binary);
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
