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
    let mut cmd = Command::new(&spawn.cmd);
    cmd.args(&spawn.args);
    cmd.current_dir(&spawn.cwd);

    // Inherit env so the agent finds its auth (e.g. ~/.claude).
    for (k, v) in std::env::vars() {
        cmd.env(k, v);
    }
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
