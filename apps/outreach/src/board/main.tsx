import React from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { Kanban } from "./Kanban";
import {
  poll,
  moveLead,
  addLead,
  addStage,
  listStages,
  setLeadArchived,
  deleteLead,
  ensureConnected,
} from "./api";
import type { PollStatus } from "./api";
import type { Stage, Lead } from "./types";

function BoardApp() {
  const [stages, setStages] = React.useState<Stage[]>([]);
  const [leads, setLeads] = React.useState<Lead[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  const [status, setStatus] = React.useState<PollStatus>("loading");

  React.useEffect(
    () => poll((d) => { setStages(d.stages); setLeads(d.leads); }, 1500, setStatus),
    [],
  );

  // Warm the (shared) board connection off the UI thread so the poll's board
  // commands don't have to connect synchronously — that remote connect is what
  // froze the whole app on open. Kick it off on mount, and re-try while we're
  // still not connected (a failed/slow warm-up, or the URL changing after open).
  React.useEffect(() => {
    if (status === "ok") return;
    void ensureConnected().catch(() => {/* poll keeps showing "Connecting…" */});
  }, [status]);

  // Selecting a card in this (board) window tells the main window to open the
  // Inspector on that lead. Routed through the backend (`board_select_lead`),
  // which emits to the main window explicitly — a webview-side `emit` does not
  // reliably cross windows.
  const onSelect = React.useCallback((id: string) => {
    setSelectedId(id);
    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("board_select_lead", { id }).catch(() => {});
    })();
  }, []);

  const onMove = React.useCallback((id: string, to: string, version: number) => {
    void moveLead(id, to, version).catch(() => {/* conflict → next poll reconciles */});
  }, []);

  const onAddLead = React.useCallback((name: string, org: string | null, stage: string) => {
    void addLead(name, org, stage).catch(() => {});
  }, []);

  const onAddColumn = React.useCallback((label: string) => {
    void (async () => {
      const current = await listStages().catch(() => [] as Stage[]);
      const maxPos = current.reduce((m, s) => Math.max(m, s.position), -1);
      await addStage(label, maxPos + 1).catch(() => {});
    })();
  }, []);

  const onArchive = React.useCallback((id: string, archived: boolean) => {
    void setLeadArchived(id, archived).catch(() => {});
  }, []);

  const onDelete = React.useCallback((id: string, name: string) => {
    // Native confirm — one guard against an accidental permanent delete.
    if (!window.confirm(`Delete "${name}"? This removes the card from the board.`)) return;
    void deleteLead(id).catch(() => {});
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  // Before the board's first load succeeds, show progress instead of a blank
  // freeze — a shared (Postgres) board's first connect can take several seconds.
  const firstLoad = stages.length === 0;
  return (
    <>
      {firstLoad && status !== "ok" ? (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center p-2">
          <div className="rounded-md border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
            {status === "error"
              ? "Can't reach the board — retrying…"
              : "Connecting to the board…"}
          </div>
        </div>
      ) : null}
      <Kanban
        stages={stages}
        leads={leads}
        onMove={onMove}
        onSelect={onSelect}
        onAddLead={onAddLead}
        onAddColumn={onAddColumn}
        onArchive={onArchive}
        onDelete={onDelete}
        selectedId={selectedId}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived((v) => !v)}
      />
    </>
  );
}

createRoot(document.getElementById("board-root")!).render(
  <React.StrictMode><BoardApp /></React.StrictMode>,
);
