/**
 * Install lifecycle for community apps.
 *
 * Today the only "installable" surface is The Square's primary CTA
 * (Install / Installing… / Open). The flow is intentionally mocked —
 * `startInstall(id)` walks progress 0 → 1 over ~2 seconds via
 * setTimeout, then lands on 'installed'. Persistence is localStorage.
 *
 * The real GitHub fetch is a separate, much larger workstream (Tauri
 * commands, code signing, dynamic module loading, sandbox). This
 * module's API is shaped so a real implementation can drop in by
 * replacing the walk inside startInstall() with an event-driven
 * Rust-side install — nothing else needs to change.
 *
 * Bundled apps (those whose AppManifest carries a `Root` component)
 * are always reported as 'installed'. The user cannot uninstall a
 * bundled app from the UI.
 */
import { useEffect, useState } from "react";
import { findApp } from "./apps";

export type InstallState =
  | "not-installed"
  | "installing"
  | "installed"
  | "failed";

export type InstallRecord = {
  state: InstallState;
  progress: number; // 0..1
  installedAt: string | null;
  error: string | null;
};

const DEFAULT_RECORD: InstallRecord = {
  state: "not-installed",
  progress: 0,
  installedAt: null,
  error: null,
};

const storageKey = (appId: string) => `platform.install.${appId}`;

const isBundled = (appId: string): boolean => {
  const app = findApp(appId);
  return !!app?.Root;
};

const loadFromStorage = (appId: string): InstallRecord => {
  try {
    const raw = localStorage.getItem(storageKey(appId));
    if (!raw) return DEFAULT_RECORD;
    const parsed = JSON.parse(raw) as Partial<InstallRecord>;
    return {
      state: (parsed.state as InstallState) ?? "not-installed",
      progress: typeof parsed.progress === "number" ? parsed.progress : 0,
      installedAt: parsed.installedAt ?? null,
      error: parsed.error ?? null,
    };
  } catch {
    return DEFAULT_RECORD;
  }
};

const saveToStorage = (appId: string, record: InstallRecord) => {
  try {
    localStorage.setItem(storageKey(appId), JSON.stringify(record));
  } catch {
    /* ignore */
  }
};

// In-memory store + subscribers so multiple components reflect the
// same record without round-tripping through localStorage on each
// progress tick.
const cache = new Map<string, InstallRecord>();
const subscribers = new Map<string, Set<(rec: InstallRecord) => void>>();
const timers = new Map<string, number>();

const notify = (appId: string, rec: InstallRecord) => {
  cache.set(appId, rec);
  saveToStorage(appId, rec);
  const subs = subscribers.get(appId);
  if (subs) for (const fn of subs) fn(rec);
};

export const getInstallState = (appId: string): InstallRecord => {
  if (isBundled(appId)) {
    return {
      state: "installed",
      progress: 1,
      installedAt: cache.get(appId)?.installedAt ?? new Date(0).toISOString(),
      error: null,
    };
  }
  const cached = cache.get(appId);
  if (cached) return cached;
  const loaded = loadFromStorage(appId);
  cache.set(appId, loaded);
  return loaded;
};

const subscribe = (
  appId: string,
  fn: (rec: InstallRecord) => void,
): (() => void) => {
  let set = subscribers.get(appId);
  if (!set) {
    set = new Set();
    subscribers.set(appId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
  };
};

export const useInstallState = (appId: string): InstallRecord => {
  const [rec, setRec] = useState<InstallRecord>(() => getInstallState(appId));
  useEffect(() => {
    setRec(getInstallState(appId));
    const unsub = subscribe(appId, setRec);
    return unsub;
  }, [appId]);
  return rec;
};

/** Idempotent: no-op if already installing or installed (or bundled). */
export const startInstall = (appId: string): void => {
  if (isBundled(appId)) return;
  const current = getInstallState(appId);
  if (current.state === "installing" || current.state === "installed") return;

  notify(appId, { state: "installing", progress: 0, installedAt: null, error: null });

  // Walk progress to 1.0 over ~2s in 40ms ticks (50 ticks).
  let progress = 0;
  const tick = () => {
    progress = Math.min(1, progress + 1 / 50);
    if (progress >= 1) {
      timers.delete(appId);
      notify(appId, {
        state: "installed",
        progress: 1,
        installedAt: new Date().toISOString(),
        error: null,
      });
      return;
    }
    notify(appId, {
      state: "installing",
      progress,
      installedAt: null,
      error: null,
    });
    const id = window.setTimeout(tick, 40);
    timers.set(appId, id);
  };
  const id = window.setTimeout(tick, 40);
  timers.set(appId, id);
};

export const cancelInstall = (appId: string): void => {
  const t = timers.get(appId);
  if (t !== undefined) {
    window.clearTimeout(t);
    timers.delete(appId);
  }
  const current = getInstallState(appId);
  if (current.state !== "installing") return;
  notify(appId, { ...DEFAULT_RECORD });
};

export const uninstall = (appId: string): void => {
  if (isBundled(appId)) return;
  cancelInstall(appId);
  notify(appId, { ...DEFAULT_RECORD });
};
