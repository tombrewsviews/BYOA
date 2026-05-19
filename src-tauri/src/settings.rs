//! User-wide settings (small, JSON-on-disk).
//!
//! Lives at `~/.kinetic-studio/settings.json`. Only thing in v1 is the
//! default agent CLI to spawn in the terminal panel. Plain JSON because
//! the file is tiny and we'd rather not add a TOML dependency for two
//! fields.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::agents::AgentKind;

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Agent id (see `AgentKind::id`) to spawn in new terminals. If
    /// None or unrecognised, the terminal falls back to a plain shell
    /// so the user can still type their own commands.
    pub default_agent: Option<String>,
    /// True once the user has dismissed the first-run agent picker.
    pub onboarded: bool,
    /// If true, the agent is launched with whatever per-agent flag
    /// skips its interactive permission prompts (Claude:
    /// `--dangerously-skip-permissions`, Codex: `--full-auto`,
    /// Gemini: `--yolo`). Pure convenience — the agent still runs
    /// against the user's home credentials and the project CWD;
    /// nothing in the studio escalates beyond that.
    #[serde(default)]
    pub skip_permissions: bool,
}

fn path() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".kinetic-studio").join("settings.json"))
        .unwrap_or_else(|| PathBuf::from(".kinetic-studio/settings.json"))
}

pub fn load() -> Settings {
    fs::read_to_string(path())
        .ok()
        .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
        .unwrap_or_default()
}

fn save(s: &Settings) -> Result<(), String> {
    let p = path();
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {}", e))?;
    }
    let json = serde_json::to_string_pretty(s).map_err(|e| format!("serialize: {}", e))?;
    fs::write(&p, json).map_err(|e| format!("write: {}", e))
}

/// Returns the configured agent if it's a recognised id, otherwise None.
pub fn default_agent() -> Option<AgentKind> {
    load().default_agent.as_deref().and_then(AgentKind::from_id)
}

pub fn skip_permissions() -> bool {
    load().skip_permissions
}

#[tauri::command]
pub fn get_settings() -> Settings {
    load()
}

#[tauri::command]
pub fn set_default_agent(agent: Option<String>) -> Result<(), String> {
    if let Some(id) = &agent {
        if AgentKind::from_id(id).is_none() {
            return Err(format!("unknown agent id: {}", id));
        }
    }
    let mut s = load();
    s.default_agent = agent;
    s.onboarded = true;
    save(&s)
}

#[tauri::command]
pub fn set_skip_permissions(skip: bool) -> Result<(), String> {
    let mut s = load();
    s.skip_permissions = skip;
    save(&s)
}
