//! Second "stage" window: a fullscreen, chrome-free live visualizer that
//! opens on a secondary monitor when one is present. Created on demand
//! from the Pulse app via `open_stage_window`.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
pub fn open_stage_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("stage") {
        let _ = w.set_focus();
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(&app, "stage", WebviewUrl::App("/stage".into()))
        .title("Pulse Stage")
        .decorations(false)
        .build()
        .map_err(|e| e.to_string())?;

    // Place on the secondary monitor if there is one, then go fullscreen.
    if let Ok(monitors) = win.available_monitors() {
        if monitors.len() > 1 {
            let pos = monitors[1].position();
            let _ = win.set_position(tauri::PhysicalPosition { x: pos.x, y: pos.y });
        }
    }
    let _ = win.set_fullscreen(true);
    Ok(())
}

#[tauri::command]
pub fn close_stage_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("stage") {
        let _ = w.close();
    }
    Ok(())
}
