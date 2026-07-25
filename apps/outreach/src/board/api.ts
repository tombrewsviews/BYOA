import type { Stage, Lead } from "./types";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const listStages = () => call<Stage[]>("board_list_stages");
export const listLeads = () => call<Lead[]>("board_list_leads");
export const moveLead = (id: string, toStage: string, expectedVersion: number) =>
  call<number>("board_move_lead", { id, toStage, expectedVersion });

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
