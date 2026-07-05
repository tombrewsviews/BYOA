//! Generic app installer for DreamStore.
//!
//! Apps are listed in the store but not installed by default. Installing an
//! app materializes `~/Applications/DreamStore/<AppName>/` (manifest.json +
//! declared asset bytes provided by the frontend) and records the app id in
//! `~/.dreamstore/installed.json`. Native app CODE stays compiled into the
//! binary (built-in tier); uninstall removes only the folder + registry entry.
//!
//! In DS-1 the installed folder is a STATE MARKER (plus a forward-looking asset
//! stage): the running app still loads its own assets from its bundled imports,
//! not from this folder. Nothing reads `~/Applications/DreamStore/<App>/` at
//! runtime yet. DS-2 is where the shell loads an app's frontend + assets FROM
//! this folder; the manifest + asset bytes are written now so that transition
//! is a read-side change only.
//!
//! Source of truth = registry entry AND folder both present. `reconcile()`
//! prunes drift on startup.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct InstallAsset {
    pub name: String,
    pub bytes: Vec<u8>,
}

/// Registry entry: id (stable app id) + name (install folder name).
#[derive(Serialize, Deserialize, Clone)]
struct InstalledEntry {
    id: String,
    name: String,
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

fn install_into(
    base: &Path,
    reg: &Path,
    app_id: &str,
    app_name: &str,
    manifest_json: &str,
    assets: Vec<InstallAsset>,
) -> Result<(), String> {
    let app_name = safe_name(app_name)?;
    let app_dir = base.join(app_name);
    // Build into a temp sibling then rename into place (atomic-ish).
    let staging = base.join(format!(".{}.staging", app_name));
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    fs::create_dir_all(&staging).map_err(|e| format!("mkdir staging: {}", e))?;
    fs::write(staging.join("manifest.json"), manifest_json.as_bytes())
        .map_err(|e| format!("write manifest: {}", e))?;
    for a in &assets {
        let name = safe_name(&a.name)?;
        fs::write(staging.join(name), &a.bytes)
            .map_err(|e| format!("write asset {}: {}", name, e))?;
    }
    if app_dir.exists() {
        fs::remove_dir_all(&app_dir).map_err(|e| format!("clear old: {}", e))?;
    }
    fs::rename(&staging, &app_dir).map_err(|e| format!("rename into place: {}", e))?;

    let mut entries = read_registry(reg);
    if let Some(e) = entries.iter_mut().find(|e| e.id == app_id) {
        e.name = app_name.to_string();
    } else {
        entries.push(InstalledEntry { id: app_id.to_string(), name: app_name.to_string() });
    }
    write_registry(reg, &entries)
}

fn uninstall_into(base: &Path, reg: &Path, app_id: &str, app_name: &str) -> Result<(), String> {
    let app_name = safe_name(app_name)?;
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
        .filter(|e| base.join(&e.name).join("manifest.json").exists())
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
    app_id: String,
    app_name: String,
    manifest_json: String,
    assets: Vec<InstallAsset>,
) -> Result<(), String> {
    install_into(&install_root(), &registry_path(), &app_id, &app_name, &manifest_json, assets)
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

    fn asset(name: &str, bytes: &[u8]) -> InstallAsset {
        InstallAsset { name: name.into(), bytes: bytes.to_vec() }
    }

    #[test]
    fn install_creates_folder_manifest_and_assets() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");

        install_into(&base, &reg, "remit", "Remit", "{\"id\":\"remit\"}",
            vec![asset("template.pdf", b"PDFBYTES")]).unwrap();

        let app = base.join("Remit");
        assert!(app.join("manifest.json").exists());
        assert_eq!(fs::read(app.join("template.pdf")).unwrap(), b"PDFBYTES");
        let reg_txt = fs::read_to_string(&reg).unwrap();
        assert!(reg_txt.contains("remit"));
    }

    #[test]
    fn install_missing_asset_bytes_still_writes_since_bytes_provided() {
        // Bytes are provided by caller; "missing asset" is a frontend concern.
        // Here we assert an empty asset list installs cleanly (app with no assets).
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Apps");
        let reg = dir.path().join("installed.json");
        install_into(&base, &reg, "kinetic", "Kinetic Studio", "{}", vec![]).unwrap();
        assert!(base.join("Kinetic Studio").join("manifest.json").exists());
    }

    #[test]
    fn uninstall_removes_folder_and_registry_entry() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Apps");
        let reg = dir.path().join("installed.json");
        install_into(&base, &reg, "remit", "Remit", "{}", vec![]).unwrap();
        uninstall_into(&base, &reg, "remit", "Remit").unwrap();
        assert!(!base.join("Remit").exists());
        assert!(!fs::read_to_string(&reg).unwrap().contains("remit"));
    }

    #[test]
    fn reconcile_drops_entry_when_folder_gone() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Apps");
        let reg = dir.path().join("installed.json");
        install_into(&base, &reg, "remit", "Remit", "{}", vec![]).unwrap();
        fs::remove_dir_all(base.join("Remit")).unwrap();
        reconcile_in(&base, &reg);
        assert!(!fs::read_to_string(&reg).unwrap().contains("remit"));
    }

    #[test]
    fn install_is_atomic_no_partial_on_ok() {
        // Re-installing overwrites cleanly (idempotent).
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Apps");
        let reg = dir.path().join("installed.json");
        install_into(&base, &reg, "remit", "Remit", "{\"v\":1}", vec![]).unwrap();
        install_into(&base, &reg, "remit", "Remit", "{\"v\":2}", vec![]).unwrap();
        let m = fs::read_to_string(base.join("Remit").join("manifest.json")).unwrap();
        assert!(m.contains("\"v\":2"));
    }

    #[test]
    fn install_rejects_traversal_app_name() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");

        // Relative traversal must be rejected and must not create anything outside base.
        assert!(install_into(&base, &reg, "evil", "../escape", "{}", vec![]).is_err());
        assert!(!dir.path().join("escape").exists());
        assert!(!base.parent().unwrap().join("escape").exists());

        // Absolute app_name must also be rejected.
        assert!(install_into(&base, &reg, "evil", "/tmp/evil-dreamstore-test", "{}", vec![]).is_err());
        assert!(!Path::new("/tmp/evil-dreamstore-test").exists());
    }

    #[test]
    fn uninstall_rejects_traversal_app_name() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");

        assert!(uninstall_into(&base, &reg, "evil", "../escape").is_err());
    }

    #[test]
    fn launch_resolves_installed_bundle_path() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        // Simulate an installed app: registry entry + a bundle dir on disk.
        fs::create_dir_all(base.join("Remit.app")).unwrap();
        write_registry(&reg, &[InstalledEntry { id: "remit".into(), name: "Remit.app".into() }])
            .unwrap();

        let path = resolve_installed_bundle(&base, &reg, "remit").unwrap();
        assert_eq!(path, base.join("Remit.app"));
    }

    #[test]
    fn launch_errors_when_not_installed() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        // No registry entry at all.
        assert!(resolve_installed_bundle(&base, &reg, "remit").is_err());
    }

    #[test]
    fn launch_errors_when_registered_but_bundle_missing() {
        let dir = TempDir::new().unwrap();
        let base = dir.path().join("Applications/DreamStore");
        let reg = dir.path().join("installed.json");
        // Registered but the .app on disk is gone.
        write_registry(&reg, &[InstalledEntry { id: "remit".into(), name: "Remit.app".into() }])
            .unwrap();
        assert!(resolve_installed_bundle(&base, &reg, "remit").is_err());
    }
}
