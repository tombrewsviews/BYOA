//! The kanban board window.
//!
//! Outreach's main window is the Agent panel (Terminal/Chat, left). The board
//! itself lives in a second window that tiles to its right. Unlike Brainstorm
//! (which serves an excalidraw npm server and loads it cross-origin), our board
//! is a first-party React bundle built by our own Vite as `board.html`, so we
//! load it with `WebviewUrl::App` — no localhost server, no port, no .mcp.json.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// Relay a card selection from the board window to the main (agent) window,
/// which opens its Inspector on that lead. Going through the backend guarantees
/// the event reaches the *other* window — a webview-side `emit` does not
/// reliably cross windows in every Tauri build. Emitted to the "main" window
/// specifically so only the Inspector reacts.
#[tauri::command]
pub fn board_select_lead(app: AppHandle, id: String) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("board://select-lead", id);
    }
    Ok(())
}

/// Open the kanban board in its own window (label "board"), loading the
/// first-party `board.html` bundle. Idempotent: focuses the existing window if
/// already open. Tiles both windows afterward.
#[tauri::command]
pub fn board_window_open(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("board") {
        let _ = w.set_focus();
        tile_windows(&app);
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, "board", WebviewUrl::App("board.html".into()))
        .title("Outreach Board")
        .inner_size(1100.0, 800.0)
        // Tauri's OS-level drag-drop handler is ON by default, and on macOS it
        // intercepts the webview's pointer events — swallowing the HTML5
        // `dragstart`/`drop` the kanban cards use AND, because the cards are
        // `draggable`, the `click` that opens the Inspector. Disabling it hands
        // pointer/DnD events back to the page so cards drag and click. The board
        // doesn't use native file-drop, so nothing is lost. (Tauri's own docs:
        // "required to use HTML5 drag and drop APIs on the frontend".)
        .disable_drag_drop_handler()
        .build()
        .map_err(|e| e.to_string())?;
    tile_windows(&app);
    Ok(())
}

/// Close the board window if open.
#[tauri::command]
pub fn board_window_close(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("board") {
        let _ = w.close();
    }
    Ok(())
}

/// Width reserved for the agent panel (main window) when tiling.
const AGENT_PANEL_W: f64 = 430.0;

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
