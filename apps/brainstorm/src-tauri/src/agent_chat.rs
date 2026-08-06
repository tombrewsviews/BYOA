//! Agent-chat turn runner.
//!
//! Claude's structured-output mode (`claude -p --output-format stream-json`)
//! is ONE-SHOT: it reads the prompt (passed as a CLI argument), streams its
//! JSON event log to stdout, and exits. There is no persistent process and
//! no turn-by-turn stdin loop. So this module runs ONE turn per spawn:
//!   - The prompt is a positional arg in `SpawnArgs.args` (built by the TS
//!     adapter), so stdin is not used — we set it to null to avoid the
//!     "no stdin data received" warning claude prints when stdin is an
//!     open-but-empty pipe.
//!   - stdout carries the JSON event stream; stderr is a separate channel.
//!   - `agent-chat://{id}/closed` fires when the process exits — for a turn
//!     that is the NORMAL end of the turn, not an error.
//!
//! Conversation continuity across turns is the renderer's job: it generates
//! a session UUID, passes `--session-id <uuid>` on turn 1 and
//! `--resume <uuid>` on later turns. The Rust side is stateless about
//! conversation; it only tracks live turns so a running one can be cancelled
//! (the Stop button → `agent_chat_cancel`).
//!
//! Events:
//!   - `agent-chat://{id}/data`   — stdout chunks (UTF-8 lossy)
//!   - `agent-chat://{id}/stderr` — stderr chunks (UTF-8 lossy)
//!   - `agent-chat://{id}/closed` — fires once when the turn process exits
//!
//! TODO(robust-exit): there is no Drop impl on AgentChatTurn or AppState.
//! If the app exits mid-turn without `agent_chat_cancel`, the child is
//! reparented to init. Same gap exists in pty.rs. Fix by killing all
//! `state.agent_chats` entries on a Tauri window-close / app-exit hook.

use std::collections::HashMap;
use std::io::Read;
use std::process::{Child, ChildStderr, ChildStdout, Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::AppState;

/// A single in-flight turn process. Kept only so a running turn can be
/// cancelled; dropped from the map once the caller cancels.
pub struct AgentChatTurn {
    pub child: Mutex<Child>,
}

#[derive(Deserialize)]
pub struct SpawnArgs {
    pub cmd: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub cwd: String,
}

/// The PATH a login shell would give us, falling back to ours.
///
/// Asks the user's `$SHELL` for its interactive PATH (`-lic 'echo $PATH'`), so
/// whatever they've set up in ~/.zshrc — nvm, mise, asdf, a custom prefix —
/// is honoured rather than guessed at. The common install locations are
/// appended as a safety net for a shell that fails or is unusually minimal.
fn login_path() -> String {
    let mut parts: Vec<String> = Vec::new();

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    if let Ok(out) = Command::new(&shell).args(["-lic", "echo $PATH"]).output() {
        if out.status.success() {
            if let Ok(p) = String::from_utf8(out.stdout) {
                parts.extend(p.trim().split(':').filter(|s| !s.is_empty()).map(String::from));
            }
        }
    }

    parts.extend(std::env::var("PATH").unwrap_or_default().split(':').filter(|s| !s.is_empty()).map(String::from));

    if let Some(home) = std::env::var_os("HOME") {
        let home = home.to_string_lossy().to_string();
        parts.push(format!("{}/.local/bin", home));
        parts.push(format!("{}/.claude/local", home));
        parts.push(format!("{}/.bun/bin", home));
    }
    for p in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        parts.push(p.to_string());
    }

    // Preserve order, drop duplicates.
    let mut seen = std::collections::HashSet::new();
    parts.retain(|p| seen.insert(p.clone()));
    parts.join(":")
}

/// Turn a bare program name into an absolute path, searching `login_path()`.
///
/// Left untouched if it already contains a separator (an explicit path the
/// user configured) or if nothing matches — in the latter case the spawn still
/// fails, but with the original name in the error, which is clearer.
fn resolve_program(cmd: &str) -> String {
    if cmd.contains('/') {
        return cmd.to_string();
    }
    for dir in login_path().split(':') {
        let candidate = std::path::Path::new(dir).join(cmd);
        if candidate.is_file() {
            return candidate.to_string_lossy().to_string();
        }
    }
    cmd.to_string()
}

/// Pump bytes from a single stream into a named Tauri event channel,
/// coalescing within a tight window so floods don't drown the bus.
/// `closed_event` is emitted when the stream ends — pass `None` for
/// streams whose ending should not signal turn-end (e.g. stderr).
fn pump_stream<R: Read + Send + 'static>(
    app: AppHandle,
    mut reader: R,
    event_name: String,
    closed_event: Option<String>,
) {
    let (tx, rx) = mpsc::channel::<Vec<u8>>();

    thread::spawn(move || {
        let mut buf = [0u8; 16384];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    thread::spawn(move || {
        const FLUSH_WINDOW: Duration = Duration::from_micros(800);
        const FLUSH_BYTES: usize = 64 * 1024;
        let mut pending: Vec<u8> = Vec::with_capacity(FLUSH_BYTES);

        loop {
            let first = match rx.recv() {
                Ok(v) => v,
                Err(_) => break,
            };
            pending.clear();
            pending.extend_from_slice(&first);

            'coalesce: while pending.len() < FLUSH_BYTES {
                match rx.recv_timeout(FLUSH_WINDOW) {
                    Ok(v) => pending.extend_from_slice(&v),
                    Err(RecvTimeoutError::Timeout) => break 'coalesce,
                    Err(RecvTimeoutError::Disconnected) => {
                        let payload =
                            String::from_utf8_lossy(&pending).into_owned();
                        let _ = app.emit(&event_name, payload);
                        if let Some(name) = &closed_event {
                            let _ = app.emit(name, ());
                        }
                        return;
                    }
                }
            }

            let payload = String::from_utf8_lossy(&pending).into_owned();
            let _ = app.emit(&event_name, payload);
        }
        if let Some(name) = &closed_event {
            let _ = app.emit(name, ());
        }
    });
}

/// Spawn one turn. Returns a turn id used for the event channels and for
/// cancellation. The prompt is already inside `spawn.args` (final
/// positional arg), so stdin is set to null.
#[tauri::command]
pub fn agent_chat_run_turn(
    spawn: SpawnArgs,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    // Resolve the binary against the user's LOGIN shell PATH, not ours.
    //
    // A GUI-launched .app inherits a bare PATH from launchd
    // (/usr/bin:/bin:/usr/sbin:/sbin) — it never sources ~/.zshrc. Agent CLIs
    // are installed outside that set (claude lives in ~/.local/bin, homebrew in
    // /opt/homebrew/bin), so a bare `Command::new("claude")` fails with
    // "No such file or directory (os error 2)" even though it runs fine in the
    // embedded Terminal, which spawns $SHELL and thus gets the full profile.
    let resolved = resolve_program(&spawn.cmd);
    let mut cmd = Command::new(&resolved);
    cmd.args(&spawn.args);
    cmd.current_dir(&spawn.cwd);

    // Inherit env so the agent finds its auth (e.g. ~/.claude).
    for (k, v) in std::env::vars() {
        cmd.env(k, v);
    }
    // Give the child the enriched PATH too, so anything IT shells out to
    // (node, git, ripgrep) is findable for the same reason.
    cmd.env("PATH", login_path());
    for (k, v) in &spawn.env {
        cmd.env(k, v);
    }

    // Null stdin: the prompt is a CLI arg, and an open-but-empty stdin pipe
    // makes claude wait and print "no stdin data received in 3s".
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn {}: {}", spawn.cmd, e))?;

    let stdout: ChildStdout = child
        .stdout
        .take()
        .ok_or_else(|| "no stdout handle".to_string())?;
    let stderr: ChildStderr = child
        .stderr
        .take()
        .ok_or_else(|| "no stderr handle".to_string())?;

    let id = Uuid::new_v4().to_string();

    // stdout close → /closed event. The renderer treats /closed as the
    // normal end of a turn.
    pump_stream(
        app.clone(),
        stdout,
        format!("agent-chat://{}/data", id),
        Some(format!("agent-chat://{}/closed", id)),
    );

    pump_stream(
        app.clone(),
        stderr,
        format!("agent-chat://{}/stderr", id),
        None,
    );

    state.agent_chats.insert(
        id.clone(),
        AgentChatTurn {
            child: Mutex::new(child),
        },
    );

    // Reaper: poll for exit via try_wait so the child is reaped (no zombie)
    // and the live-turn entry is removed once the process finishes on its
    // own. Cancel races safely — whoever removes the entry first wins.
    spawn_reaper(app.clone(), id.clone());

    Ok(id)
}

/// Poll a turn's child for natural exit and remove it from the live map.
/// Avoids zombies for turns that complete without being cancelled.
fn spawn_reaper(app: AppHandle, id: String) {
    use tauri::Manager;
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(200));
        let state = app.state::<AppState>();
        let done = match state.agent_chats.get(&id) {
            Some(turn) => match turn.child.lock() {
                Ok(mut child) => matches!(child.try_wait(), Ok(Some(_))),
                Err(_) => true, // poisoned — give up reaping
            },
            None => true, // already removed (cancelled)
        };
        if done {
            state.agent_chats.remove(&id);
            return;
        }
    });
}

/// Cancel a running turn (the Stop button). Kills the child if still alive.
#[tauri::command]
pub fn agent_chat_cancel(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some((_, turn)) = state.agent_chats.remove(&id) {
        if let Ok(mut child) = turn.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_path_includes_common_install_dirs() {
        let p = login_path();
        // The fallbacks must always be present, even if the shell probe fails.
        assert!(p.contains("/usr/bin"), "missing /usr/bin in: {}", p);
        if std::env::var_os("HOME").is_some() {
            assert!(p.contains(".local/bin"), "missing ~/.local/bin in: {}", p);
        }
    }

    #[test]
    fn login_path_has_no_duplicates() {
        let p = login_path();
        let parts: Vec<&str> = p.split(':').collect();
        let mut seen = std::collections::HashSet::new();
        for part in &parts {
            assert!(seen.insert(*part), "duplicate PATH entry {:?} in: {}", part, p);
        }
    }

    #[test]
    fn resolve_program_leaves_explicit_paths_alone() {
        assert_eq!(resolve_program("/usr/bin/env"), "/usr/bin/env");
        assert_eq!(resolve_program("./local-agent"), "./local-agent");
    }

    #[test]
    fn resolve_program_finds_a_real_binary() {
        // `env` exists in /usr/bin on every unix; it must resolve absolutely.
        let got = resolve_program("env");
        assert!(got.starts_with('/'), "expected an absolute path, got {}", got);
        assert!(got.ends_with("/env"), "expected .../env, got {}", got);
    }

    #[test]
    fn resolve_program_returns_the_name_when_not_found() {
        // Falling back to the bare name keeps the spawn error readable.
        let name = "definitely-not-a-real-binary-xyz123";
        assert_eq!(resolve_program(name), name);
    }
}

