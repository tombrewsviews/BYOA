//! Thin git wrappers for the Pulse release flow. Each command operates on
//! a given repo directory by shelling out to the system `git`. Used so the
//! app (or the agent) can branch/commit/merge when authoring effect code.

use std::process::Command;

fn run(dir: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .map_err(|e| format!("git launch: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
pub fn git_current_branch(repo: String) -> Result<String, String> {
    Ok(run(&repo, &["rev-parse", "--abbrev-ref", "HEAD"])?.trim().to_string())
}

#[tauri::command]
pub fn git_branch(repo: String, name: String) -> Result<(), String> {
    run(&repo, &["checkout", "-B", &name])?;
    Ok(())
}

#[tauri::command]
pub fn git_commit_all(repo: String, message: String) -> Result<(), String> {
    run(&repo, &["add", "-A"])?;
    // --allow-empty so a no-op release doesn't error.
    run(&repo, &["commit", "--allow-empty", "-m", &message])?;
    Ok(())
}

#[tauri::command]
pub fn git_merge(repo: String, branch: String, into: String) -> Result<(), String> {
    run(&repo, &["checkout", &into])?;
    run(&repo, &["merge", "--no-ff", "-m", &format!("merge {branch}"), &branch])?;
    Ok(())
}
