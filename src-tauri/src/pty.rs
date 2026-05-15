//! PTY session management.
//!
//! pty_open spawns $SHELL -l with cwd = project_root and registers the
//! session in AppState.ptys. A blocking reader thread (NOT a tokio task —
//! portable-pty's reader is sync) pumps bytes into `pty://{id}/data`
//! events. pty_write/resize/close mutate the session through the map.

use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

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
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    cmd.cwd(&state.project_root);
    // Inherit env so `claude` finds ~/.claude credentials.
    for (k, v) in std::env::vars() {
        cmd.env(k, v);
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

    // Spawn the reader thread. It emits pty://{id}/data events until EOF,
    // then emits pty://{id}/closed and exits. The map entry is dropped by
    // pty_close (explicit) or by the reader on natural EOF.
    let app_for_thread = app.clone();
    let id_for_thread = id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app_for_thread.emit(
                        &format!("pty://{}/data", id_for_thread),
                        chunk,
                    );
                }
                Err(_) => break,
            }
        }
        let _ = app_for_thread.emit::<()>(
            &format!("pty://{}/closed", id_for_thread),
            (),
        );
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
