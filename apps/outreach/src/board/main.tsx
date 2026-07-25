import React from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { Kanban } from "./Kanban";
import { poll, moveLead } from "./api";
import type { Stage, Lead } from "./types";

function BoardApp() {
  const [stages, setStages] = React.useState<Stage[]>([]);
  const [leads, setLeads] = React.useState<Lead[]>([]);
  React.useEffect(() => poll((d) => { setStages(d.stages); setLeads(d.leads); }), []);
  const onMove = React.useCallback((id: string, to: string, version: number) => {
    void moveLead(id, to, version).catch(() => {/* conflict → next poll reconciles */});
  }, []);
  return <Kanban stages={stages} leads={leads} onMove={onMove} />;
}

createRoot(document.getElementById("board-root")!).render(
  <React.StrictMode><BoardApp /></React.StrictMode>,
);
