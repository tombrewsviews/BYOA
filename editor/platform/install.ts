/**
 * Install lifecycle for community apps.
 *
 * The install action is backed by the Tauri installer commands
 * (`app_install`, `app_uninstall`, `app_install_states`). `startInstall(id)`
 * resolves the app's manifest + install assets and hands them to Rust, which
 * materializes ~/Applications/DreamStore/<App>/. State lives in-memory in
 * `cache`; `refreshInstallStates()` seeds it from the backend at app boot.
 *
 * Apps are not-installed by default. There is no force-install for bundled
 * apps — every app installs and uninstalls through the same flow.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../runtime";
import { findApp } from "./apps";
import { installAssetsFor } from "./install-assets";

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

// In-memory store + subscribers so multiple components reflect the same
// record. `refreshInstallStates()` (backed by the registry) is the truth.
const cache = new Map<string, InstallRecord>();
const subscribers = new Map<string, Set<(rec: InstallRecord) => void>>();

const notify = (appId: string, rec: InstallRecord) => {
  cache.set(appId, rec);
  const subs = subscribers.get(appId);
  if (subs) for (const fn of subs) fn(rec);
};

export const getInstallState = (appId: string): InstallRecord =>
  cache.get(appId) ?? DEFAULT_RECORD;

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

/** Idempotent: no-op if already installing or installed. */
export const startInstall = async (appId: string): Promise<void> => {
  const app = findApp(appId);
  if (!app) return;
  const cur = getInstallState(appId);
  if (cur.state === "installing" || cur.state === "installed") return;
  notify(appId, { state: "installing", progress: 0, installedAt: null, error: null });
  try {
    if (!isTauri()) throw new Error("install requires the desktop app");
    const assets = await installAssetsFor(appId);
    // Serialize the manifest without the Root component (not JSON-able).
    const { Root, ...data } = app;
    await invoke("app_install", {
      appId,
      appName: app.name,
      manifestJson: JSON.stringify(data),
      assets,
    });
    notify(appId, {
      state: "installed",
      progress: 1,
      installedAt: new Date().toISOString(),
      error: null,
    });
  } catch (e) {
    notify(appId, { state: "failed", progress: 0, installedAt: null, error: String(e) });
  }
};

export const cancelInstall = (appId: string): void => {
  const current = getInstallState(appId);
  if (current.state !== "installing") return;
  notify(appId, { ...DEFAULT_RECORD });
};

export const uninstall = async (appId: string): Promise<void> => {
  const app = findApp(appId);
  if (!app) return;
  try {
    if (isTauri()) await invoke("app_uninstall", { appId, appName: app.name });
  } finally {
    notify(appId, { ...DEFAULT_RECORD });
  }
};

export async function refreshInstallStates(): Promise<void> {
  if (!isTauri()) return;
  try {
    const ids = await invoke<string[]>("app_install_states");
    const set = new Set(ids);
    for (const a of (await import("./apps")).APPS) {
      notify(
        a.id,
        set.has(a.id)
          ? {
              state: "installed",
              progress: 1,
              installedAt: cache.get(a.id)?.installedAt ?? new Date().toISOString(),
              error: null,
            }
          : { ...DEFAULT_RECORD },
      );
    }
  } catch {
    /* leave defaults */
  }
}
