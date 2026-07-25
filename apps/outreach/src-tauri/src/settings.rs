//! User-wide settings (small, JSON-on-disk).
//!
//! Lives at `~/.outreach/settings.json`. Only thing in v1 is the
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
    /// Free-text command used to launch the agent in new terminals. When
    /// set (non-empty), it OVERRIDES `default_agent` / `skip_permissions`
    /// entirely — the string is run verbatim before the interactive shell,
    /// so the user can launch any agent in any mode (e.g.
    /// `claude --dangerously-skip-permissions`). Empty/None falls back to
    /// the built-in `default_agent` launcher.
    #[serde(default)]
    pub agent_starting_command: Option<String>,
    /// Shared Postgres board URL. When set (non-empty), the board opens against
    /// this database instead of the local SQLite `board.db` — enabling a
    /// multi-user shared board. Empty/None = local-first (default).
    #[serde(default)]
    pub database_url: Option<String>,
    /// This user's display name, used as the board actor (who did what). When
    /// unset, the board falls back to the built-in `"You"` actor.
    #[serde(default)]
    pub actor_name: Option<String>,
}

fn path() -> PathBuf {
    crate::paths::user_path("settings.json")
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

/// The user's verbatim agent launch command, if set and non-empty.
pub fn agent_starting_command() -> Option<String> {
    load()
        .agent_starting_command
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
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

#[tauri::command]
pub fn set_agent_starting_command(command: Option<String>) -> Result<(), String> {
    let mut s = load();
    s.agent_starting_command = command;
    save(&s)
}

/// Normalise a pasted DB URL into just the connection string.
///
/// Users often paste a whole `.env` line — e.g.
/// `DATABASE_URL_UNPOOLED=postgresql://…` — and the leading `KEY=` prefix
/// must not become part of the stored value. Strip a single leading
/// `IDENT=` prefix (an all-caps/underscore/digit identifier followed by `=`),
/// then trim surrounding whitespace and matching quotes. Returns `None` for an
/// empty result. A real URL (`postgresql://…`) has no such prefix, so it's left
/// untouched.
pub fn normalize_db_url(raw: &str) -> Option<String> {
    let mut v = raw.trim();
    if let Some((key, rest)) = v.split_once('=') {
        let looks_like_env_key = !key.is_empty()
            && key
                .chars()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_');
        if looks_like_env_key {
            v = rest.trim();
        }
    }
    let v = v.trim_matches(|c| c == '"' || c == '\'').trim();
    if v.is_empty() {
        None
    } else {
        Some(v.to_string())
    }
}

#[tauri::command]
pub fn set_database_url(url: String) -> Result<(), String> {
    let mut s = load();
    s.database_url = normalize_db_url(&url);
    save(&s)
}

#[tauri::command]
pub fn set_actor_name(name: String) -> Result<(), String> {
    let mut s = load();
    s.actor_name = if name.trim().is_empty() { None } else { Some(name.trim().to_string()) };
    save(&s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_roundtrip_db_url_and_actor() {
        let s = Settings {
            database_url: Some("postgres://x".into()),
            actor_name: Some("Ada".into()),
            ..Default::default()
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.database_url.as_deref(), Some("postgres://x"));
        assert_eq!(back.actor_name.as_deref(), Some("Ada"));
    }

    #[test]
    fn normalize_strips_env_key_prefix() {
        assert_eq!(
            normalize_db_url("DATABASE_URL_UNPOOLED=postgresql://u:p@h/db?sslmode=require"),
            Some("postgresql://u:p@h/db?sslmode=require".to_string()),
        );
        assert_eq!(
            normalize_db_url("DATABASE_URL=postgresql://h/db"),
            Some("postgresql://h/db".to_string()),
        );
    }

    #[test]
    fn normalize_leaves_a_bare_url_untouched() {
        // A real connection string has no leading IDENT= prefix; the `=` inside
        // a query string must not be mistaken for one.
        let url = "postgresql://u:p@h/db?sslmode=require&x=1";
        assert_eq!(normalize_db_url(url), Some(url.to_string()));
    }

    #[test]
    fn normalize_trims_whitespace_and_quotes_and_empties() {
        assert_eq!(
            normalize_db_url("  \"postgresql://h/db\"  "),
            Some("postgresql://h/db".to_string()),
        );
        assert_eq!(normalize_db_url("   "), None);
        assert_eq!(normalize_db_url("DATABASE_URL="), None);
    }
}
