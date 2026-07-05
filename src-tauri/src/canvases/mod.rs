//! Per-canvas modules. Each canvas owns the data the shell asks for
//! through the `Canvas` trait — including its agent skill bundle.

pub mod brainstorm;
pub mod data;
pub mod kinetic;
pub mod music;
// Remit's skill bundle lives in the git-ignored private overlay; it compiles
// in only when the overlay is present (see build.rs / lib.rs).
#[cfg(private_remit)]
#[path = "../canvases-private/remit_skill.rs"]
pub mod remit;
