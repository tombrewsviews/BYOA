import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Stage } from "../board/types";
import { openResearchFolder, type BoardConfig } from "../board/api";

interface SettingsProps {
  stages: Stage[];
  config: BoardConfig | null;
  onRename: (id: string, label: string) => void;
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

const StageRow: React.FC<{ stage: Stage; onRename: (id: string, label: string) => void }> = ({
  stage,
  onRename,
}) => {
  const [label, setLabel] = useState(stage.label);

  const commit = () => {
    if (label !== stage.label) onRename(stage.id, label);
  };

  return (
    <div className="flex flex-col gap-1">
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      <div className="font-mono text-xs text-muted-foreground">{stage.id}</div>
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
  onSaveDbUrl,
}) => {
  const ordered = [...stages].sort((a, b) => a.position - b.position);

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
        {ordered.map((stage) => (
          <StageRow key={stage.id} stage={stage} onRename={onRename} />
        ))}
      </div>
    </div>
  );
};
