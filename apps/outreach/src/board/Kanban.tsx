import { cn } from "@/lib/utils";
import type { Stage, Lead } from "./types";

interface KanbanProps {
  stages: Stage[];
  leads: Lead[];
  onMove: (leadId: string, toStage: string, version: number) => void;
}

const UNSORTED_ID = "__unsorted__";

export function Kanban({ stages, leads, onMove }: KanbanProps) {
  const columns = stages
    .filter((s) => s.retiredAt === null)
    .sort((a, b) => a.position - b.position);
  const columnIds = new Set(columns.map((s) => s.id));
  const orphanLeads = leads.filter((l) => !columnIds.has(l.stage));

  const leadsFor = (stageId: string) => leads.filter((l) => l.stage === stageId);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, columnStageId: string) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData("text/plain");
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage === columnStageId) return;
    onMove(leadId, columnStageId, lead.version);
  };

  return (
    <div className="flex h-full gap-3 overflow-x-auto bg-background p-3">
      {columns.map((stage) => (
        <div
          key={stage.id}
          className="flex w-64 shrink-0 flex-col rounded-lg border border-border bg-card text-card-foreground"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handleDrop(e, stage.id)}
        >
          <div className="rounded-t-lg bg-muted px-3 py-2 text-sm font-medium text-muted-foreground">
            {stage.label}
          </div>
          <div className="flex flex-col gap-2 p-2">
            {leadsFor(stage.id).map((lead) => (
              <LeadCard key={lead.id} lead={lead} />
            ))}
          </div>
        </div>
      ))}

      {orphanLeads.length > 0 && (
        <div
          key={UNSORTED_ID}
          className="flex w-64 shrink-0 flex-col rounded-lg border border-border bg-card text-card-foreground"
        >
          <div className="rounded-t-lg bg-muted px-3 py-2 text-sm font-medium text-muted-foreground">
            Unsorted
          </div>
          <div className="flex flex-col gap-2 p-2">
            {orphanLeads.map((lead) => (
              <LeadCard key={lead.id} lead={lead} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LeadCard({ lead }: { lead: Lead }) {
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", lead.id)}
      className={cn(
        "rounded-md border border-border bg-card p-2 text-sm text-card-foreground",
        "cursor-grab active:cursor-grabbing",
      )}
    >
      <div>{lead.name}</div>
      {lead.org && <div className="text-xs text-muted-foreground">{lead.org}</div>}
    </div>
  );
}
