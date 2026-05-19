//! Content-addressed history log for the project's canvas doc.
//!
//! Each accepted full-doc state is sha256'd and written under
//! <project>/.kinetic-studio/history/<sha>.json. An index file
//! (history/index.json) lists versions in insertion order:
//!
//!     [
//!       { "sha": "...", "parent": null,    "author": "user",  "ts": "..." },
//!       { "sha": "...", "parent": "<sha>", "author": "agent", "ts": "..." }
//!     ]
//!
//! Reads return the most recent version's sha and contents. Reverts
//! append a new entry pointing at an older sha's content (so the
//! log is strictly append-only — revert is recorded, not undone).

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct HistoryEntry {
    pub sha: String,
    pub parent: Option<String>,
    pub author: String,
    pub ts: String,
}

pub fn history_dir(project_root: &Path) -> PathBuf {
    project_root.join(".kinetic-studio").join("history")
}

pub fn index_path(project_root: &Path) -> PathBuf {
    history_dir(project_root).join("index.json")
}

fn sha_of(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

pub fn read_index(project_root: &Path) -> Vec<HistoryEntry> {
    fs::read_to_string(index_path(project_root))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn write_entry(
    project_root: &Path,
    doc_bytes: &[u8],
    author: &str,
) -> Result<HistoryEntry, String> {
    let sha = sha_of(doc_bytes);
    let dir = history_dir(project_root);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir history: {}", e))?;

    let blob_path = dir.join(format!("{}.json", &sha));
    if !blob_path.exists() {
        fs::write(&blob_path, doc_bytes)
            .map_err(|e| format!("write history blob: {}", e))?;
    }

    let mut index = read_index(project_root);
    let parent = index.last().map(|e| e.sha.clone());
    let entry = HistoryEntry {
        sha: sha.clone(),
        parent,
        author: author.to_string(),
        ts: chrono::Utc::now().to_rfc3339(),
    };
    index.push(entry.clone());

    let index_json = serde_json::to_string_pretty(&index)
        .map_err(|e| format!("serialise index: {}", e))?;
    fs::write(index_path(project_root), index_json)
        .map_err(|e| format!("write index: {}", e))?;

    Ok(entry)
}

pub fn read_blob(project_root: &Path, sha: &str) -> Result<Vec<u8>, String> {
    fs::read(history_dir(project_root).join(format!("{}.json", sha)))
        .map_err(|e| format!("read blob {}: {}", sha, e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn write_and_read_one_entry() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        let doc = br#"{"hello":"world"}"#;
        let entry = write_entry(root, doc, "user").unwrap();
        assert!(entry.parent.is_none(), "first entry has no parent");
        assert_eq!(entry.author, "user");

        let read_back = read_blob(root, &entry.sha).unwrap();
        assert_eq!(read_back, doc);

        let index = read_index(root);
        assert_eq!(index.len(), 1);
        assert_eq!(index[0], entry);
    }

    #[test]
    fn second_entry_points_at_first() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        let first = write_entry(root, br#"{"v":1}"#, "user").unwrap();
        let second = write_entry(root, br#"{"v":2}"#, "agent").unwrap();

        assert_eq!(second.parent, Some(first.sha.clone()));
        assert_eq!(read_index(root).len(), 2);
    }

    #[test]
    fn identical_content_deduplicates_blob_but_appends_index() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        let body = br#"{"same":"content"}"#;
        let first = write_entry(root, body, "user").unwrap();
        let second = write_entry(root, body, "user").unwrap();

        assert_eq!(first.sha, second.sha, "same content → same sha");
        let index = read_index(root);
        assert_eq!(index.len(), 2, "two entries even though content is identical");
    }
}
