//! Agent-chat session manager.
//!
//! Unlike pty.rs, this module does NOT spawn an interactive login shell.
//! It runs the chosen agent binary directly with structured-output flags
//! (e.g. `claude --output-format stream-json --verbose`) and pipes
//! stdin/stdout. The renderer (per-agent TS adapter) does all parsing.
//!
//! Event channel: `agent-chat://{id}/data` carries raw stdout bytes
//! coalesced with the same strategy as pty.rs. `agent-chat://{id}/closed`
//! fires once when the process exits.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Mutex};
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
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "no stdout handle".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "no stderr handle".to_string())?;

    let id = Uuid::new_v4().to_string();

    let (tx, rx) = mpsc::channel::<Vec<u8>>();

    // stdout reader
    {
        let tx = tx.clone();
        let mut stdout = stdout;
        thread::spawn(move || {
            let mut buf = [0u8; 16384];
            loop {
                match stdout.read(&mut buf) {
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
    }

    // stderr reader — multiplex into the same channel.
    // The renderer-side adapter treats stderr lines as junk and emits
    // recoverable error events. Keeping stderr visible aids debugging.
    {
        let tx = tx.clone();
        let mut stderr = stderr;
        thread::spawn(move || {
            let mut buf = [0u8; 16384];
            loop {
                match stderr.read(&mut buf) {
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
    }

    // Flusher — coalesces bytes within a tight window so floods don't
    // drown the event bus, but flushes promptly after a brief idle.
    // Mirrors the strategy in pty.rs.
    let app_for_thread = app.clone();
    let id_for_thread = id.clone();
    thread::spawn(move || {
        const FLUSH_WINDOW: Duration = Duration::from_micros(800);
        const FLUSH_BYTES: usize = 64 * 1024;
        let event_name = format!("agent-chat://{}/data", id_for_thread);
        let closed_name = format!("agent-chat://{}/closed", id_for_thread);
        let mut pending: Vec<u8> = Vec::with_capacity(FLUSH_BYTES);

        loop {
            let first = match rx.recv() {
                Ok(v) => v,
                Err(_) => break,
            };
            pending.clear();
            pending.extend_from_slice(&first);

            while pending.len() < FLUSH_BYTES {
                match rx.recv_timeout(FLUSH_WINDOW) {
                    Ok(v) => pending.extend_from_slice(&v),
                    Err(_) => break,
                }
            }

            // Emit as UTF-8; non-UTF-8 bytes are replaced with U+FFFD.
            let payload = String::from_utf8_lossy(&pending).to_string();
            let _ = app_for_thread.emit(&event_name, payload);
        }
        let _ = app_for_thread.emit(&closed_name, ());
    });

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
