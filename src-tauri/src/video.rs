//! Video import + YouTube download.
//!
//! Two commands:
//!   - `import_local_video`: copies a user-picked file into the project's
//!     `assets/` folder and returns the new absolute path. Studio then
//!     adds a `videoClip` beat that references the path.
//!
//!   - `download_youtube`: shells out to yt-dlp (system or bundled) to
//!     fetch a URL down to a single MP4 in `assets/`. Emits progress
//!     events on `video://yt-progress`.
//!
//! yt-dlp resolution: prefer the system `yt-dlp` on PATH (lets power
//! users `brew upgrade yt-dlp` to dodge YouTube breakage), fall back
//! to the bundled binary at `<app resources>/resources/bin/yt-dlp`.

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::AppState;

/// Downscale an MP4 in place to `w`×`h` using ffmpeg's lanczos filter.
/// Best-effort: any failure (no ffmpeg, encode error) is logged and the
/// original file is left untouched, so the export still succeeds.
fn downscale_in_place(path: &str, w: u32, h: u32) {
    let src = Path::new(path);
    let tmp = src.with_extension("downscale.mp4");
    let status = Command::new("ffmpeg")
        .arg("-y")
        .arg("-i")
        .arg(path)
        .arg("-vf")
        .arg(format!("scale={}:{}:flags=lanczos", w, h))
        .arg("-c:v")
        .arg("libx264")
        .arg("-preset")
        .arg("medium")
        .arg("-crf")
        .arg("18")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-c:a")
        .arg("copy")
        .arg(tmp.to_string_lossy().as_ref())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    match status {
        Ok(s) if s.success() && tmp.exists() => {
            if let Err(e) = fs::rename(&tmp, src) {
                eprintln!("downscale: rename failed ({e}); keeping 2× output");
                let _ = fs::remove_file(&tmp);
            }
        }
        Ok(s) => {
            eprintln!("downscale: ffmpeg exited {s}; keeping 2× output");
            let _ = fs::remove_file(&tmp);
        }
        Err(e) => {
            eprintln!("downscale: ffmpeg not run ({e}); keeping 2× output");
        }
    }
}

fn active_path(state: &AppState) -> Result<PathBuf, String> {
    state
        .active_project
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|p| p.path.clone())
        .ok_or_else(|| "no active project".into())
}

/// Where imported media lands. Now == project root, so users browsing
/// the project folder in Finder see everything together (story.json,
/// imported videos, imported images) without nested folders. The
/// .kinetic-studio/ and .claude/ subdirs keep config out of the way.
fn assets_dir(state: &AppState) -> Result<PathBuf, String> {
    active_path(state)
}

/// Find a yt-dlp executable. Prefer system `yt-dlp` on PATH because
/// users can `brew upgrade yt-dlp` to recover from YouTube changes
/// without rebuilding the app. Falls back to the bundled binary
/// shipped with the .app under `resources/bin/yt-dlp`.
fn find_ytdlp(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(out) = Command::new("which").arg("yt-dlp").output() {
        if out.status.success() {
            let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !p.is_empty() {
                return Ok(PathBuf::from(p));
            }
        }
    }
    let resource = app
        .path()
        .resolve("resources/bin/yt-dlp", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("resolve yt-dlp resource: {}", e))?;
    if !resource.exists() {
        return Err(format!(
            "yt-dlp not found on PATH or at bundled resource: {}",
            resource.display()
        ));
    }
    Ok(resource)
}

fn unique_assets_path(dir: &Path, basename: &str) -> PathBuf {
    let mut target = dir.join(basename);
    if !target.exists() {
        return target;
    }
    let stem = Path::new(basename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let ext = Path::new(basename)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("mp4");
    for n in 2..1000 {
        target = dir.join(format!("{}-{}.{}", stem, n, ext));
        if !target.exists() {
            return target;
        }
    }
    target
}

#[tauri::command]
pub fn import_local_video(
    source: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let src = PathBuf::from(&source);
    if !src.exists() {
        return Err(format!("source not found: {}", source));
    }
    let assets = assets_dir(&state)?;
    let basename = src
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("video.mp4")
        .to_string();
    let dest = unique_assets_path(&assets, &basename);
    fs::copy(&src, &dest).map_err(|e| format!("copy: {}", e))?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub fn import_local_image(
    source: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let src = PathBuf::from(&source);
    if !src.exists() {
        return Err(format!("source not found: {}", source));
    }
    let assets = assets_dir(&state)?;
    let basename = src
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("image")
        .to_string();
    let dest = unique_assets_path(&assets, &basename);
    fs::copy(&src, &dest).map_err(|e| format!("copy: {}", e))?;
    Ok(dest.to_string_lossy().to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct YtProgress {
    pub id: String,
    pub line: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct YtDone {
    pub id: String,
    pub path: String,
}

/// Spawn yt-dlp asynchronously. Returns immediately with a job id; the
/// caller listens to `video://yt-progress` / `video://yt-done` /
/// `video://yt-error` for streaming output and completion.
#[tauri::command]
pub fn download_youtube(
    url: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    let assets = assets_dir(&state)?;
    let ytdlp = find_ytdlp(&app)?;
    let id = uuid::Uuid::new_v4().to_string();
    let id_for_thread = id.clone();
    let app_for_thread = app.clone();

    // Use yt-dlp's --output template so we always know where the file
    // lands. %(id)s = YouTube video id, %(ext)s = chosen extension.
    let out_template = assets.join("yt-%(id)s.%(ext)s");

    thread::spawn(move || {
        let mut child = match Command::new(&ytdlp)
            .arg("--no-playlist")
            .arg("--restrict-filenames")
            .arg("--merge-output-format=mp4")
            // Permissive format selector: prefer the best video+audio
            // combo ffmpeg can remux into mp4, but fall back through
            // any single best format if that fails. Strict mp4-only
            // selectors break on YouTube videos that ship in webm.
            .arg("-f")
            .arg("bv*+ba/b")
            .arg("--print")
            .arg("after_move:%(filepath)s")
            .arg("-o")
            .arg(out_template.to_string_lossy().to_string())
            .arg(&url)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let _ = app_for_thread.emit(
                    "video://yt-error",
                    YtProgress {
                        id: id_for_thread.clone(),
                        line: format!("spawn failed: {}", e),
                    },
                );
                return;
            }
        };

        // Streaming stdout — last line is the resolved filepath thanks
        // to --print after_move:%(filepath)s. We also relay every line
        // back to the UI as progress so users see something happen.
        let stdout = child.stdout.take().expect("piped");
        let stderr = child.stderr.take().expect("piped");
        let app_stdout = app_for_thread.clone();
        let id_stdout = id_for_thread.clone();
        let app_stderr = app_for_thread.clone();
        let id_stderr = id_for_thread.clone();

        // Track the last non-empty stdout line — that's the resolved
        // filepath after merge. We can't trust the file existing at the
        // template-derived path because yt-dlp may pick a different
        // extension when merge fails.
        let stdout_handle = thread::spawn(move || {
            let reader = BufReader::new(stdout);
            let mut last_path = String::new();
            for line in reader.lines().map_while(Result::ok) {
                let trimmed = line.trim().to_string();
                if !trimmed.is_empty() {
                    // Heuristic: yt-dlp's after_move print emits the
                    // absolute path, no prefix. Anything starting with
                    // a slash and ending in .mp4 is the answer.
                    if trimmed.starts_with('/') && trimmed.ends_with(".mp4") {
                        last_path = trimmed.clone();
                    }
                }
                let _ = app_stdout.emit(
                    "video://yt-progress",
                    YtProgress {
                        id: id_stdout.clone(),
                        line,
                    },
                );
            }
            last_path
        });
        let stderr_handle = thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app_stderr.emit(
                    "video://yt-progress",
                    YtProgress {
                        id: id_stderr.clone(),
                        line,
                    },
                );
            }
        });

        let last_path = stdout_handle.join().unwrap_or_default();
        let _ = stderr_handle.join();
        let status = child.wait();

        match status {
            Ok(s) if s.success() => {
                if last_path.is_empty() || !Path::new(&last_path).exists() {
                    let _ = app_for_thread.emit(
                        "video://yt-error",
                        YtProgress {
                            id: id_for_thread.clone(),
                            line: "yt-dlp succeeded but final path is unknown"
                                .into(),
                        },
                    );
                    return;
                }
                let _ = app_for_thread.emit(
                    "video://yt-done",
                    YtDone {
                        id: id_for_thread,
                        path: last_path,
                    },
                );
            }
            Ok(s) => {
                let _ = app_for_thread.emit(
                    "video://yt-error",
                    YtProgress {
                        id: id_for_thread.clone(),
                        line: format!("yt-dlp exited {}", s),
                    },
                );
            }
            Err(e) => {
                let _ = app_for_thread.emit(
                    "video://yt-error",
                    YtProgress {
                        id: id_for_thread.clone(),
                        line: format!("yt-dlp wait failed: {}", e),
                    },
                );
            }
        }
    });

    Ok(id)
}

// ---------------------------------------------------------------------------
// MP4 export — shells out to the Remotion CLI, streaming progress exactly
// like download_youtube above.
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub id: String,
    pub line: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportDone {
    pub id: String,
    pub path: String,
}

/// Locate the directory that holds `remotion.config.ts` + the composition
/// entrypoint — the render must run from there so Remotion finds its root.
///
/// Bundled app: the composition ships in the resource dir. Dev: walk up from
/// the Cargo manifest dir (src-tauri/) to the repo root.
fn remotion_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(res) = app.path().resolve("", tauri::path::BaseDirectory::Resource) {
        if res.join("remotion.config.ts").exists() {
            return Ok(res);
        }
    }
    let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for _ in 0..4 {
        if dir.join("remotion.config.ts").exists() {
            return Ok(dir);
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
    }
    Err("could not locate remotion.config.ts (render root)".into())
}

/// Collect the absolute media paths a story references (imageSrc / videoSrc).
/// The CLI renderer can't load arbitrary filesystem paths — headless Chromium
/// blocks file:// and mis-resolves absolute paths — so the export stages these
/// into Remotion's public/ dir and the composition references them by basename
/// via staticFile().
fn story_media_paths(story_json: &Path) -> Vec<PathBuf> {
    let text = match fs::read_to_string(story_json) {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };
    let value: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let mut paths = Vec::new();
    if let Some(beats) = value.get("beats").and_then(|b| b.as_array()) {
        for beat in beats {
            for key in ["imageSrc", "videoSrc"] {
                if let Some(p) = beat.get(key).and_then(|s| s.as_str()) {
                    if p.starts_with('/') {
                        paths.push(PathBuf::from(p));
                    }
                }
            }
        }
    }
    paths
}

/// A media file staged into Remotion's public/ dir for the duration of a
/// render. Removed on drop so an interrupted render doesn't litter public/.
struct StagedMedia {
    dest: PathBuf,
    /// True only when WE created the file (it wasn't already there) — we must
    /// not delete a file that legitimately ships in public/.
    owned: bool,
}

impl Drop for StagedMedia {
    fn drop(&mut self) {
        if self.owned {
            let _ = fs::remove_file(&self.dest);
        }
    }
}

/// Copy each referenced media file into `<root>/public/<basename>`. Returns
/// guards that clean the copies up on drop. Files already present in public/
/// are left untouched (owned=false).
fn stage_media(root: &Path, media: &[PathBuf]) -> Result<Vec<StagedMedia>, String> {
    let public = root.join("public");
    fs::create_dir_all(&public).map_err(|e| format!("create public/: {}", e))?;
    let mut staged = Vec::new();
    for src in media {
        if !src.exists() {
            // Skip missing media — the render shows the "(no image source)"
            // placeholder rather than failing the whole export.
            continue;
        }
        let basename = match src.file_name() {
            Some(n) => n,
            None => continue,
        };
        let dest = public.join(basename);
        let owned = !dest.exists();
        if owned {
            fs::copy(src, &dest)
                .map_err(|e| format!("stage {}: {}", src.display(), e))?;
        }
        staged.push(StagedMedia { dest, owned });
    }
    Ok(staged)
}

/// Render the active project's `story.json` to an MP4 in the project folder.
/// Returns a job id immediately; the caller listens on
/// `video://export-progress` / `video://export-done` / `video://export-error`.
#[tauri::command]
pub fn export_video(
    state: State<'_, AppState>,
    app: AppHandle,
    scale: Option<u32>,
) -> Result<String, String> {
    // Render scale. 1 = quick draft (no supersampling). >1 supersamples then
    // downscales back to delivery size to tame variable-font edge shimmer
    // (2 ≈ 96% reduction, 3 ≈ 98%). Clamp to a sane range.
    let scale = scale.unwrap_or(1).clamp(1, 4);
    let project = active_path(&state)?;
    let story = project.join("story.json");
    if !story.exists() {
        return Err(format!("story.json not found in {}", project.display()));
    }
    let root = remotion_root(&app)?;
    let out = unique_assets_path(&project, "export.mp4");

    let id = uuid::Uuid::new_v4().to_string();
    let id_for_thread = id.clone();
    let app_for_thread = app.clone();
    let out_path = out.to_string_lossy().to_string();
    let out_done = out_path.clone();
    let story_arg = story.to_string_lossy().to_string();
    let media = story_media_paths(&story);
    let root_for_thread = root.clone();

    thread::spawn(move || {
        // Stage any project media into Remotion's public/ so staticFile() in
        // the composition can serve it. The guards live for the whole render
        // and remove the staged copies when this scope ends.
        let _staged = match stage_media(&root_for_thread, &media) {
            Ok(s) => s,
            Err(e) => {
                let _ = app_for_thread.emit(
                    "video://export-error",
                    ExportProgress {
                        id: id_for_thread.clone(),
                        line: format!("staging media failed: {}", e),
                    },
                );
                return;
            }
        };

        // Prefer the project-local remotion bin; fall back to npx.
        let local_bin = root.join("node_modules/.bin/remotion");
        let (program, base_args): (PathBuf, Vec<String>) = if local_bin.exists() {
            (local_bin, vec!["render".into()])
        } else {
            (PathBuf::from("npx"), vec!["remotion".into(), "render".into()])
        };

        // Supersampling is what tames the per-letter edge shimmer: at 1× the
        // variable-font glyph edges land on fractional pixels where Chromium's
        // text rasterizer rounds them non-deterministically frame-to-frame
        // (~518 changed px/frame in the settled hold). Rendering at scale N
        // samples those edges at N× density, so the post-downscale averages
        // the ambiguity away (2× ≈ 96%, 3× ≈ 98% reduction) while preserving
        // the variable-font weight/width animation. scale=1 skips both
        // (quick draft — shows the jitter but renders ~N²× faster).
        let mut cmd = Command::new(&program);
        cmd.current_dir(&root)
            .args(&base_args)
            .arg("KineticStory")
            .arg(&out_path)
            .arg(format!("--props={}", story_arg));
        if scale > 1 {
            cmd.arg(format!("--scale={}", scale));
        }
        cmd.stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = app_for_thread.emit(
                    "video://export-error",
                    ExportProgress {
                        id: id_for_thread.clone(),
                        line: format!("spawn failed: {}", e),
                    },
                );
                return;
            }
        };

        let stdout = child.stdout.take().expect("piped");
        let stderr = child.stderr.take().expect("piped");
        let a1 = app_for_thread.clone();
        let i1 = id_for_thread.clone();
        let a2 = app_for_thread.clone();
        let i2 = id_for_thread.clone();

        let h1 = thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = a1.emit(
                    "video://export-progress",
                    ExportProgress {
                        id: i1.clone(),
                        line,
                    },
                );
            }
        });
        let h2 = thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let _ = a2.emit(
                    "video://export-progress",
                    ExportProgress {
                        id: i2.clone(),
                        line,
                    },
                );
            }
        });
        let _ = h1.join();
        let _ = h2.join();

        match child.wait() {
            Ok(s) if s.success() && Path::new(&out_done).exists() => {
                // A supersampled render produced an N×(1080×1920) file.
                // Downscale it back to the 1080×1920 delivery size with a
                // high-quality (lanczos) filter — this is the step that
                // averages out the per-letter edge shimmer. Skipped for the
                // 1× quick draft. Best-effort: if ffmpeg is unavailable the
                // larger file is still a valid export.
                if scale > 1 {
                    downscale_in_place(&out_done, 1080, 1920);
                }
                let _ = app_for_thread.emit(
                    "video://export-done",
                    ExportDone {
                        id: id_for_thread,
                        path: out_done,
                    },
                );
            }
            Ok(s) => {
                let _ = app_for_thread.emit(
                    "video://export-error",
                    ExportProgress {
                        id: id_for_thread.clone(),
                        line: format!("remotion exited {}", s),
                    },
                );
            }
            Err(e) => {
                let _ = app_for_thread.emit(
                    "video://export-error",
                    ExportProgress {
                        id: id_for_thread.clone(),
                        line: format!("wait failed: {}", e),
                    },
                );
            }
        }
    });

    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn story_media_paths_collects_absolute_image_and_video_src() {
        let dir = std::env::temp_dir().join(format!("kt-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let story = dir.join("story.json");
        let mut f = std::fs::File::create(&story).unwrap();
        write!(
            f,
            r#"{{"beats":[
                {{"kind":"imageClip","imageSrc":"/abs/pic.png"}},
                {{"kind":"videoClip","videoSrc":"/abs/clip.mp4"}},
                {{"kind":"reveal","text":"hi"}},
                {{"kind":"imageClip","imageSrc":"relative.png"}}
            ]}}"#
        )
        .unwrap();

        let paths = story_media_paths(&story);
        assert_eq!(paths.len(), 2, "only absolute imageSrc/videoSrc collected");
        assert!(paths.contains(&PathBuf::from("/abs/pic.png")));
        assert!(paths.contains(&PathBuf::from("/abs/clip.mp4")));
        // relative paths are skipped (only leading-slash absolutes staged)
        assert!(!paths.iter().any(|p| p.to_string_lossy().contains("relative.png")));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn story_media_paths_handles_missing_or_malformed_file() {
        assert!(story_media_paths(Path::new("/nonexistent/story.json")).is_empty());
    }
}
