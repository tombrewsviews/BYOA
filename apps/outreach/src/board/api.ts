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
export const setActorName = (name: string) => call<void>("set_actor_name", { name });
export const openResearchFolder = () => call<void>("research_folder_open");
export const attachFile = (leadId: string, srcPath: string) =>
  call<string>("attach_file", { leadId, srcPath });
export const revealFile = (path: string) => call<void>("reveal_file", { path });

/**
 * Re-fetch stages+leads every `intervalMs` and hand them to `onChange`.
 * Returns a stop fn. Fetches once immediately, then on the interval.
 */
export function poll(
  onChange: (data: { stages: Stage[]; leads: Lead[] }) => void,
  intervalMs = 1500,
): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const [stages, leads] = await Promise.all([listStages(), listLeads()]);
      if (!stopped) onChange({ stages, leads });
    } catch {
      /* transient (e.g. no active project yet) — try again next tick */
    }
  };
  void tick();
  const h = setInterval(tick, intervalMs);
  return () => {
    stopped = true;
    clearInterval(h);
  };
}
