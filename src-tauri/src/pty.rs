//! PTY session management.
//!
//! pty_open spawns $SHELL -l with cwd = active_project.path and registers the
//! session in AppState.ptys. A blocking reader thread (NOT a tokio task —
//! portable-pty's reader is sync) pumps bytes into `pty://{id}/data`
//! events. pty_write/resize/close mutate the session through the map.

use std::io::{Read, Write};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::agents::AgentKind;
use crate::settings;
use crate::AppState;

pub struct PtySession {
    pub master: Mutex<Box<dyn MasterPty + Send>>,
    pub writer: Mutex<Box<dyn Write + Send>>,
    pub child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
}

#[tauri::command]
pub fn pty_open(
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty: {}", e))?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let project_path = state
        .active_project
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|p| p.path.clone())
        .ok_or_else(|| "no active project".to_string())?;
    let project_str = project_path.to_string_lossy().to_string();
    let rc_path = project_path.join(".kinetic-studio").join("rc.zsh");

    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&project_path);

    // Inherit env so `claude` finds ~/.claude credentials.
    for (k, v) in std::env::vars() {
        cmd.env(k, v);
    }
    // Studio scope hints.
    cmd.env("KINETIC_PROJECT", &project_str);
    cmd.env("KINETIC_STUDIO", "1");

    // If zsh AND the rc file exists, source it before going interactive,
    // then auto-launch the user's configured agent if any is set. The
    // shell stays the host process so Ctrl-C, scrollback, and copy/paste
    // all keep working — when the agent exits, the shell prompt is
    // there waiting.
    let shell_name = std::path::Path::new(&shell)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    let agent_launch = settings::default_agent()
        .map(|a: AgentKind| {
            let flag = if settings::skip_permissions() {
                a.skip_permissions_flag().unwrap_or("")
            } else {
                ""
            };
            if flag.is_empty() {
                format!("{} ; ", a.binary())
            } else {
                format!("{} {} ; ", a.binary(), flag)
            }
        })
        .unwrap_or_default();
    if shell_name == "zsh" && rc_path.exists() {
        let rc_str = rc_path.to_string_lossy().to_string();
        cmd.arg("-c");
        cmd.arg(format!(
            "source \"{}\"; {}exec zsh -i",
            rc_str, agent_launch
        ));
    } else if !agent_launch.is_empty() {
        cmd.arg("-c");
        cmd.arg(format!("{}exec {} -i", agent_launch, shell));
    } else {
        cmd.arg("-l");
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer: {}", e))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("try_clone_reader: {}", e))?;

    let id = Uuid::new_v4().to_string();

    let session = PtySession {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
    };
    state.ptys.insert(id.clone(), session);

    // Pty -> UI pipeline: a READER thread does blocking reads from the
    // pty (cheap, no JS interop) and ships chunks to a FLUSHER thread via
    // a channel. The flusher coalesces bytes for a short window (~4ms)
    // before emitting one Tauri event, so high-bandwidth output (claude
    // code re-renders, big `cat`, etc.) doesn't drown the event bus with
    // thousands of tiny emits. Typing latency stays imperceptible because
    // the window is small and the first byte after an idle period flushes
    // promptly.
    let (tx, rx) = mpsc::channel::<Vec<u8>>();

    // Reader: blocking, just pumps bytes.
    thread::spawn(move || {
        let mut buf = [0u8; 16384]; // 16KB read buffer
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break; // flusher gone
                    }
                }
                Err(_) => break,
            }
        }
        // dropping tx signals EOF to the flusher
    });

    // Flusher: coalesces only when bytes are arriving fast. For interactive
    // typing (one keystroke echo at a time) we emit immediately. For floods
    // (claude code re-renders, large `cat`, etc.) we batch via a short tail
    // window — if more bytes arrive within FLUSH_WINDOW after the previous
    // batch, fold them in; otherwise emit and return to the blocking recv.
    //
    // FLUSH_WINDOW is intentionally tight (1ms): well under one frame at
    // 60Hz, so a lone echo back from the pty (typing) emits with negligible
    // delay. It still suffices to coalesce thousands of fast small chunks
    // into one event because pipe reads come back-to-back.
    let app_for_thread = app.clone();
    let id_for_thread = id.clone();
    thread::spawn(move || {
        const FLUSH_WINDOW: Duration = Duration::from_micros(800); // ~1ms
        const FLUSH_BYTES: usize = 64 * 1024; // 64KB hard cap per emit
        let event_name = format!("pty://{}/data", id_for_thread);
        let closed_name = format!("pty://{}/closed", id_for_thread);
        let mut pending: Vec<u8> = Vec::with_capacity(FLUSH_BYTES);

        loop {
            // Block on first byte — wakes on activity, not on a timer,
            // so an idle terminal costs zero CPU.
            let first = match rx.recv() {
                Ok(v) => v,
                Err(_) => break, // channel closed → reader exited
            };
            pending.clear();
            pending.extend_from_slice(&first);

            // Tail-fold: keep absorbing whatever lands within FLUSH_WINDOW
            // since the last bytes arrived. A single keystroke echo (one
            // chunk, idle pty after) ends after one ~1ms timeout. Bulk
            // output keeps refreshing the deadline until the pipe drains.
            while pending.len() < FLUSH_BYTES {
                match rx.recv_timeout(FLUSH_WINDOW) {
                    Ok(more) => pending.extend_from_slice(&more),
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        if !pending.is_empty() {
                            let chunk = String::from_utf8_lossy(&pending).into_owned();
                            let _ = app_for_thread.emit(&event_name, chunk);
                        }
                        let _ = app_for_thread.emit::<()>(&closed_name, ());
                        return;
                    }
                }
            }

            let chunk = String::from_utf8_lossy(&pending).into_owned();
            let _ = app_for_thread.emit(&event_name, chunk);
        }

        let _ = app_for_thread.emit::<()>(&closed_name, ());
    });

    Ok(id)
}

#[tauri::command]
pub fn pty_write(
    id: String,
    data: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = state
        .ptys
        .get(&id)
        .ok_or_else(|| format!("no pty session: {}", id))?;
    let mut writer = session.writer.lock().map_err(|e| e.to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("write: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn pty_resize(
    id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = state
        .ptys
        .get(&id)
        .ok_or_else(|| format!("no pty session: {}", id))?;
    let master = session.master.lock().map_err(|e| e.to_string())?;
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn pty_close(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some((_, session)) = state.ptys.remove(&id) {
        if let Ok(mut child) = session.child.lock() {
            let _ = child.kill();
        }
    }
    Ok(())
}

/// Inject text directly into a PTY's master side — the connected
/// shell sees it as if the user typed it. We do NOT append a newline;
/// the user reviews and presses Enter themselves so an in-flight
/// agent turn isn't interrupted.
#[tauri::command]
pub fn pty_paste_prompt(
    id: String,
    text: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = state
        .ptys
        .get(&id)
        .ok_or_else(|| format!("no pty session: {}", id))?;
    let mut writer = session.writer.lock().map_err(|e| e.to_string())?;
    writer
        .write_all(text.as_bytes())
        .map_err(|e| format!("write: {}", e))?;
    Ok(())
}
