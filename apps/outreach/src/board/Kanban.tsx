import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Stage, Lead } from "./types";

interface KanbanProps {
  stages: Stage[];
  leads: Lead[];
  onMove: (leadId: string, toStage: string, version: number) => void;
  onSelect: (leadId: string) => void;
  onAddLead: (name: string, org: string | null, stage: string) => void;
  onAddColumn: (label: string) => void;
  selectedId: string | null;
}

const UNSORTED_ID = "__unsorted__";

export function Kanban({
  stages,
  leads,
  onMove,
  onSelect,
  onAddLead,
  onAddColumn,
  selectedId,
}: KanbanProps) {
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
    // The board window's root: fills the viewport, scrolls horizontally when the
    // columns overflow. Columns are full-height flex children so each column's
    // own list scrolls independently rather than the whole page growing.
    <div className="flex h-screen items-start gap-3 overflow-x-auto bg-background p-3">
      {columns.map((stage) => (
        <Column
          key={stage.id}
          label={stage.label}
          leads={leadsFor(stage.id)}
          selectedId={selectedId}
          onSelect={onSelect}
          onDrop={(e) => handleDrop(e, stage.id)}
          onAddLead={(name, org) => onAddLead(name, org, stage.id)}
        />
      ))}

      {orphanLeads.length > 0 && (
        <Column
          key={UNSORTED_ID}
          label="Unsorted"
          leads={orphanLeads}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      )}

      <AddColumn onAdd={onAddColumn} />
    </div>
  );
}

function Column({
  label,
  leads,
  selectedId,
  onSelect,
  onDrop,
  onAddLead,
}: {
  label: string;
  leads: Lead[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  onAddLead?: (name: string, org: string | null) => void;
}) {
  return (
    <div
      className="flex h-full w-72 shrink-0 flex-col rounded-lg border border-border bg-card text-card-foreground"
      onDragOver={onDrop ? (e) => e.preventDefault() : undefined}
      onDrop={onDrop}
    >
      <div className="flex flex-none items-center justify-between rounded-t-lg bg-muted px-3 py-2">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{leads.length}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {leads.map((lead) => (
          <LeadCard
            key={lead.id}
            lead={lead}
            selected={lead.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
      {onAddLead ? <AddLead onAdd={onAddLead} /> : null}
    </div>
  );
}

function LeadCard({
  lead,
  selected,
  onSelect,
}: {
  lead: Lead;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", lead.id)}
      onClick={() => onSelect(lead.id)}
      className={cn(
        "rounded-md border p-2 text-sm text-card-foreground",
        "cursor-pointer active:cursor-grabbing hover:border-ring",
        selected ? "border-ring bg-accent" : "border-border bg-card",
      )}
    >
      <div className="font-medium">{lead.name}</div>
      {lead.org && <div className="text-xs text-muted-foreground">{lead.org}</div>}
    </div>
  );
}

/** Inline "add a card" form at the bottom of a column. */
function AddLead({ onAdd }: { onAdd: (name: string, org: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    onAdd(n, org.trim() || null);
    setName("");
    setOrg("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        className="flex-none px-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        + Add card
      </button>
    );
  }

  return (
    <div className="flex flex-none flex-col gap-1 p-2">
      <input
        autoFocus
        className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <input
        className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
        placeholder="Company (optional)"
        value={org}
        onChange={(e) => setOrg(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <div className="flex gap-1">
        <button
          className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground"
          onClick={submit}
        >
          Add
        </button>
        <button
          className="rounded-md px-2 py-1 text-xs text-muted-foreground"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The trailing "add a column" affordance. */
function AddColumn({ onAdd }: { onAdd: (label: string) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");

  const submit = () => {
    const l = label.trim();
    if (!l) return;
    onAdd(l);
    setLabel("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        className="h-full w-56 shrink-0 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        + Add column
      </button>
    );
  }

  return (
    <div className="flex w-56 shrink-0 flex-col gap-1 rounded-lg border border-border bg-card p-2">
      <input
        autoFocus
        className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
        placeholder="Column name"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <div className="flex gap-1">
        <button
          className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground"
          onClick={submit}
        >
          Add
        </button>
        <button
          className="rounded-md px-2 py-1 text-xs text-muted-foreground"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
