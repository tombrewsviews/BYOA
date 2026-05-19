//! Agent-chat session manager.
//!
//! Unlike pty.rs, this module does NOT spawn an interactive login shell.
//! It runs the chosen agent binary directly with structured-output flags
//! (e.g. `claude --output-format stream-json --verbose`) and pipes
//! stdin/stdout. The renderer (per-agent TS adapter) does all parsing.
//!
//! Stdout is the primary stream — it carries the JSON event log the
//! adapter parses. Stderr is a SEPARATE channel
//! (`agent-chat://{id}/stderr`) so a stray warning doesn't corrupt a
//! JSON line on the data stream.
//!
//! Events:
//!   - `agent-chat://{id}/data`   — stdout chunks (UTF-8 lossy)
//!   - `agent-chat://{id}/stderr` — stderr chunks (UTF-8 lossy)
//!   - `agent-chat://{id}/closed` — fires once when stdout closes
//!
//! TODO(robust-exit): there is no Drop impl on AgentChatSession or
//! AppState. If the app exits without calling `agent_chat_close`
//! (force-quit, panic), the child agent process is reparented to init
//! and may keep running on the user's API account. Same gap exists in
//! pty.rs. Fix by killing all entries in `state.agent_chats` on a
//! Tauri window-close / app-exit hook.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Child, ChildStdin, ChildStderr, ChildStdout, Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::AppState;

pub struct AgentChatSession {
    pub child: Mutex<Child>,
    pub stdin: Mutex<Option<ChildStdin>>,
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
/// streams whose ending should not signal session close (e.g. stderr).
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
                        // Drain final batch, emit closed (if any), return.
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

#[tauri::command]
pub fn agent_chat_open(
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

    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn {}: {}", spawn.cmd, e))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "no stdin handle".to_string())?;
    let stdout: ChildStdout = child
        .stdout
        .take()
        .ok_or_else(|| "no stdout handle".to_string())?;
    let stderr: ChildStderr = child
        .stderr
        .take()
        .ok_or_else(|| "no stderr handle".to_string())?;

    let id = Uuid::new_v4().to_string();

    // stdout — primary stream; its close signals session close.
    pump_stream(
        app.clone(),
        stdout,
        format!("agent-chat://{}/data", id),
        Some(format!("agent-chat://{}/closed", id)),
    );

    // stderr — separate channel; ending it does NOT signal close.
    pump_stream(
        app.clone(),
        stderr,
        format!("agent-chat://{}/stderr", id),
        None,
    );

    let session = AgentChatSession {
        child: Mutex::new(child),
        stdin: Mutex::new(Some(stdin)),
    };
    state.agent_chats.insert(id.clone(), session);
    Ok(id)
}

#[tauri::command]
pub fn agent_chat_write(
    id: String,
    data: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = state
        .agent_chats
        .get(&id)
        .ok_or_else(|| "session not found".to_string())?;
    let mut guard = session.stdin.lock().map_err(|e| e.to_string())?;
    let stdin = guard
        .as_mut()
        .ok_or_else(|| "stdin already closed".to_string())?;
    stdin.write_all(&data).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_chat_close(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some((_, session)) = state.agent_chats.remove(&id) {
        if let Ok(mut g) = session.stdin.lock() {
            g.take(); // dropping ChildStdin closes the pipe
        }
        if let Ok(mut child) = session.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    Ok(())
}
