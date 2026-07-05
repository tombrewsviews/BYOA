use std::path::Path;

fn main() {
    // Private apps live in a git-ignored overlay (`src/canvases-private/` +
    // sibling `skills-private/` / `templates-private/`). They compile in only
    // when the overlay is present; a shared/distributed clone has no overlay
    // and builds without them.
    //
    // For each private app, if its overlay source is present, emit a
    // `--cfg <flag>` so the tracked shell can gate the app's module, commands,
    // and canvas seams behind `#[cfg(<flag>)]`. Always declare the flag to
    // `rustc-check-cfg` so the gates don't warn as unexpected cfgs when the
    // overlay is absent.
    //
    // Adding another private app = add a `(marker, flag)` row here and gate its
    // seams with `#[cfg(<flag>)]`.
    let private_apps: &[(&str, &str)] =
        &[("src/canvases-private/remit_commands.rs", "private_remit")];

    for (marker, flag) in private_apps {
        println!("cargo::rustc-check-cfg=cfg({flag})");
        println!("cargo::rerun-if-changed={marker}");
        if Path::new(marker).exists() {
            println!("cargo::rustc-cfg={flag}");
        }
    }

    tauri_build::build()
}
