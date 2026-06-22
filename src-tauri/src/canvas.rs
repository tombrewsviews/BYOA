//! Canvas plugins — the substrate seam.
//!
//! A *canvas* is a domain plugin: it owns the on-disk document format
//! (e.g. `story.json` for kinetic typography), supplies seed content
//! for new projects, and tells the shell how to summarise a project
//! for the project list (beat count, etc).
//!
//! The shell stays domain-agnostic. It asks the active canvas for:
//!   - the document filename (so it can watch + load + save it)
//!   - seed bytes for a new project
//!   - a per-project summary (label + count) for project cards
//!
//! v1 ships a single canvas — the kinetic-typography one. The registry
//! exists so adding a second canvas (markdown, music, 3D) doesn't
//! require touching the shell. The kinetic canvas is the default.

use std::path::Path;

pub struct ProjectSummary {
    /// Generic "count" displayed on project cards. For kinetic this is
    /// the number of beats. Canvases that don't have a natural count
    /// can return 0.
    pub count: usize,
}

pub trait Canvas: Send + Sync {
    /// Stable id, used by the settings store and skill bundle layout.
    fn id(&self) -> &'static str;

    /// Filename of the project document (relative to project root).
    fn doc_filename(&self) -> &'static str;

    /// Bytes written into the project document for a brand-new project.
    fn seed_bytes(&self) -> &'static [u8];

    /// Read a project folder and summarise it for the project list.
    fn summarise(&self, project_dir: &Path) -> ProjectSummary;

    /// The agent skill bundle this canvas ships. Called by the shell
    /// at project-open/create time to materialise the per-project
    /// skill files and CLAUDE.md.
    fn skill_bundle(&self) -> &'static crate::skill::SkillBundle;
}

/// The kinetic-typography canvas. The only canvas in v1.
pub struct KineticCanvas;

impl Canvas for KineticCanvas {
    fn id(&self) -> &'static str {
        "kinetic"
    }

    fn doc_filename(&self) -> &'static str {
        "story.json"
    }

    fn seed_bytes(&self) -> &'static [u8] {
        include_bytes!("../templates/seed-story.json")
    }

    fn summarise(&self, project_dir: &Path) -> ProjectSummary {
        let count = std::fs::read_to_string(project_dir.join(self.doc_filename()))
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v.get("beats").and_then(|b| b.as_array()).map(|a| a.len()))
            .unwrap_or(0);
        ProjectSummary { count }
    }

    fn skill_bundle(&self) -> &'static crate::skill::SkillBundle {
        &crate::canvases::kinetic::BUNDLE
    }
}

/// The music-visualizer canvas (Pulse). Its document is `project.json`.
pub struct MusicCanvas;

impl Canvas for MusicCanvas {
    fn id(&self) -> &'static str {
        "pulse"
    }

    fn doc_filename(&self) -> &'static str {
        "project.json"
    }

    fn seed_bytes(&self) -> &'static [u8] {
        include_bytes!("../templates/seed-pulse.json")
    }

    fn summarise(&self, project_dir: &Path) -> ProjectSummary {
        let count = std::fs::read_to_string(project_dir.join(self.doc_filename()))
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v.get("stems").and_then(|b| b.as_array()).map(|a| a.len()))
            .unwrap_or(0);
        ProjectSummary { count }
    }

    fn skill_bundle(&self) -> &'static crate::skill::SkillBundle {
        &crate::canvases::music::BUNDLE
    }
}

/// The Brainstorm Canvas (live Excalidraw board). Its document is a seed
/// marker `board.json`; the live scene lives in the canvas server, not the
/// file. The marker exists only so `for_project` can detect this canvas and
/// so the project lists at all.
pub struct BrainstormCanvas;

impl Canvas for BrainstormCanvas {
    fn id(&self) -> &'static str {
        "brainstorm"
    }

    fn doc_filename(&self) -> &'static str {
        "board.json"
    }

    fn seed_bytes(&self) -> &'static [u8] {
        include_bytes!("../templates/seed-board.json")
    }

    fn summarise(&self, project_dir: &Path) -> ProjectSummary {
        // Element count from the seed marker, if present. The live scene is
        // in the canvas server, so this is only meaningful right after seed
        // (0) — good enough for the project card.
        let count = std::fs::read_to_string(project_dir.join(self.doc_filename()))
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v.get("elements").and_then(|b| b.as_array()).map(|a| a.len()))
            .unwrap_or(0);
        ProjectSummary { count }
    }

    fn skill_bundle(&self) -> &'static crate::skill::SkillBundle {
        &crate::canvases::brainstorm::BUNDLE
    }
}

/// The Data Explorer canvas. Its document is `query.json` (sources + cells
/// + viz). Unlike Brainstorm, this doc is real and persisted.
pub struct DataCanvas;

impl Canvas for DataCanvas {
    fn id(&self) -> &'static str {
        "data"
    }

    fn doc_filename(&self) -> &'static str {
        "query.json"
    }

    fn seed_bytes(&self) -> &'static [u8] {
        include_bytes!("../templates/seed-query.json")
    }

    fn summarise(&self, project_dir: &Path) -> ProjectSummary {
        let count = std::fs::read_to_string(project_dir.join(self.doc_filename()))
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v.get("cells").and_then(|b| b.as_array()).map(|a| a.len()))
            .unwrap_or(0);
        ProjectSummary { count }
    }

    fn skill_bundle(&self) -> &'static crate::skill::SkillBundle {
        &crate::canvases::data::BUNDLE
    }
}

/// Resolve a canvas by its stable id. Falls back to kinetic for any
/// unknown id. Used at project-create time where the caller knows which
/// app it is.
pub fn by_id(id: &str) -> &'static dyn Canvas {
    match id {
        "pulse" => &MusicCanvas,
        "brainstorm" => &BrainstormCanvas,
        "data" => &DataCanvas,
        _ => &KineticCanvas,
    }
}

/// Resolve the canvas for a specific project folder by detecting which
/// canvas document it contains. A folder with `project.json` is a Pulse
/// project; otherwise it's treated as kinetic (the default, `story.json`).
///
/// This lets both apps share one `~/KineticStudio/` pool without a
/// separate per-project canvas-id file: the seed document IS the marker.
pub fn for_project(project_dir: &Path) -> &'static dyn Canvas {
    if project_dir.join("project.json").exists() {
        &MusicCanvas
    } else if project_dir.join("board.json").exists() {
        &BrainstormCanvas
    } else if project_dir.join("query.json").exists() {
        &DataCanvas
    } else {
        &KineticCanvas
    }
}