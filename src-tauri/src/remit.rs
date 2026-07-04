//! Remit-specific commands: a user-wide saved-recipients store and a
//! duplicate-transfer helper.
//!
//! The recipients store is intentionally SCHEMA-AGNOSTIC — the backend treats
//! it as an opaque JSON array the frontend owns (same philosophy as
//! `load_doc`/`save_doc`). It lives at `~/.kinetic-studio/remit-recipients.json`
//! so saved recipients are shared across every transfer, not stuck inside one
//! project folder.

use std::fs;
use std::path::PathBuf;

use crate::canvas;
use crate::projects::ProjectMeta;

fn recipients_path() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".kinetic-studio").join("remit-recipients.json"))
        .unwrap_or_else(|| PathBuf::from(".kinetic-studio/remit-recipients.json"))
}

/// Return the saved-recipients JSON array verbatim, or `"[]"` if none yet.
#[tauri::command]
pub fn remit_recipients_load() -> Result<String, String> {
    match fs::read_to_string(recipients_path()) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("[]".to_string()),
        Err(e) => Err(format!("read recipients: {}", e)),
    }
}

/// Overwrite the saved-recipients store with `json` (must be a JSON array).
/// Written atomically (tmp + rename).
#[tauri::command]
pub fn remit_recipients_save(json: String) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| format!("invalid recipients json: {}", e))?;
    if !value.is_array() {
        return Err("recipients must be a JSON array".to_string());
    }
    let p = recipients_path();
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {}", e))?;
    }
    let body = if json.ends_with('\n') { json } else { format!("{}\n", json) };
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, body.as_bytes()).map_err(|e| format!("write tmp: {}", e))?;
    fs::rename(&tmp, &p).map_err(|e| format!("rename: {}", e))?;
    Ok(())
}

/// Duplicate an existing Remit transfer into a brand-new project folder,
/// copying its `remit.json`. Returns the new project's metadata.
///
/// `source_path` is the folder of the transfer to clone; `name` is the new
/// project's display name.
#[tauri::command]
pub fn remit_duplicate(source_path: String, name: String) -> Result<ProjectMeta, String> {
    let source = PathBuf::from(&source_path);
    let src_doc = source.join("remit.json");
    let doc_bytes = fs::read(&src_doc).map_err(|e| format!("read source doc: {}", e))?;

    // Create a fresh remit project via the shared helper, then overwrite its
    // seeded remit.json with the source content.
    let meta = crate::projects::create_project_dir(&name, "remit")?;
    let target_doc = PathBuf::from(&meta.path).join("remit.json");
    let body = if doc_bytes.ends_with(b"\n") {
        doc_bytes
    } else {
        let mut b = doc_bytes;
        b.push(b'\n');
        b
    };
    let tmp = target_doc.with_extension("json.tmp");
    fs::write(&tmp, &body).map_err(|e| format!("write tmp: {}", e))?;
    fs::rename(&tmp, &target_doc).map_err(|e| format!("rename: {}", e))?;

    // Refresh the card's beat count / preview meta now the real doc is in place.
    let canvas = canvas::by_id("remit");
    let _ = canvas.summarise(&PathBuf::from(&meta.path));
    Ok(meta)
}
