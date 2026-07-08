//! Brainstorm Canvas server lifecycle.
//!
//! The board is a live Excalidraw instance served by `mcp-excalidraw-server`
//! in *canvas mode* (`dist/server.js`): an Express + WebSocket server that
//! holds the scene and broadcasts every change. The app embeds it in a
//! webview; the agent reaches the SAME board through the `excalidraw` MCP
//! (`dist/index.js`), which syncs to this server via the `EXPRESS_SERVER_URL`
//! env var.
//!
//! This module owns that server process:
//!   - `brainstorm_canvas_start` spawns it (once) on a free port (preferring
//!     3939), seeds/rewrites the active project's `.mcp.json` so the MCP points
//!     at the resolved port, and returns the canvas URL for the webview.
//!   - The child is killed on app exit via `shutdown` (called from the
//!     window-close handler in lib.rs) so we don't leak a localhost server.
//!
//! The server is bound to 127.0.0.1 only (its default + our explicit HOST) —
//! it has no auth, so it must never be exposed beyond loopback.

use std::net::TcpListener;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::json;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::AppState;

/// The preferred canvas-server port. We try this first so the seeded
/// `.mcp.json` is predictable; if it's taken we fall back to a free port and
/// rewrite the file.
const PREFERRED_PORT: u16 = 3939;

/// The running canvas server, if any. One per app session.
#[derive(Default)]
pub struct CanvasServer {
    pub inner: Mutex<Option<RunningServer>>,
}

pub struct RunningServer {
    pub child: Child,
    pub url: String,
}

/// Find a usable port: try the preferred one, else ask the OS for a free port.
fn pick_port() -> u16 {
    if TcpListener::bind(("127.0.0.1", PREFERRED_PORT)).is_ok() {
        return PREFERRED_PORT;
    }
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(PREFERRED_PORT)
}

/// Bundle-relative path of the canvas-server entrypoint (see `server_entry`).
const SERVER_REL: &str = "resources/canvas-server/dist/server.js";

/// Absolute path to the bundled canvas-server entrypoint. In the standalone
/// app the server ships inside the .app under
/// `resources/canvas-server/dist/server.js` (staged by scripts/stage-server.sh
/// and declared in tauri.conf.json bundle.resources). Resolved via Tauri's
/// resource dir.
fn server_entry(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .resolve(SERVER_REL, tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("resolve canvas server resource: {}", e))
}

/// Write (or overwrite) the project's `.mcp.json` so the `excalidraw` MCP is
/// enabled by default and points at the running canvas server. Idempotent.
pub fn write_mcp_config(project_dir: &Path, canvas_url: &str) -> std::io::Result<()> {
    let config = json!({
        "mcpServers": {
            "excalidraw": {
                "command": "npx",
                "args": ["-y", "mcp-excalidraw-server"],
                "env": {
                    "EXPRESS_SERVER_URL": canvas_url,
                    "ENABLE_CANVAS_SYNC": "true"
                }
            }
        }
    });
    std::fs::write(
        project_dir.join(".mcp.json"),
        serde_json::to_string_pretty(&config).unwrap(),
    )
}

/// Start the canvas server if it isn't already running, and ensure the active
/// project's `.mcp.json` points at it. Returns the canvas URL for the webview.
#[tauri::command]
pub fn brainstorm_canvas_start(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    // Already running? Return the existing URL (and re-sync .mcp.json in case a
    // different project just opened).
    {
        let guard = state.canvas_server.inner.lock().map_err(|e| e.to_string())?;
        if let Some(running) = guard.as_ref() {
            if let Some(dir) = active_project_dir(&state) {
                let _ = write_mcp_config(&dir, &running.url);
            }
            return Ok(running.url.clone());
        }
    }

    let port = pick_port();
    let url = format!("http://127.0.0.1:{}", port);
    let entry = server_entry(&app)?;
    if !entry.exists() {
        return Err(format!(
            "canvas server not found at {} — the app bundle may be incomplete",
            entry.display()
        ));
    }

    // The server writes a winston log to `LOG_FILE_PATH` (default
    // `excalidraw.log` in cwd). Pin it to the temp dir so it never lands in a
    // project folder or the repo.
    let log_path = std::env::temp_dir().join("brainstorm-canvas.log");
    let child = Command::new("node")
        .arg(&entry)
        .env("PORT", port.to_string())
        .env("HOST", "127.0.0.1")
        .env("LOG_FILE_PATH", log_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn canvas server: {}", e))?;

    // Point the active project's MCP config at the resolved port.
    if let Some(dir) = active_project_dir(&state) {
        write_mcp_config(&dir, &url).map_err(|e| format!("write .mcp.json: {}", e))?;
    }

    // Wait until the server is actually accepting connections before returning,
    // so the webview never navigates to a not-yet-listening port (boots in
    // ~200ms; we allow up to 5s).
    wait_until_listening(port, Duration::from_secs(5));

    let mut guard = state.canvas_server.inner.lock().map_err(|e| e.to_string())?;
    *guard = Some(RunningServer {
        child,
        url: url.clone(),
    });
    Ok(url)
}

/// Block until something is listening on the port, or the timeout elapses.
fn wait_until_listening(port: u16, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Open the live Excalidraw board in its own Tauri window, loading the canvas
/// server URL as a first-party top-level document. This avoids the cross-origin
/// iframe storage-partitioning that left the embedded board blank in WKWebView.
#[tauri::command]
pub fn brainstorm_canvas_open_window(app: AppHandle, url: String) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("board") {
        let _ = w.set_focus();
        tile_windows(&app);
        return Ok(());
    }
    let parsed = url.parse().map_err(|e| format!("bad url {}: {}", url, e))?;
    WebviewWindowBuilder::new(&app, "board", WebviewUrl::External(parsed))
        .title("Brainstorm Board")
        .inner_size(1100.0, 800.0)
        .build()
        .map_err(|e| e.to_string())?;
    tile_windows(&app);
    Ok(())
}

/// Width reserved for the agent panel (main window) when tiling.
const AGENT_PANEL_W: f64 = 380.0;

/// Tile the two windows to fill the work area: the agent panel (main window) on
/// the left at a fixed width, the board window filling the rest.
fn tile_windows(app: &AppHandle) {
    use tauri::{PhysicalPosition, PhysicalSize};
    let main = match app.get_webview_window("main") {
        Some(w) => w,
        None => return,
    };
    let board = match app.get_webview_window("board") {
        Some(w) => w,
        None => return,
    };
    // Work area of the monitor the main window is on (excludes the menu bar).
    let monitor = match main.current_monitor() {
        Ok(Some(m)) => m,
        _ => return,
    };
    let scale = monitor.scale_factor();
    let pos = monitor.position();
    let size = monitor.size();
    let panel_px = (AGENT_PANEL_W * scale).round() as u32;
    let panel_px = panel_px.min(size.width.saturating_sub(200));

    let _ = main.set_position(PhysicalPosition { x: pos.x, y: pos.y });
    let _ = main.set_size(PhysicalSize {
        width: panel_px,
        height: size.height,
    });
    let _ = board.set_position(PhysicalPosition {
        x: pos.x + panel_px as i32,
        y: pos.y,
    });
    let _ = board.set_size(PhysicalSize {
        width: size.width.saturating_sub(panel_px),
        height: size.height,
    });
    let _ = board.set_focus();
}

/// Close the board window if open.
#[tauri::command]
pub fn brainstorm_canvas_close_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("board") {
        let _ = w.close();
    }
    Ok(())
}

fn active_project_dir(state: &State<'_, AppState>) -> Option<std::path::PathBuf> {
    state
        .active_project
        .lock()
        .ok()
        .and_then(|p| p.as_ref().map(|a| a.path.clone()))
}

/// Kill the canvas server child if running. Called on app/window close so the
/// localhost server (and its port) don't leak across sessions.
pub fn shutdown(state: &AppState) {
    if let Ok(mut guard) = state.canvas_server.inner.lock() {
        if let Some(mut running) = guard.take() {
            let _ = running.child.kill();
            let _ = running.child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn write_mcp_config_points_excalidraw_at_url() {
        let dir = TempDir::new().unwrap();
        write_mcp_config(dir.path(), "http://127.0.0.1:3939").unwrap();
        let txt = std::fs::read_to_string(dir.path().join(".mcp.json")).unwrap();
        assert!(txt.contains("excalidraw"));
        assert!(txt.contains("http://127.0.0.1:3939"));
        assert!(txt.contains("EXPRESS_SERVER_URL"));
    }

    #[test]
    fn pick_port_returns_a_bindable_port() {
        let p = pick_port();
        // Either the preferred port or an OS-assigned one; must be > 0.
        assert!(p > 0);
    }

    #[test]
    fn server_rel_is_the_bundled_dist_entrypoint() {
        assert_eq!(SERVER_REL, "resources/canvas-server/dist/server.js");
    }
}
