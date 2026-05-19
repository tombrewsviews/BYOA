//! Project-document read/write commands.
//!
//! Routes through the active canvas plugin (see `canvas.rs`). The shell
//! never names the filename — it asks the canvas. v1's only canvas is
//! kinetic typography, whose document is `story.json`; future canvases
//! will declare their own filename.
//!
//! All writes are atomic (tmp + rename) so the project-folder watcher
//! sees one consistent event per save.

use std::path::PathBuf;
use tauri::State;

use json_patch::{patch as apply_json_patch, Patch};

use crate::canvas;
use crate::history;
use crate::AppState;

fn active_path(state: &AppState) -> Result<PathBuf, String> {
    state
        .active_project
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|p| p.path.clone())
        .ok_or_else(|| "no active project".into())
}

fn doc_path(state: &AppState) -> Result<PathBuf, String> {
    Ok(active_path(state)?.join(canvas::active().doc_filename()))
}

#[tauri::command]
pub fn save_doc(json: String, state: State<'_, AppState>) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| format!("invalid doc json: {}", e))?;

    let target = doc_path(&state)?;
    let tmp = target.with_extension("json.tmp");

    let body = if json.ends_with('\n') {
        json
    } else {
        format!("{}\n", json)
    };

    std::fs::write(&tmp, body.as_bytes()).map_err(|e| format!("write tmp: {}", e))?;
    std::fs::rename(&tmp, &target).map_err(|e| format!("rename: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn load_doc(state: State<'_, AppState>) -> Result<String, String> {
    std::fs::read_to_string(doc_path(&state)?).map_err(|e| format!("read: {}", e))
}

/// Apply an RFC 6902 JSON Patch to the canvas doc.
///
/// Loads the current doc, applies the patch (failing if any op
/// targets a missing path), writes the new doc atomically via the
/// same tmp+rename pattern as `save_doc`, and appends a content-
/// addressed history entry. Returns the new doc JSON to the
/// frontend.
///
/// `author` is recorded in the history log; the spec convention is
/// `"user"` for UI-triggered patches, `"agent"` for agent-driven
/// patches, or the verb name when verbs land.
///
/// **Failure ordering note:** the on-disk doc is updated (via tmp +
/// rename) before the history entry is appended. If history append
/// fails after the rename succeeds, the doc is current but the log
/// lacks an entry. For the spike this is acceptable (local-fs append
/// rarely fails); a production version should make the two atomic.
#[tauri::command]
pub fn apply_patch(
    patch_json: String,
    author: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // 1. Load current doc.
    let target = doc_path(&state)?;
    let current_text = std::fs::read_to_string(&target)
        .map_err(|e| format!("read current doc: {}", e))?;
    let mut current: serde_json::Value = serde_json::from_str(&current_text)
        .map_err(|e| format!("parse current doc: {}", e))?;

    // 2. Parse the patch.
    let patch: Patch = serde_json::from_str(&patch_json)
        .map_err(|e| format!("parse patch: {}", e))?;

    // 3. Apply.
    apply_json_patch(&mut current, &patch)
        .map_err(|e| format!("apply patch: {}", e))?;

    // 4. Serialise the new doc.
    let new_text = serde_json::to_string_pretty(&current)
        .map_err(|e| format!("serialise new doc: {}", e))?;
    let body = if new_text.ends_with('\n') {
        new_text.clone()
    } else {
        format!("{}\n", new_text)
    };

    // 5. Atomic write — same tmp+rename as save_doc.
    let tmp = target.with_extension("json.tmp");
    std::fs::write(&tmp, body.as_bytes()).map_err(|e| format!("write tmp: {}", e))?;
    std::fs::rename(&tmp, &target).map_err(|e| format!("rename: {}", e))?;

    // 6. Append to history.
    let project_root = active_path(&state)?;
    history::write_entry(&project_root, body.as_bytes(), &author)
        .map_err(|e| format!("history: {}", e))?;

    Ok(body)
}

#[cfg(test)]
mod tests {
    use json_patch::{patch as apply_json_patch, Patch};
    use serde_json::json;

    #[test]
    fn patch_replaces_a_field() {
        let mut doc = json!({ "bgColor": "#000000", "beats": [] });
        let patch: Patch = serde_json::from_value(json!([
            { "op": "replace", "path": "/bgColor", "value": "#ff5ca8" }
        ])).unwrap();

        apply_json_patch(&mut doc, &patch).unwrap();

        assert_eq!(doc["bgColor"], "#ff5ca8");
        assert_eq!(doc["beats"], json!([]));
    }

    #[test]
    fn patch_appends_to_an_array() {
        let mut doc = json!({ "beats": [{ "text": "hi" }] });
        let patch: Patch = serde_json::from_value(json!([
            { "op": "add", "path": "/beats/-", "value": { "text": "there" } }
        ])).unwrap();

        apply_json_patch(&mut doc, &patch).unwrap();

        assert_eq!(doc["beats"].as_array().unwrap().len(), 2);
        assert_eq!(doc["beats"][1]["text"], "there");
    }

    #[test]
    fn invalid_path_errors() {
        let mut doc = json!({ "bgColor": "#000000" });
        let patch: Patch = serde_json::from_value(json!([
            { "op": "replace", "path": "/nonexistent", "value": "anything" }
        ])).unwrap();

        let result = apply_json_patch(&mut doc, &patch);
        assert!(result.is_err(), "invalid path must error");
        assert_eq!(
            doc,
            json!({ "bgColor": "#000000" }),
            "failed patch must not mutate doc"
        );
    }
}
