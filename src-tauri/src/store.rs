//! Generic app installer for DreamStore.
//!
//! Apps are listed in the store but not installed by default. Installing an
//! app materializes `~/Applications/DreamStore/<AppName>/` (manifest.json +
//! declared asset bytes provided by the frontend) and records the app id in
//! `~/.dreamstore/installed.json`. Native app CODE stays compiled into the
//! binary (built-in tier); uninstall removes only the folder + registry entry.
//!
//! In DS2′-B the installed folder IS the app: `app_install` copies the built
//! `<App>.app` bundle out of `DreamStore.app/Contents/Resources/apps/` into
//! `~/Applications/DreamStore/<App>.app`, and `app_launch` `open`s it as an
//! independent macOS process. `app_install_states`/`reconcile` track presence
//! by the bundle on disk (not a manifest file).
//!
//! Source of truth = registry entry AND folder both present. `reconcile()`
//! prunes drift on startup.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Registry entry: id (stable app id) + name (install folder name).
#[derive(Serialize, Deserialize, Clone)]
struct InstalledEntry {
    id: String,
    name: String,
    /// True if this install copied a `.app` bundle (launchable apps); false
    /// for registry-only state-marker installs (in-process apps with no
    /// bundle). Reconcile prunes only bundle installs whose `.app` vanished.
    #[serde(default)]
    bundle: bool,
}

fn install_root() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join("Applications").join("DreamStore"))
        .unwrap_or_else(|| PathBuf::from("Applications/DreamStore"))
}

fn registry_path() -> PathBuf {
    crate::paths::user_path("installed.json")
}

fn read_registry(reg: &Path) -> Vec<InstalledEntry> {
    fs::read_to_string(reg)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<InstalledEntry>>(&s).ok())
        .unwrap_or_default()
}

fn write_registry(reg: &Path, entries: &[InstalledEntry]) -> Result<(), String> {
    if let Some(parent) = reg.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir registry: {}", e))?;
    }
    let body = serde_json::to_string(entries).map_err(|e| format!("serialize registry: {}", e))?;
    let tmp = reg.with_extension("json.tmp");
    fs::write(&tmp, body.as_bytes()).map_err(|e| format!("write registry tmp: {}", e))?;
    fs::rename(&tmp, reg).map_err(|e| format!("rename registry: {}", e))
}

/// Sanitise a name to a bare basename so it can't escape the app folder.
/// Rejects `.`, `..`, empty, and anything that isn't already a single path
/// component (i.e. any name containing separators or traversal segments), so
/// callers can't join their way outside the install root.
fn safe_name(name: &str) -> Result<&str, String> {
    let base = Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| format!("invalid name: {}", name))?;
    if base != name {
        return Err(format!("invalid name: {}", name));
    }
    Ok(base)
}

/// Map a display name (e.g. "Remit") to its macOS bundle dir name
/// ("Remit.app"). Idempotent: a name that already ends in ".app" is left
/// as-is, so callers may pass either form.
fn bundle_name(app_name: &str) -> String {
    if app_name.ends_with(".app") {
        app_name.to_string()
    } else {
        format!("{}.app", app_name)
    }
}

/// Recursively copy a directory tree (std has no built-in recursive copy).
fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("mkdir {}: {}", dst.display(), e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("read {}: {}", src.display(), e))? {
        let entry = entry.map_err(|e| format!("dir entry: {}", e))?;
        let ty = entry.file_type().map_err(|e| format!("file type: {}", e))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| format!("copy {}: {}", from.display(), e))?;
        }
    }
    Ok(())
}

/// Copy the bundled `<app_name>` (a `.app` dir) from `resources_apps` into the
/// install root via a staged temp + rename, then record the registry entry.
fn copy_bundle_into(
    base: &Path,
    reg: &Path,
    resources_apps: &Path,
    app_id: &str,
    app_name: &str,
) -> Result<(), String> {
    let safe = safe_name(app_name)?;
    let bundled = bundle_name(safe);
    let app_name = safe_name(&bundled)?; // normalized + basename-guarded
    let source = resources_apps.join(app_name);
    if !source.exists() {
        return Err(format!("app bundle not found in DreamStore resources: {}", source.display()));
    }
    let app_dir = base.join(app_name);
    let staging = base.join(format!(".{}.staging", app_name));
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    copy_dir_all(&source, &staging)?;
    if app_dir.exists() {
        fs::remove_dir_all(&app_dir).map_err(|e| format!("clear old: {}", e))?;
    }
    fs::rename(&staging, &app_dir).map_err(|e| format!("rename into place: {}", e))?;

    let mut entries = read_registry(reg);
    if let Some(e) = entries.iter_mut().find(|e| e.id == app_id) {
        e.name = app_name.to_string();
        e.bundle = true;
    } else {
        entries.push(InstalledEntry { id: app_id.to_string(), name: app_name.to_string(), bundle: true });
    }
    write_registry(reg, &entries)
}

/// Register an in-process app (no bundle to copy). State-marker install: the
/// registry entry is the only artifact; Open mounts the app's Root in-window.
fn install_registry_only(reg: &Path, app_id: &str, app_name: &str) -> Result<(), String> {
    let app_name = safe_name(app_name)?;
    let mut entries = read_registry(reg);
    if let Some(e) = entries.iter_mut().find(|e| e.id == app_id) {
        e.name = app_name.to_string();
        e.bundle = false;
    } else {
        entries.push(InstalledEntry { id: app_id.to_string(), name: app_name.to_string(), bundle: false });
    }
    write_registry(reg, &entries)
}

fn uninstall_into(base: &Path, reg: &Path, app_id: &str, app_name: &str) -> Result<(), String> {
    let safe = safe_name(app_name)?;
    let bundled = bundle_name(safe);
    let app_name = safe_name(&bundled)?;
    let app_dir = base.join(app_name);
    if app_dir.exists() {
        fs::remove_dir_all(&app_dir).map_err(|e| format!("remove app dir: {}", e))?;
    }
    let entries: Vec<InstalledEntry> =
        read_registry(reg).into_iter().filter(|e| e.id != app_id).collect();
    write_registry(reg, &entries)
}

fn reconcile_in(base: &Path, reg: &Path) {
    let kept: Vec<InstalledEntry> = read_registry(reg)
        .into_iter()
        .filter(|e| !e.bundle || base.join(&e.name).exists())
        .collect();
    let _ = write_registry(reg, &kept);
}

/// Resolve the installed `.app` bundle path for an app id, erroring if the
/// app isn't registered or its bundle is gone. Pure (no process spawn) so it
/// can be unit-tested.
fn resolve_installed_bundle(base: &Path, reg: &Path, app_id: &str) -> Result<PathBuf, String> {
    let entry = read_registry(reg)
        .into_iter()
        .find(|e| e.id == app_id)
        .ok_or_else(|| format!("app not installed: {}", app_id))?;
    let name = safe_name(&entry.name)?;
    let bundle = base.join(name);
    if !bundle.exists() {
        return Err(format!("installed bundle missing: {}", bundle.display()));
    }
    Ok(bundle)
}

#[tauri::command]
pub fn app_install(
    app: tauri::AppHandle,
    app_id: String,
    app_name: String,
    launchable: bool,
) -> Result<(), String> {
    if !launchable {
        return install_registry_only(&registry_path(), &app_id, &app_name);
    }
    use tauri::Manager;
    let resources_apps = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resolve resource dir: {}", e))?
        .join("resources/apps");
    copy_bundle_into(&install_root(), &registry_path(), &resources_apps, &app_id, &app_name)
}

#[tauri::command]
pub fn app_uninstall(app_id: String, app_name: String) -> Result<(), String> {
    uninstall_into(&install_root(), &registry_path(), &app_id, &app_name)
}

#[tauri::command]
pub fn app_install_states() -> Result<Vec<String>, String> {
    let base = install_root();
    let reg = registry_path();
    reconcile_in(&base, &reg);
    Ok(read_registry(&reg).into_iter().map(|e| e.id).collect())
}

#[tauri::command]
pub fn app_launch(app_id: String) -> Result<(), String> {
    let bundle = resolve_installed_bundle(&install_root(), &registry_path(), &app_id)?;
    // macOS `open` focuses an already-running app instead of duplicating it.
    std::process::Command::new("open")
        .arg(&bundle)
        .status()
        .map_err(|e| format!("open {}: {}", bundle.display(), e))
        .and_then(|s| if s.success() { Ok(()) } else { Err("open failed".into()) })
}

pub fn reconcile() {
    reconcile_in(&install_root(), &registry_path());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Make a fake `.app` bundle (a dir with a marker file) under `resources_apps`.
    fn fake_bundle(resources_apps: &Path, name: &str) {
        let app = resources_apps.join(name);
        fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
        fs::write(app.join("Contents/Info.plist"), b"<plist/>").unwrap();
    }

    #[test]
    fn install_copies_bundle_and_records_registry() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        let res = dir.path().join("resources/apps");
        fake_bundle(&res, "Remit.app");

        copy_bundle_into(&base, &reg, &res, "remit", "Remit.app").unwrap();

        assert!(base.join("Remit.app/Contents/Info.plist").exists());
        assert!(fs::read_to_string(&reg).unwrap().contains("remit"));
    }

    #[test]
    fn install_errors_when_bundle_absent_from_resources() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        let res = dir.path().join("resources/apps"); // empty, no Remit.app
        fs::create_dir_all(&res).unwrap();

        let err = copy_bundle_into(&base, &reg, &res, "remit", "Remit.app").unwrap_err();
        assert!(err.contains("app bundle not found"), "got: {}", err);
    }

    #[test]
    fn install_overwrites_existing_bundle_idempotently() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        let res = dir.path().join("resources/apps");
        fake_bundle(&res, "Remit.app");

        copy_bundle_into(&base, &reg, &res, "remit", "Remit.app").unwrap();
        // Re-install (e.g. after an app update) must not error or leave staging.
        copy_bundle_into(&base, &reg, &res, "remit", "Remit.app").unwrap();
        assert!(base.join("Remit.app/Contents/Info.plist").exists());
        assert!(!base.join(".Remit.app.staging").exists());
    }

    #[test]
    fn install_rejects_traversal_app_name() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        let res = dir.path().join("resources/apps");
        fs::create_dir_all(&res).unwrap();

        assert!(copy_bundle_into(&base, &reg, &res, "evil", "../escape").is_err());
        assert!(!dir.path().join("escape").exists());
        assert!(copy_bundle_into(&base, &reg, &res, "evil", "/tmp/evil-ds-test.app").is_err());
        assert!(!Path::new("/tmp/evil-ds-test.app").exists());
    }

    #[test]
    fn uninstall_removes_bundle_and_registry_entry() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        let res = dir.path().join("resources/apps");
        fake_bundle(&res, "Remit.app");
        copy_bundle_into(&base, &reg, &res, "remit", "Remit.app").unwrap();

        uninstall_into(&base, &reg, "remit", "Remit.app").unwrap();
        assert!(!base.join("Remit.app").exists());
        assert!(!fs::read_to_string(&reg).unwrap().contains("remit"));
    }

    #[test]
    fn reconcile_drops_entry_when_bundle_gone() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        let res = dir.path().join("resources/apps");
        fake_bundle(&res, "Remit.app");
        copy_bundle_into(&base, &reg, &res, "remit", "Remit.app").unwrap();

        fs::remove_dir_all(base.join("Remit.app")).unwrap();
        reconcile_in(&base, &reg);
        assert!(!fs::read_to_string(&reg).unwrap().contains("remit"));
    }

    // ---- launch resolution (from Task 2) ----

    #[test]
    fn launch_resolves_installed_bundle_path() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        fs::create_dir_all(base.join("Remit.app")).unwrap();
        write_registry(&reg, &[InstalledEntry { id: "remit".into(), name: "Remit.app".into(), bundle: true }])
            .unwrap();
        assert_eq!(
            resolve_installed_bundle(&base, &reg, "remit").unwrap(),
            base.join("Remit.app")
        );
    }

    #[test]
    fn launch_errors_when_not_installed() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        assert!(resolve_installed_bundle(&base, &reg, "remit").is_err());
    }

    #[test]
    fn launch_errors_when_registered_but_bundle_missing() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        write_registry(&reg, &[InstalledEntry { id: "remit".into(), name: "Remit.app".into(), bundle: true }])
            .unwrap();
        assert!(resolve_installed_bundle(&base, &reg, "remit").is_err());
    }

    #[test]
    fn install_accepts_display_name_and_resolves_dot_app_bundle() {
        // The frontend sends the DISPLAY name ("Remit"), NOT "Remit.app".
        // Regression guard for the appName/bundle-filename mismatch.
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        let res = dir.path().join("resources/apps");
        fake_bundle(&res, "Remit.app");

        // Pass "Remit" (display name), not "Remit.app".
        copy_bundle_into(&base, &reg, &res, "remit", "Remit").unwrap();

        // Installed under the .app name, registry stores the .app name,
        // and launch resolution finds it — the full chain with the real input.
        assert!(base.join("Remit.app/Contents/Info.plist").exists());
        assert!(fs::read_to_string(&reg).unwrap().contains("Remit.app"));
        assert_eq!(
            resolve_installed_bundle(&base, &reg, "remit").unwrap(),
            base.join("Remit.app")
        );
    }

    #[test]
    fn uninstall_accepts_display_name() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        let res = dir.path().join("resources/apps");
        fake_bundle(&res, "Remit.app");
        copy_bundle_into(&base, &reg, &res, "remit", "Remit").unwrap();

        // Uninstall also gets the display name from the frontend.
        uninstall_into(&base, &reg, "remit", "Remit").unwrap();
        assert!(!base.join("Remit.app").exists());
        assert!(!fs::read_to_string(&reg).unwrap().contains("remit"));
    }

    #[test]
    fn bundle_name_is_idempotent() {
        assert_eq!(bundle_name("Remit"), "Remit.app");
        assert_eq!(bundle_name("Remit.app"), "Remit.app");
    }

    #[test]
    fn install_non_launchable_is_registry_only_no_bundle() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        // No resources dir at all: a non-launchable install must not touch it.
        install_registry_only(&reg, "pulse", "Pulse").unwrap();
        assert!(fs::read_to_string(&reg).unwrap().contains("pulse"));
        // No bundle was created under base.
        assert!(!base.join("Pulse").exists());
        assert!(!base.join("Pulse.app").exists());
    }

    #[test]
    fn reconcile_keeps_registry_only_entry_but_prunes_missing_bundle() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        // A registry-only (non-bundle) entry: no .app on disk, must be KEPT.
        install_registry_only(&reg, "pulse", "Pulse").unwrap();
        // A bundle entry whose .app is gone: must be PRUNED.
        write_registry(&reg, &[
            InstalledEntry { id: "pulse".into(), name: "Pulse".into(), bundle: false },
            InstalledEntry { id: "remit".into(), name: "Remit.app".into(), bundle: true },
        ]).unwrap();
        reconcile_in(&base, &reg); // base/Remit.app does not exist
        let txt = fs::read_to_string(&reg).unwrap();
        assert!(txt.contains("pulse"), "registry-only entry kept");
        assert!(!txt.contains("remit"), "missing-bundle entry pruned");
    }
}
