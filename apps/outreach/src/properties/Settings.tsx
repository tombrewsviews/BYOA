import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import type { Stage } from "../board/types";
import type { BoardConfig } from "../board/api";

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
  initialValue: string;
  onSave: (value: string) => void;
}> = ({ label, initialValue, onSave }) => {
  const [value, setValue] = useState(initialValue);

  const commit = () => {
    if (value !== initialValue) onSave(value);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
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
        <SharingField label="Your name" initialValue={actorName ?? ""} onSave={onSaveActor} />
        <SharingField
          label="Shared database URL"
          initialValue={databaseUrl ?? ""}
          onSave={onSaveDbUrl}
        />
        <div className="text-xs text-muted-foreground">
          With a shared URL, everyone using it sees and edits the same board live. Changes apply
          on next app open.
        </div>
      </div>
      <div className="text-xs text-muted-foreground">Created by {config?.createdBy ?? "—"}</div>
      <div className="flex flex-col gap-3">
        {ordered.map((stage) => (
          <StageRow key={stage.id} stage={stage} onRename={onRename} />
        ))}
      </div>
    </div>
  );
};
