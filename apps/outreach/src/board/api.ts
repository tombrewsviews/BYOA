import type { Stage, Lead } from "./types";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export interface LeadDetail {
  id: string; stage: string; name: string; org: string | null;
  context: { facts?: unknown[] };
  messages: unknown[];
  transcripts: { raw: string; summary: string }[];
  archivedAt: string | null;
  createdAt: string; updatedAt: string; version: number;
}
export interface BoardConfig { name: string; createdBy: string; version: number }
export interface AppSettings { databaseUrl?: string; actorName?: string }

export const listStages = () => call<Stage[]>("board_list_stages");
export const listLeads = () => call<Lead[]>("board_list_leads");
export const moveLead = (id: string, toStage: string, expectedVersion: number) =>
  call<number>("board_move_lead", { id, toStage, expectedVersion });
export const setLeadArchived = (id: string, archived: boolean) =>
  call<number>("board_set_lead_archived", { id, archived });
export const deleteLead = (id: string) => call<number>("board_delete_lead", { id });
export const getLead = (id: string) => call<LeadDetail>("board_get_lead", { id });
export const getConfig = () => call<BoardConfig>("board_get_config");
export const renameStage = (id: string, label: string) =>
  call<number>("board_rename_stage", { id, label });
export const addLead = (name: string, org: string | null, stage: string) =>
  call<string>("board_add_lead", { name, org, stage });
export const addStage = (label: string, position: number) =>
  call<string>("board_add_stage", { label, position });
export const reorderStages = (ids: string[]) => call<void>("board_reorder_stages", { ids });
export const retireStage = (id: string) => call<number>("board_retire_stage", { id });
export const appendContext = (id: string, research: unknown, expectedVersion: number) =>
  call<number>("board_append_context", { id, research, expectedVersion });
export const getSettings = () => call<AppSettings>("get_settings");
export const setDatabaseUrl = (url: string) => call<void>("set_database_url", { url });

/** A step in the shared-board sync, emitted on the `board://sync-progress`
 *  event so the UI can show a live progress bar instead of a frozen app. */
export interface SyncProgress {
  phase: "connecting" | "checking" | "copying" | "done" | "error";
  done: number;
  total: number;
  message: string;
}

/**
 * Save a shared-board URL. Runs entirely off the UI thread on the Rust side
 * (the connect+copy used to freeze the whole app), emitting `board://sync-progress`
 * as it goes. Auto-copies local leads up when the shared board is empty.
 * Resolves with the number of leads copied.
 */
export const saveSharedUrl = (url: string) => call<number>("board_save_shared_url", { url });

/**
 * Warm the active board's connection off the UI thread. For a shared (Postgres)
 * board this does the slow remote connect in the background and fills the
 * backend cache, so the synchronous board commands (list/get/...) never connect
 * on the UI thread and never freeze the app. No-op for a local board. Resolves
 * once connected (or rejects if the connect failed). Safe to call repeatedly.
 */
export const ensureConnected = () => call<void>("board_ensure_connected");

/** Live board connection state, reported WITHOUT connecting (never blocks). */
export interface ConnectionStatus {
  mode: "local" | "shared";
  connected: boolean;
}
export const connectionStatus = () => call<ConnectionStatus>("board_connection_status");

/** One round-trip board read (stages + leads + config + notifications + mode).
 *  Collapses a poll tick to a single command so a remote board isn't hit 2–3×
 *  per tick, and the notification bell rides on the SAME read instead of its own
 *  separate poll. Runs off the UI thread on the Rust side (async command). */
export interface Snapshot {
  stages: Stage[];
  leads: Lead[];
  config: BoardConfig;
  notifications: Notifications;
  mode: "local" | "shared";
}
export const snapshot = () => call<Snapshot>("board_snapshot");
export const setActorName = (name: string) => call<void>("set_actor_name", { name });
export const openResearchFolder = () => call<void>("research_folder_open");

/** A user who has opened this board — a candidate to @-mention. */
export interface Actor {
  id: string;
  label: string;
}
/** Everyone who has opened the board except me (the @-mention roster). */
export const listActors = () => call<Actor[]>("board_list_actors");

/** One notification addressed to the signed-in user. */
export interface Notification {
  seq: number;
  kind: "mention" | "stage" | "note" | "lead_added";
  leadId: string | null;
  actor: string;
  body: string;
  createdAt: string;
  read: boolean;
}
export interface Notifications {
  items: Notification[];
  unread: number;
}
/** The signed-in user's notifications (newest first) + unread count. */
export const notifications = () => call<Notifications>("board_notifications");
/** Mark all my notifications read (clears the bell's red dot). */
export const markNotificationsRead = () => call<number>("board_mark_notifications_read");
export const attachFile = (leadId: string, srcPath: string) =>
  call<string>("attach_file", { leadId, srcPath });
export const revealFile = (path: string) => call<void>("reveal_file", { path });

/** Board connection status, surfaced so the UI can show progress instead of a
 *  silent freeze while a slow shared-DB (Postgres) connect is in flight. */
export type PollStatus = "loading" | "ok" | "error";

/**
 * Re-fetch the board (one `board_snapshot` round-trip) and hand it to
 * `onChange`. The poll interval ADAPTS to the board mode reported by the
 * snapshot: `localIntervalMs` for a local SQLite board (cheap, poll often) and
 * the slower `sharedIntervalMs` for a remote Postgres board (each call is a
 * transatlantic round-trip, so polling it twice a second is what made the app
 * laggy — poll it rarely instead; your own writes apply immediately and the
 * next poll reconciles).
 *
 * `onStatus` (optional) reports "loading" until the first success, then "ok";
 * "error" only for a real failure (a `connecting:` error stays "loading" while
 * the shared board warms up). Returns a stop fn. Fetches once immediately.
 */
export function poll(
  onChange: (data: {
    stages: Stage[];
    leads: Lead[];
    config: BoardConfig;
    notifications: Notifications;
  }) => void,
  localIntervalMs = 1500,
  onStatus?: (s: PollStatus) => void,
  sharedIntervalMs = 5000,
): () => void {
  let stopped = false;
  let everOk = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = async () => {
    if (stopped) return;
    // Only signal "loading" before the first success, so a slow initial connect
    // shows progress but steady-state polling doesn't flicker a banner.
    if (!everOk) onStatus?.("loading");
    let nextMs = localIntervalMs;
    try {
      const snap = await snapshot();
      if (!stopped) {
        everOk = true;
        onStatus?.("ok");
        onChange({
          stages: snap.stages,
          leads: snap.leads,
          config: snap.config,
          notifications: snap.notifications,
        });
        nextMs = snap.mode === "shared" ? sharedIntervalMs : localIntervalMs;
      }
    } catch (e) {
      // A `connecting:` error means the shared board is still warming up in the
      // background — that's "loading", not a real failure. Anything else before
      // the first success is an error worth surfacing.
      const connecting = String((e as Error)?.message ?? e).includes("connecting:");
      if (!stopped && !everOk) onStatus?.(connecting ? "loading" : "error");
      /* transient (e.g. no active project yet, or slow connect) — retry next tick */
    } finally {
      if (!stopped) timer = setTimeout(tick, nextMs);
    }
  };
  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
