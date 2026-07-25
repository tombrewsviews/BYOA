// Prevents an extra console window on Windows in release. macOS-only for now,
// but harmless to keep.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    brainstorm_app_lib::run()
}
