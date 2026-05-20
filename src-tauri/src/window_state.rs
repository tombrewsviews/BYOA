//! Persist + restore the main window's size.
//!
//! First launch (no saved state) → maximized to the primary monitor's
//! work area. Subsequent launches restore the user's last size and
//! position. The window-state JSON lives at
//! `~/.kinetic-studio/window.json` next to `recents.json`.
//!
//! The frontend calls `save_window_state` whenever the window is
//! resized or moved (debounced JS-side). On startup, `lib.rs` calls
//! `apply_initial_window_state` once the main window exists.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{LogicalPosition, LogicalSize, Runtime, WebviewWindow};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WindowState {
    pub width: f64,
    pub height: f64,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub maximized: bool,
}

fn state_path() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".kinetic-studio").join("window.json"))
        .unwrap_or_else(|| PathBuf::from(".kinetic-studio/window.json"))
}

fn read() -> Option<WindowState> {
    fs::read_to_string(state_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

fn write(s: &WindowState) -> Result<(), String> {
    if let Some(parent) = state_path().parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    fs::write(state_path(), json).map_err(|e| e.to_string())
}

/// Called once at startup from `lib.rs` after the main window is built.
/// Restores prior size+position OR maximizes to the screen if first launch.
pub fn apply_initial<R: Runtime>(window: &WebviewWindow<R>) {
    match read() {
        Some(s) => {
            if s.maximized {
                let _ = window.maximize();
                return;
            }
            let _ = window.set_size(LogicalSize::new(s.width, s.height));
            if let (Some(x), Some(y)) = (s.x, s.y) {
                let _ = window.set_position(LogicalPosition::new(x, y));
            }
        }
        None => {
            // First launch — maximize to the primary monitor's work area.
            let _ = window.maximize();
        }
    }
}

#[tauri::command]
pub fn save_window_state(
    width: f64,
    height: f64,
    x: Option<f64>,
    y: Option<f64>,
    maximized: bool,
) -> Result<(), String> {
    write(&WindowState {
        width,
        height,
        x,
        y,
        maximized,
    })
}

// View-mode persistence per project — separate file so window-state code
// stays trivial and we can evolve schemas independently.

use std::collections::HashMap;

fn view_mode_path() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".kinetic-studio").join("view-mode.json"))
        .unwrap_or_else(|| PathBuf::from(".kinetic-studio/view-mode.json"))
}

fn read_view_modes() -> HashMap<String, String> {
    fs::read_to_string(view_mode_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_view_modes(map: &HashMap<String, String>) -> Result<(), String> {
    if let Some(parent) = view_mode_path().parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    fs::write(view_mode_path(), json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_view_mode(project_path: String) -> String {
    read_view_modes()
        .get(&project_path)
        .cloned()
        .unwrap_or_else(|| "terminal".to_string())
}

#[tauri::command]
pub fn set_view_mode(project_path: String, mode: String) -> Result<(), String> {
    let mut map = read_view_modes();
    map.insert(project_path, mode);
    write_view_modes(&map)
}
