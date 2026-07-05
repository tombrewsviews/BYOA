# DreamStore DS-0 — Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the product KineticType → DreamStore, including Tauri identity and one-time non-destructive migration of the two user-level data paths, without renaming the "Kinetic Studio" app or the per-project `.kinetic-studio/` dirs.

**Architecture:** The rename is surgical. The *product* becomes DreamStore (Tauri `productName`/`identifier`/window title, docs). The **app** "Kinetic Studio" keeps its name — it is one app in the store. Two *user-level* paths move with a startup migration: `~/.kinetic-studio/` → `~/.dreamstore/` (5 Rust files) and `~/KineticStudio/` → `~/DreamStore Projects/` (project pool). Per-project `<project>/.kinetic-studio/` dirs are left as legacy (they hold real per-project state and are recreated/updated on open; renaming them across all existing projects is high-churn, low-value risk).

**Tech Stack:** Rust (Tauri 2, `dirs`, `std::fs`), TypeScript/React (Vite), vitest, cargo test.

## Global Constraints

- Product name: **DreamStore** (was KineticType). App name **Kinetic Studio** is unchanged.
- Bundle identifier: **`app.altramanera.dreamstore`**. Changing it makes the OS treat this as a fresh app (window state/permissions reset once) — accepted.
- User path `~/.kinetic-studio/` → `~/.dreamstore/`; project pool `~/KineticStudio/` → `~/DreamStore Projects/`.
- Per-project `<project>/.kinetic-studio/` dirs: **do NOT rename** (leave legacy).
- Migration is one-time and **non-destructive**: rename old→new only if new is absent and old exists; if new already exists, prefer it and leave old untouched.
- `dirs` and `tempfile` are already deps (`src-tauri/Cargo.toml:36,45`).

---

### Task 1: Central user-level path helper + migration (Rust)

Create one module that owns the `~/.dreamstore/` base dir and performs the one-time migrations, so the 5 scattered `home_dir().join(".kinetic-studio")` sites collapse to one source of truth and the migration runs before any of them is read.

**Files:**
- Create: `src-tauri/src/paths.rs`
- Modify: `src-tauri/src/lib.rs` (declare `mod paths;`, call migration in `run()` setup)
- Test: inline `#[cfg(test)]` in `src-tauri/src/paths.rs`

**Interfaces:**
- Produces:
  - `pub fn user_dir() -> PathBuf` — returns `~/.dreamstore` (falls back to `.dreamstore` relative if no home).
  - `pub fn user_path(rel: &str) -> PathBuf` — `user_dir().join(rel)`.
  - `pub fn projects_dir() -> PathBuf` — returns `~/DreamStore Projects`.
  - `pub fn migrate_user_paths()` — idempotent, non-destructive; renames the two legacy dirs if applicable. Logs (eprintln) on rename; never panics.

- [ ] **Step 1: Write the failing test**

Add to `src-tauri/src/paths.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // migrate_in(home) is the testable core: takes an explicit home dir.
    #[test]
    fn migrates_legacy_user_dir_when_new_absent() {
        let home = TempDir::new().unwrap();
        let old = home.path().join(".kinetic-studio");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("settings.json"), b"{}").unwrap();

        migrate_in(home.path());

        let new = home.path().join(".dreamstore");
        assert!(new.join("settings.json").exists(), "content moved to new dir");
        assert!(!old.exists(), "old dir renamed away");
    }

    #[test]
    fn does_not_clobber_existing_new_dir() {
        let home = TempDir::new().unwrap();
        let old = home.path().join(".kinetic-studio");
        let new = home.path().join(".dreamstore");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("a.json"), b"OLD").unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join("a.json"), b"NEW").unwrap();

        migrate_in(home.path());

        assert_eq!(fs::read_to_string(new.join("a.json")).unwrap(), "NEW", "new preferred");
        assert!(old.exists(), "old left untouched when new exists");
    }

    #[test]
    fn migrates_legacy_projects_pool() {
        let home = TempDir::new().unwrap();
        let old = home.path().join("KineticStudio");
        fs::create_dir_all(old.join("proj1")).unwrap();

        migrate_in(home.path());

        assert!(home.path().join("DreamStore Projects").join("proj1").exists());
        assert!(!old.exists());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test paths:: 2>&1 | tail -20`
Expected: FAIL — `migrate_in` / module not found (compile error).

- [ ] **Step 3: Write minimal implementation**

Put above the test module in `src-tauri/src/paths.rs`:

```rust
//! Central user-level paths for DreamStore + one-time non-destructive
//! migration from the legacy KineticType locations.
//!
//! Two user-level dirs move: `~/.kinetic-studio/` -> `~/.dreamstore/`
//! (settings, recents, window, skills bundle, recipients) and
//! `~/KineticStudio/` -> `~/DreamStore Projects/` (the project pool).
//! Per-project `<project>/.kinetic-studio/` dirs are intentionally left
//! as legacy and are NOT touched here.

use std::path::{Path, PathBuf};

pub fn user_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".dreamstore"))
        .unwrap_or_else(|| PathBuf::from(".dreamstore"))
}

pub fn user_path(rel: &str) -> PathBuf {
    user_dir().join(rel)
}

pub fn projects_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join("DreamStore Projects"))
        .unwrap_or_else(|| PathBuf::from("DreamStore Projects"))
}

/// Rename `old` -> `new` only if `new` is absent and `old` exists.
fn migrate_one(old: &Path, new: &Path) {
    if new.exists() || !old.exists() {
        return;
    }
    match std::fs::rename(old, new) {
        Ok(()) => eprintln!("dreamstore: migrated {} -> {}", old.display(), new.display()),
        Err(e) => eprintln!("dreamstore: migrate {} failed: {}", old.display(), e),
    }
}

/// Testable core: migrate both legacy dirs under an explicit home.
fn migrate_in(home: &Path) {
    migrate_one(&home.join(".kinetic-studio"), &home.join(".dreamstore"));
    migrate_one(&home.join("KineticStudio"), &home.join("DreamStore Projects"));
}

/// Run the one-time migrations against the real home dir. Idempotent.
pub fn migrate_user_paths() {
    if let Some(home) = dirs::home_dir() {
        migrate_in(&home);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test paths:: 2>&1 | tail -20`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire module + call migration at startup**

In `src-tauri/src/lib.rs`, add the module declaration next to the others (after `mod music;` / alphabetical is fine — place after `mod pulse;`):

```rust
mod paths;
```

In `run()`, inside the `.setup(|app| { ... })` closure, as the FIRST line of the closure body (before window handling), add:

```rust
            paths::migrate_user_paths();
```

- [ ] **Step 6: Verify it compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: `Finished`.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/paths.rs src-tauri/src/lib.rs
git commit -m "feat(dreamstore): central user-path helper + startup migration"
```

---

### Task 2: Point the 5 user-level Rust sites at the new helper

Replace each `home_dir().join(".kinetic-studio").join(...)` with `paths::user_path(...)`. This is the actual path move; migration (Task 1) already ran at startup so existing data is at the new location.

**Files:**
- Modify: `src-tauri/src/settings.rs:44-45`
- Modify: `src-tauri/src/projects.rs:43-44`
- Modify: `src-tauri/src/window_state.rs:29-30,92-93`
- Modify: `src-tauri/src/skill.rs:47-48`
- Modify: `src-tauri/src/canvases-private/remit_commands.rs:17-19`

**Interfaces:**
- Consumes: `crate::paths::user_path` (Task 1).

- [ ] **Step 1: settings.rs** — replace the body of the settings-path fn:

```rust
    crate::paths::user_path("settings.json")
```
(removing the two-line `dirs::home_dir().map(...).unwrap_or_else(...)`).

- [ ] **Step 2: projects.rs** — replace the recents-path body:

```rust
    crate::paths::user_path("recents.json")
```

- [ ] **Step 3: window_state.rs** — the two path fns:

```rust
    crate::paths::user_path("window.json")
```
and

```rust
    crate::paths::user_path("view-mode.json")
```

- [ ] **Step 4: skill.rs** — the skills-bundle path fn (lines 47-48):

```rust
    crate::paths::user_path("skills-bundle/kinetic")
```

- [ ] **Step 5: remit_commands.rs** — `recipients_path()` (lines 16-20 body):

```rust
    crate::paths::user_path("remit-recipients.json")
```

- [ ] **Step 6: Verify compile + existing tests**

Run: `cd src-tauri && cargo check 2>&1 | tail -5 && cargo test 2>&1 | tail -8`
Expected: `Finished`; existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/settings.rs src-tauri/src/projects.rs src-tauri/src/window_state.rs src-tauri/src/skill.rs src-tauri/src/canvases-private/remit_commands.rs
git commit -m "refactor(dreamstore): route user-level paths through paths::user_path"
```

---

### Task 3: Project pool dir → `~/DreamStore Projects/`

`~/KineticStudio/` is the folder that holds the user's projects. Point its resolution at `paths::projects_dir()` and update the one user-facing string.

**Files:**
- Modify: `src-tauri/src/projects.rs` (the projects-root resolver — search for `KineticStudio`)
- Modify: `src-tauri/src/canvas.rs` (the `KineticStudio` reference)
- Modify: `editor/canvases/kinetic/ProjectsView.tsx:2` (comment) — copy string only

**Interfaces:**
- Consumes: `crate::paths::projects_dir` (Task 1).

- [ ] **Step 1: Find the exact sites**

Run: `grep -rn "KineticStudio" src-tauri/src editor --include="*.rs" --include="*.tsx"`
Note each `home_dir()...join("KineticStudio")` occurrence.

- [ ] **Step 2: Replace each Rust resolver** with `crate::paths::projects_dir()` (drop the local `home_dir().map(...).join("KineticStudio")`). If a site joins subpaths, use `crate::paths::projects_dir().join(...)`.

- [ ] **Step 3: Update ProjectsView.tsx comment** — change `~/KineticStudio` to `~/DreamStore Projects` in the header comment (line ~2). No logic change.

- [ ] **Step 4: Verify**

Run: `cd src-tauri && cargo check 2>&1 | tail -5` then from repo root `npx tsc --noEmit -p tsconfig.json`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/projects.rs src-tauri/src/canvas.rs editor/canvases/kinetic/ProjectsView.tsx
git commit -m "feat(dreamstore): project pool -> ~/DreamStore Projects with migration"
```

---

### Task 4: Tauri identity + window title (product rename)

**Files:**
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:** none (config only).

- [ ] **Step 1: Read current values**

Run: `grep -nE "productName|identifier|\"title\"" src-tauri/tauri.conf.json`
Record the existing `identifier` and `productName`.

- [ ] **Step 2: Edit the three fields**

Set `productName` to `"DreamStore"`. Set the top-level `identifier` to `"app.altramanera.dreamstore"`. Set the main window's `title` (under `app.windows[0].title`) to `"DreamStore"`. Leave the window `label` as `"main"`.

- [ ] **Step 3: Verify JSON is valid + builds**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: `Finished` (Tauri validates the config at build).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat(dreamstore): Tauri product name, bundle id, window title"
```

---

### Task 5: User-facing product strings in docs + package

Only strings that name the **product** change. The **app** "Kinetic Studio" stays.

**Files:**
- Modify: `CLAUDE.md` (title line "# KineticType" → "# DreamStore"; keep the gotchas)
- Modify: `package.json` (`name` field if it is `kinetictype`/similar — check first)
- Modify: `README*` if present at repo root

- [ ] **Step 1: Inventory product-name strings (exclude the app name)**

Run: `grep -rn "KineticType" CLAUDE.md package.json README.md 2>/dev/null`
Do NOT touch "Kinetic Studio" / "kinetic" app references.

- [ ] **Step 2: Replace "KineticType" → "DreamStore"** in those files only. In `package.json`, only change `name` if it encodes the product (e.g. `"kinetictype"` → `"dreamstore"`); leave scripts and deps.

- [ ] **Step 3: Verify build unaffected**

Run: `npx tsc --noEmit -p tsconfig.json && npm test 2>&1 | grep -E "Test Files|Tests "`
Expected: clean; tests pass.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md package.json README.md 2>/dev/null
git commit -m "docs(dreamstore): product name in docs + package"
```

---

### Task 6: Full verification (both build states + run)

**Files:** none (verification only).

- [ ] **Step 1: Frontend typecheck + tests**

Run: `npx tsc --noEmit -p tsconfig.json && npm test 2>&1 | grep -E "Test Files|Tests "`
Expected: 39 test files / 194 tests pass (overlay present).

- [ ] **Step 2: Rust check + tests**

Run: `cd src-tauri && cargo check 2>&1 | tail -3 && cargo test 2>&1 | tail -6`
Expected: `Finished`; tests pass incl. the 3 new `paths::` tests.

- [ ] **Step 3: No-overlay state still builds** (regression from Phase 1)

Run:
```bash
STASH=$(mktemp -d)
mv editor/apps-private "$STASH/" && mv src-tauri/src/canvases-private "$STASH/" && mv src-tauri/skills-private "$STASH/" && mv src-tauri/templates-private "$STASH/"
npx tsc --noEmit -p tsconfig.json && (cd src-tauri && cargo check 2>&1 | tail -2)
mv "$STASH/apps-private" editor/ && mv "$STASH/canvases-private" src-tauri/src/ && mv "$STASH/skills-private" src-tauri/ && mv "$STASH/templates-private" src-tauri/ && rmdir "$STASH"
```
Expected: both clean; overlay restored.

- [ ] **Step 4: Manual run (migration + title)**

Use the `/run` skill (or `npm run tauri:dev`). Confirm: window title reads "DreamStore"; app launches; existing settings/recents survive (migration moved `~/.kinetic-studio` → `~/.dreamstore`). Open Kinetic Studio → its projects list loads from `~/DreamStore Projects` (migrated from `~/KineticStudio`).

- [ ] **Step 5: Commit any doc note if needed**

If the CLAUDE.md "moving the project breaks Rust cache" note needs the new path, update it. Otherwise no commit.

---

## Self-Review

- **Spec coverage:** DS-0 section of the spec — Tauri identity (Task 4), user path `~/.kinetic-studio`→`~/.dreamstore` (Tasks 1-2), project pool `~/KineticStudio`→`~/DreamStore Projects` (Task 3), non-destructive migration (Task 1), per-project dirs left legacy (stated in Global Constraints; no task touches them — correct), docs (Task 5). Covered.
- **Placeholders:** none — all code shown; the two "grep to find exact sites" steps (Tasks 3, 5) are discovery for files whose exact line numbers shift, with the replacement code given.
- **Type consistency:** `user_dir` / `user_path` / `projects_dir` / `migrate_user_paths` / `migrate_in` used consistently across Tasks 1-3.
