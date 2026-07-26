import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import { Archive, ArchiveRestore, MoreHorizontal, Trash2 } from "../icons";
import { NotificationBell } from "./NotificationBell";
import type { Stage, Lead } from "./types";

interface KanbanProps {
  stages: Stage[];
  leads: Lead[];
  onMove: (leadId: string, toStage: string, version: number) => void;
  onSelect: (leadId: string) => void;
  onAddLead: (name: string, org: string | null, stage: string) => void;
  onAddColumn: (label: string) => void;
  onArchive: (leadId: string, archived: boolean) => void;
  onDelete: (leadId: string, name: string) => void;
  selectedId: string | null;
  showArchived: boolean;
  onToggleArchived: () => void;
}

const UNSORTED_ID = "__unsorted__";

export function Kanban({
  stages,
  leads,
  onMove,
  onSelect,
  onAddLead,
  onAddColumn,
  onArchive,
  onDelete,
  selectedId,
  showArchived,
  onToggleArchived,
}: KanbanProps) {
  const columns = stages
    .filter((s) => s.retiredAt === null)
    .sort((a, b) => a.position - b.position);
  const columnIds = new Set(columns.map((s) => s.id));

  // Archived cards are hidden unless the toggle is on; when shown they render
  // dimmed with a Restore action, in place in their own column.
  const visible = showArchived ? leads : leads.filter((l) => l.archivedAt === null);
  const archivedCount = leads.filter((l) => l.archivedAt !== null).length;
  const orphanLeads = visible.filter((l) => !columnIds.has(l.stage));

  const leadsFor = (stageId: string) => visible.filter((l) => l.stage === stageId);

  const cardProps = { selectedId, onSelect, onArchive, onDelete };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, columnStageId: string) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData("text/plain");
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage === columnStageId) return;
    onMove(leadId, columnStageId, lead.version);
  };

  return (
    // The board window's root: a header bar plus the columns row that fills the
    // rest of the viewport and scrolls horizontally when the columns overflow.
    <div className="flex h-screen flex-col bg-background">
      <div className="flex flex-none items-center justify-end gap-2 border-b border-border px-3 py-1.5">
        <button
          className={cn(
            "rounded-md px-2 py-1 text-xs",
            showArchived
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={onToggleArchived}
          title="Show or hide archived cards"
        >
          {showArchived ? "Hide archived" : `Show archived${archivedCount ? ` (${archivedCount})` : ""}`}
        </button>
        <NotificationBell />
      </div>
      <div className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto p-3">
        {columns.map((stage) => (
          <Column
            key={stage.id}
            label={stage.label}
            leads={leadsFor(stage.id)}
            onDrop={(e) => handleDrop(e, stage.id)}
            onAddLead={(name, org) => onAddLead(name, org, stage.id)}
            {...cardProps}
          />
        ))}

        {orphanLeads.length > 0 && (
          <Column key={UNSORTED_ID} label="Unsorted" leads={orphanLeads} {...cardProps} />
        )}

        <AddColumn onAdd={onAddColumn} />
      </div>
    </div>
  );
}

const Column = memo(function Column({
  label,
  leads,
  selectedId,
  onSelect,
  onArchive,
  onDelete,
  onDrop,
  onAddLead,
}: {
  label: string;
  leads: Lead[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onArchive: (id: string, archived: boolean) => void;
  onDelete: (id: string, name: string) => void;
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
            onArchive={onArchive}
            onDelete={onDelete}
          />
        ))}
      </div>
      {onAddLead ? <AddLead onAdd={onAddLead} /> : null}
    </div>
  );
});

const LeadCard = memo(function LeadCard({
  lead,
  selected,
  onSelect,
  onArchive,
  onDelete,
}: {
  lead: Lead;
  selected: boolean;
  onSelect: (id: string) => void;
  onArchive: (id: string, archived: boolean) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const archived = lead.archivedAt !== null;

  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", lead.id)}
      onClick={() => onSelect(lead.id)}
      className={cn(
        "group relative rounded-md border p-2 text-sm text-card-foreground",
        "cursor-pointer active:cursor-grabbing hover:border-ring",
        selected ? "border-ring bg-accent" : "border-border bg-card",
        archived && "opacity-50",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="truncate font-medium">{lead.name}</div>
          {lead.org && <div className="truncate text-xs text-muted-foreground">{lead.org}</div>}
        </div>
        <button
          className={cn(
            "-mr-1 -mt-0.5 flex-none rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground",
            menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
          onClick={(e) => {
            e.stopPropagation(); // don't select the card
            setMenuOpen((v) => !v);
          }}
          title="Card actions"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </div>

      {menuOpen && (
        <CardMenu
          archived={archived}
          onArchive={() => {
            onArchive(lead.id, !archived);
            setMenuOpen(false);
          }}
          onDelete={() => {
            onDelete(lead.id, lead.name);
            setMenuOpen(false);
          }}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
});

/** The small popover shown by a card's ⋯ button: Archive/Restore + Delete. */
function CardMenu({
  archived,
  onArchive,
  onDelete,
  onClose,
}: {
  archived: boolean;
  onArchive: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* click-away catcher */}
      <div
        className="fixed inset-0 z-10"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
      <div
        className="absolute right-1 top-8 z-20 flex w-36 flex-col rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent"
          onClick={onArchive}
        >
          {archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
          {archived ? "Restore" : "Archive"}
        </button>
        <button
          className="flex items-center gap-2 px-2 py-1.5 text-left text-xs text-destructive hover:bg-accent"
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
          Delete…
        </button>
      </div>
    </>
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
        className="h-8 rounded-md border border-input bg-transparent px-2 text-sm text-foreground placeholder:text-muted-foreground"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <input
        className="h-8 rounded-md border border-input bg-transparent px-2 text-sm text-foreground placeholder:text-muted-foreground"
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
        className="h-8 rounded-md border border-input bg-transparent px-2 text-sm text-foreground placeholder:text-muted-foreground"
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
