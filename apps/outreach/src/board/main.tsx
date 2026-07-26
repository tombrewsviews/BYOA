import React from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { Kanban } from "./Kanban";
import { poll, moveLead, addLead, addStage, listStages, setLeadArchived, deleteLead } from "./api";
import type { Stage, Lead } from "./types";

function BoardApp() {
  const [stages, setStages] = React.useState<Stage[]>([]);
  const [leads, setLeads] = React.useState<Lead[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);

  React.useEffect(() => poll((d) => { setStages(d.stages); setLeads(d.leads); }), []);

  // Selecting a card in this (board) window tells the main window to open the
  // Inspector on that lead — Tauri `emit` broadcasts to every window.
  const onSelect = React.useCallback((id: string) => {
    setSelectedId(id);
    void (async () => {
      const { emit } = await import("@tauri-apps/api/event");
      await emit("board://select-lead", id).catch(() => {});
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

  return (
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
  );
}

createRoot(document.getElementById("board-root")!).render(
  <React.StrictMode><BoardApp /></React.StrictMode>,
);
