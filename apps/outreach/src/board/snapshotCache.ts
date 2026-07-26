import type { Snapshot } from "./api";

/**
 * A local, on-disk cache of the last good board snapshot (a read replica).
 *
 * On a shared (remote Postgres) board the first snapshot read costs a connect +
 * remote round-trips. Persisting the last snapshot to localStorage (which the
 * Tauri webview keeps on disk across restarts) lets a window paint the
 * last-known board INSTANTLY on open, before the first remote read returns. The
 * normal poll then refreshes it — and, being async on the Rust side now, that
 * refresh never blocks the UI thread. Remote stays the source of truth; this is
 * purely a read cache, so there is no conflict/merge logic and no data-loss risk.
 *
 * Keyed per project path so switching boards doesn't show the wrong cache.
 */

const KEY_PREFIX = "outreach.snapshot.v1.";

/** localStorage key for a project's cached snapshot. A stable, per-project key
 *  so two boards don't overwrite each other's cache. */
function keyFor(projectPath: string): string {
  return `${KEY_PREFIX}${projectPath}`;
}

/** Read the last cached snapshot for `projectPath`, or null if none/unusable.
 *  Never throws — a missing/corrupt/oversized entry just yields null. */
export function loadSnapshot(projectPath: string): Snapshot | null {
  try {
    const raw = localStorage.getItem(keyFor(projectPath));
    if (!raw) return null;
    const snap = JSON.parse(raw) as Snapshot;
    // Minimal shape check — a schema change (new fields) shouldn't crash hydrate.
    if (!snap || !Array.isArray(snap.stages) || !Array.isArray(snap.leads)) return null;
    return snap;
  } catch {
    return null;
  }
}

/** Persist `snap` as the cached snapshot for `projectPath`. Best-effort — a
 *  quota error or unavailable storage is swallowed (the cache is an optimization,
 *  never required for correctness). */
export function saveSnapshot(projectPath: string, snap: Snapshot): void {
  try {
    localStorage.setItem(keyFor(projectPath), JSON.stringify(snap));
  } catch {
    /* storage full / unavailable — the live poll still works without the cache */
  }
}
