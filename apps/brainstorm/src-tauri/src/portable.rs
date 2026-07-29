//! Portable `.excalidraw` file export/import.
//!
//! Lets a board leave the app as a standard Excalidraw file (upload it to
//! excalidraw.com to view or share it with people who don't have this app) and
//! come back in — into the current board or a new one.
//!
//! Only the file envelope is handled here; moving the scene in and out of the
//! canvas server is the frontend's job, since it already owns those endpoints
//! (`GET /api/elements` to read, `POST /api/elements/sync` to write).
//!
//! Our `board.json` is *nearly* `.excalidraw` already. The differences, against
//! a file saved by excalidraw.com:
//!
//! | field       | board.json          | .excalidraw                  |
//! |-------------|---------------------|------------------------------|
//! | `source`    | `brainstorm-canvas` | `https://excalidraw.com`     |
//! | `appState`  | absent              | `{gridSize, viewBackground}` |
//! | `savedAt`   | present (ours)      | absent                       |
//!
//! So export adds `appState`, drops `savedAt`, and leaves elements untouched.

use serde_json::{json, Map, Value};

/// What excalidraw.com writes as `source`. Using their value (rather than ours)
/// keeps the file indistinguishable from a natively-saved one.
const EXCALIDRAW_SOURCE: &str = "https://excalidraw.com";
const DEFAULT_BACKGROUND: &str = "#ffffff";

/// Wrap a live scene's elements + files in the `.excalidraw` envelope.
///
/// `elements` and `files` come straight from the canvas server. `background` is
/// the board's view background if known.
pub fn to_excalidraw_file(elements: Value, files: Value, background: Option<&str>) -> Value {
    json!({
        "type": "excalidraw",
        "version": 2,
        "source": EXCALIDRAW_SOURCE,
        "elements": if elements.is_array() { elements } else { json!([]) },
        "appState": {
            "gridSize": Value::Null,
            "viewBackgroundColor": background.unwrap_or(DEFAULT_BACKGROUND),
        },
        "files": if files.is_object() { files } else { json!({}) },
    })
}

/// A scene parsed out of a `.excalidraw` file, ready to push to the canvas.
#[derive(Debug)]
pub struct ImportedScene {
    pub elements: Value,
    pub files: Value,
}

/// Parse and validate a `.excalidraw` file.
///
/// Deliberately strict about `type` and `elements` — those are what make the
/// file a scene. Everything else (`appState`, `files`, `version`) is optional,
/// so files from older Excalidraw versions, from this app's own `board.json`,
/// and hand-edited ones all import.
pub fn parse_excalidraw_file(raw: &str) -> Result<ImportedScene, String> {
    let parsed: Value = serde_json::from_str(raw)
        .map_err(|e| format!("not a valid JSON file: {}", e))?;

    let obj: &Map<String, Value> = parsed
        .as_object()
        .ok_or_else(|| "not an Excalidraw file: expected a JSON object".to_string())?;

    match obj.get("type").and_then(|t| t.as_str()) {
        Some("excalidraw") => {}
        Some(other) => {
            return Err(format!(
                "not an Excalidraw scene: type is \"{}\", expected \"excalidraw\"",
                other
            ))
        }
        None => return Err("not an Excalidraw file: no \"type\" field".to_string()),
    }

    let elements = obj
        .get("elements")
        .filter(|e| e.is_array())
        .ok_or_else(|| "not an Excalidraw scene: \"elements\" is missing or not a list".to_string())?
        .clone();

    // `files` is absent in scenes with no embedded images — that's normal.
    let files = obj
        .get("files")
        .filter(|f| f.is_object())
        .cloned()
        .unwrap_or_else(|| json!({}));

    Ok(ImportedScene { elements, files })
}

/// Read a `.excalidraw` file from disk and return `(elements, files)` as a JSON
/// string pair the frontend can push straight to the canvas server.
#[tauri::command]
pub fn board_import_file(path: String) -> Result<serde_json::Value, String> {
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("cannot read file: {}", e))?;
    let scene = parse_excalidraw_file(&raw)?;
    Ok(json!({ "elements": scene.elements, "files": scene.files }))
}

/// Write a live scene to `path` as a `.excalidraw` file.
#[tauri::command]
pub fn board_export_file(
    path: String,
    elements: Value,
    files: Value,
    background: Option<String>,
) -> Result<(), String> {
    let doc = to_excalidraw_file(elements, files, background.as_deref());
    let text = serde_json::to_string_pretty(&doc).map_err(|e| format!("encode failed: {}", e))?;
    std::fs::write(&path, text).map_err(|e| format!("cannot write file: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_envelope_matches_excalidraw_schema() {
        let doc = to_excalidraw_file(json!([{"id": "a", "type": "rectangle"}]), json!({}), None);
        assert_eq!(doc["type"], "excalidraw");
        assert_eq!(doc["version"], 2);
        assert_eq!(doc["source"], EXCALIDRAW_SOURCE);
        assert!(doc["appState"].is_object());
        assert_eq!(doc["appState"]["viewBackgroundColor"], DEFAULT_BACKGROUND);
        assert!(doc["files"].is_object());
        // `savedAt` is ours, not part of the format — it must not leak out.
        assert!(doc.get("savedAt").is_none());
        assert_eq!(doc["elements"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn export_honours_board_background() {
        let doc = to_excalidraw_file(json!([]), json!({}), Some("#000000"));
        assert_eq!(doc["appState"]["viewBackgroundColor"], "#000000");
    }

    #[test]
    fn export_coerces_bad_shapes_to_empty() {
        // Defensive: a canvas-server hiccup must not produce an invalid file.
        let doc = to_excalidraw_file(json!("nonsense"), json!("nonsense"), None);
        assert_eq!(doc["elements"], json!([]));
        assert_eq!(doc["files"], json!({}));
    }

    #[test]
    fn import_accepts_a_real_excalidraw_file() {
        let raw = r#"{"type":"excalidraw","version":2,"source":"https://excalidraw.com",
            "elements":[{"id":"x","type":"ellipse"}],"appState":{"gridSize":null},
            "files":{"f1":{"id":"f1","dataURL":"data:,"}}}"#;
        let scene = parse_excalidraw_file(raw).expect("should parse");
        assert_eq!(scene.elements.as_array().unwrap().len(), 1);
        assert!(scene.files.get("f1").is_some());
    }

    #[test]
    fn import_accepts_our_own_board_json() {
        // Round-trip: the app's own doc format must import without conversion.
        let raw = r#"{"type":"excalidraw","version":2,"source":"brainstorm-canvas",
            "elements":[{"id":"a"}],"files":{},"savedAt":123}"#;
        let scene = parse_excalidraw_file(raw).expect("board.json should import");
        assert_eq!(scene.elements.as_array().unwrap().len(), 1);
    }

    #[test]
    fn import_defaults_missing_files_to_empty() {
        let raw = r#"{"type":"excalidraw","elements":[]}"#;
        let scene = parse_excalidraw_file(raw).expect("should parse");
        assert_eq!(scene.files, json!({}));
    }

    #[test]
    fn import_rejects_malformed_json() {
        let err = parse_excalidraw_file("{not json").unwrap_err();
        assert!(err.contains("valid JSON"), "got: {}", err);
    }

    #[test]
    fn import_rejects_wrong_type() {
        let err = parse_excalidraw_file(r#"{"type":"figma","elements":[]}"#).unwrap_err();
        assert!(err.contains("figma"), "error should name the actual type: {}", err);
    }

    #[test]
    fn import_rejects_missing_elements() {
        let err = parse_excalidraw_file(r#"{"type":"excalidraw"}"#).unwrap_err();
        assert!(err.contains("elements"), "got: {}", err);
    }

    #[test]
    fn import_rejects_non_array_elements() {
        let err = parse_excalidraw_file(r#"{"type":"excalidraw","elements":{}}"#).unwrap_err();
        assert!(err.contains("elements"), "got: {}", err);
    }

    #[test]
    fn import_rejects_a_json_array() {
        let err = parse_excalidraw_file("[]").unwrap_err();
        assert!(err.contains("object"), "got: {}", err);
    }

    #[test]
    fn round_trip_preserves_elements() {
        let doc = to_excalidraw_file(json!([{"id": "a"}, {"id": "b"}]), json!({}), None);
        let scene = parse_excalidraw_file(&doc.to_string()).expect("exported file must import");
        assert_eq!(scene.elements.as_array().unwrap().len(), 2);
        assert_eq!(scene.elements[1]["id"], "b");
    }

}
