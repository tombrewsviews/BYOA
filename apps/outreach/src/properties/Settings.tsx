import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowUp, ArrowDown, Trash2 } from "../icons";
import type { Stage } from "../board/types";
import { openResearchFolder, type BoardConfig } from "../board/api";

interface SettingsProps {
  stages: Stage[];
  config: BoardConfig | null;
  onRename: (id: string, label: string) => void;
  onReorder: (ids: string[]) => void;
  onAddStage: (label: string) => void;
  onRemoveStage: (id: string, label: string) => void;
  actorName?: string;
  databaseUrl?: string;
  onSaveActor: (name: string) => void;
  onSaveDbUrl: (url: string) => void;
}

const SharingField: React.FC<{
  label: string;
  hint: string;
  initialValue: string;
  onSave: (value: string) => void;
  mask?: boolean;
}> = ({ label, hint, initialValue, onSave, mask }) => {
  const [value, setValue] = useState(initialValue);

  const commit = () => {
    if (value !== initialValue) onSave(value);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <Input
        type={mask ? "password" : "text"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  );
};

const StageRow: React.FC<{
  stage: Stage;
  onRename: (id: string, label: string) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}> = ({ stage, onRename, onRemove, onMoveUp, onMoveDown }) => {
  const [label, setLabel] = useState(stage.label);
  // Keep the field in sync when the label changes elsewhere (poll/other window),
  // but not while the user is actively editing this input.
  const editing = React.useRef(false);
  React.useEffect(() => {
    if (!editing.current) setLabel(stage.label);
  }, [stage.label]);

  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = (next: string) => {
    if (next.trim() && next !== stage.label) onRename(stage.id, next);
  };
  // Live rename: debounce a rename ~400ms after typing stops so the board
  // column header updates as you type, without an event per keystroke.
  const onChange = (next: string) => {
    setLabel(next);
    editing.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(next), 400);
  };
  const flush = () => {
    editing.current = false;
    if (timer.current) clearTimeout(timer.current);
    commit(label);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <Input
          value={label}
          onChange={(e) => onChange(e.target.value)}
          onBlur={flush}
          onKeyDown={(e) => {
            if (e.key === "Enter") flush();
          }}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={!onMoveUp}
          onClick={onMoveUp}
          title="Move up"
        >
          <ArrowUp className="size-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={!onMoveDown}
          onClick={onMoveDown}
          title="Move down"
        >
          <ArrowDown className="size-4" />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={onRemove} title="Remove column">
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </div>
      <div className="font-mono text-xs text-muted-foreground">{stage.id}</div>
    </div>
  );
};

/** Inline add-a-column form for Settings. */
const AddStageRow: React.FC<{ onAdd: (label: string) => void }> = ({ onAdd }) => {
  const [label, setLabel] = useState("");
  const submit = () => {
    const l = label.trim();
    if (!l) return;
    onAdd(l);
    setLabel("");
  };
  return (
    <div className="flex items-center gap-1">
      <Input
        value={label}
        placeholder="New column name…"
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <Button size="sm" variant="secondary" disabled={!label.trim()} onClick={submit}>
        Add
      </Button>
    </div>
  );
};

export const Settings: React.FC<SettingsProps> = ({
  stages,
  config,
  onRename,
  actorName,
  databaseUrl,
  onSaveActor,
  onReorder,
  onAddStage,
  onRemoveStage,
  onSaveDbUrl,
}) => {
  const ordered = [...stages]
    .filter((s) => s.retiredAt === null)
    .sort((a, b) => a.position - b.position);

  const move = (index: number, delta: number) => {
    const ids = ordered.map((s) => s.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    onReorder(ids);
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-3">
        <div className="text-sm font-medium text-foreground">Sharing</div>
        <SharingField
          label="Your name"
          hint="Stamped on every change you make, so people sharing this board can see who did what."
          initialValue={actorName ?? ""}
          onSave={onSaveActor}
        />
        <SharingField
          label="Shared database URL"
          hint="Paste a Postgres URL to make this a shared board — everyone with the same URL sees and edits it live. Leave empty to keep the board local to this machine. Changes apply the next time you open the board."
          initialValue={databaseUrl ?? ""}
          onSave={onSaveDbUrl}
          mask
        />
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-sm font-medium text-foreground">Research</div>
        <div className="text-xs text-muted-foreground">
          Drop research files (notes, transcripts, PDFs) into this board&apos;s folder, then tell
          the agent “ingest the new research”. It reads them and enriches your leads — nothing is
          sent or overwritten without your say-so.
        </div>
        <div>
          <Button size="sm" variant="secondary" onClick={() => void openResearchFolder()}>
            Open research folder
          </Button>
        </div>
      </div>
      <div className="text-xs text-muted-foreground">Created by {config?.createdBy ?? "—"}</div>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium text-foreground">Pipeline stages</div>
          <div className="text-xs text-muted-foreground">
            The columns on your board. Rename a column by editing its name here; the grey code
            below each is its permanent id, which keeps history intact when you rename.
          </div>
        </div>
        {ordered.map((stage, i) => (
          <StageRow
            key={stage.id}
            stage={stage}
            onRename={onRename}
            onRemove={() => onRemoveStage(stage.id, stage.label)}
            onMoveUp={i > 0 ? () => move(i, -1) : undefined}
            onMoveDown={i < ordered.length - 1 ? () => move(i, 1) : undefined}
          />
        ))}
        <AddStageRow onAdd={onAddStage} />
      </div>
    </div>
  );
};
