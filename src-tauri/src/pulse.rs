//! Pulse stem import + analysis persistence.
//!
//! `pulse_import` normalizes a user-picked folder of audio files into the
//! project's `stems/` dir as 48 kHz stereo WAV using the system ffmpeg, so
//! the frontend's Web Audio `decodeAudioData` is reliable across codecs.
//! Filenames are recorded but NOT trusted — classification happens later
//! in the frontend from the audio itself.
//!
//! `pulse_write_analysis` persists the immutable `analysis.json` timeline
//! the frontend computes, via the same atomic tmp+rename as `save_doc`.

use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportedStem {
    pub id: String,
    pub file: String,
    pub source_name: String,
}

#[derive(serde::Serialize, Clone)]
struct Progress {
    index: usize,
    total: usize,
    name: String,
}

const AUDIO_EXTS: &[&str] = &["wav", "mp3", "aiff", "aif", "flac", "m4a", "ogg"];

#[tauri::command]
pub async fn pulse_import(
    app: AppHandle,
    project_path: String,
    folder: String,
) -> Result<Vec<ImportedStem>, String> {
    let src = PathBuf::from(&folder);
    let stems_dir = PathBuf::from(&project_path).join("stems");
    std::fs::create_dir_all(&stems_dir).map_err(|e| e.to_string())?;

    let mut entries: Vec<PathBuf> = std::fs::read_dir(&src)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.extension()
                .and_then(|x| x.to_str())
                .map(|s| AUDIO_EXTS.contains(&s.to_lowercase().as_str()))
                .unwrap_or(false)
        })
        .collect();
    entries.sort();
    let total = entries.len();
    if total == 0 {
        return Err("No audio files found in folder".into());
    }

    let mut out = Vec::new();
    for (i, path) in entries.iter().enumerate() {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("stem")
            .to_string();
        let _ = app.emit(
            "pulse://import-progress",
            Progress {
                index: i,
                total,
                name: name.clone(),
            },
        );
        let id = format!("stem-{:02}", i);
        let out_file = format!("{id}.wav");
        let out_path = stems_dir.join(&out_file);
        let status = std::process::Command::new("ffmpeg")
            .args(["-y", "-i"])
            .arg(path)
            .args(["-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le"])
            .arg(&out_path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map_err(|e| format!("ffmpeg failed to launch: {e}"))?;
        if !status.success() {
            return Err(format!("ffmpeg failed on {name}"));
        }
        out.push(ImportedStem {
            id,
            file: out_file,
            source_name: name,
        });
    }
    let _ = app.emit(
        "pulse://import-progress",
        Progress {
            index: total,
            total,
            name: "done".into(),
        },
    );
    Ok(out)
}

#[tauri::command]
pub fn pulse_write_analysis(project_path: String, json: String) -> Result<(), String> {
    let dir = PathBuf::from(&project_path);
    let tmp = dir.join("analysis.json.tmp");
    let dst = dir.join("analysis.json");
    std::fs::write(&tmp, json.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &dst).map_err(|e| e.to_string())?;
    Ok(())
}

/// Copy a picked image/video into `<project>/assets/` and return the path
/// relative to the project root (e.g. "assets/clip.mp4"). Media-source
/// effects store this relative path so the project stays self-contained.
#[tauri::command]
pub fn pulse_import_asset(project_path: String, src_path: String) -> Result<String, String> {
    let src = PathBuf::from(&src_path);
    let name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "bad source filename".to_string())?;
    let assets = PathBuf::from(&project_path).join("assets");
    std::fs::create_dir_all(&assets).map_err(|e| format!("mkdir assets: {}", e))?;
    let dst = assets.join(name);
    std::fs::copy(&src, &dst).map_err(|e| format!("copy: {}", e))?;
    Ok(format!("assets/{}", name))
}
