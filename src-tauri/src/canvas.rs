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

/// The active canvas for this build. Hardcoded for now; when a second
/// canvas lands this becomes a per-project setting (the project's
/// canvas id lives in `.kinetic-studio/canvas` or similar).
pub fn active() -> &'static dyn Canvas {
    &KineticCanvas
}
