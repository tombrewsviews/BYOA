import React, { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowUp, ArrowDown, Trash2 } from "../icons";
import { isTauri } from "../runtime";
import type { Stage } from "../board/types";
import {
  openResearchFolder,
  connectionStatus,
  ensureConnected,
  type BoardConfig,
  type SyncProgress,
  type ConnectionStatus,
} from "../board/api";

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
  children?: React.ReactNode;
}> = ({ label, hint, initialValue, onSave, mask, children }) => {
  const [value, setValue] = useState(initialValue);
  // `initialValue` arrives asynchronously (getSettings resolves after mount),
  // so seed the field once it shows up — otherwise a saved URL never appears.
  // Only sync while the user isn't actively editing, to avoid clobbering typing.
  const editing = React.useRef(false);
  React.useEffect(() => {
    if (!editing.current) setValue(initialValue);
  }, [initialValue]);

  const commit = () => {
    editing.current = false;
    if (value !== initialValue) onSave(value);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <Input
        type={mask ? "password" : "text"}
        value={value}
        onChange={(e) => {
          editing.current = true;
          setValue(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      {children}
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  );
};

/**
 * Live connection indicator under the DB-URL field, so the user can tell
 * whether the remote board is actually reachable. Polls board_connection_status
 * (which never connects, so it can't freeze) and, while shared-but-not-yet-
 * connected, kicks the background warm-up.
 */
const ConnectionBadge: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      const s = await connectionStatus().catch(() => null);
      if (stopped) return;
      setStatus(s);
      // Shared board configured but not connected yet → warm it up (off-thread).
      if (s && s.mode === "shared" && !s.connected) {
        void ensureConnected().catch(() => {});
      }
    };
    void tick();
    const h = setInterval(tick, 2000);
    return () => {
      stopped = true;
      clearInterval(h);
    };
  }, []);

  if (!status || status.mode === "local") {
    return (
      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="inline-block size-2 rounded-full bg-muted-foreground/50" />
        Local board (this machine only)
      </div>
    );
  }
  return (
    <div className="mt-1 flex items-center gap-1.5 text-xs">
      <span
        className={`inline-block size-2 rounded-full ${
          status.connected ? "bg-green-500" : "animate-pulse bg-amber-500"
        }`}
      />
      <span className={status.connected ? "text-muted-foreground" : "text-amber-600"}>
        {status.connected ? "Connected to the shared board" : "Connecting to the shared board…"}
      </span>
    </div>
  );
};

/**
 * Live progress for the shared-board sync, below the DB-URL field. Driven by
 * the `board://sync-progress` events the save command emits. The bar is
 * determinate during the copy phase (done/total) and indeterminate-ish
 * (message only) while connecting/checking. Auto-clears a few seconds after
 * "done"; an error stays until the next save.
 */
const SyncBar: React.FC<{ progress: SyncProgress | null }> = ({ progress }) => {
  if (!progress) return null;
  const { phase, done, total, message } = progress;
  const pct = phase === "done" ? 100 : total > 0 ? Math.round((done / total) * 100) : null;
  const isError = phase === "error";
  return (
    <div className="mt-1 flex flex-col gap-1" role="status" aria-live="polite">
      <div className={`text-xs ${isError ? "text-destructive" : "text-muted-foreground"}`}>
        {message}
        {phase === "copying" && total > 0 ? ` (${done}/${total})` : ""}
      </div>
      {!isError ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${
              pct === null ? "w-1/3 animate-pulse bg-primary/60" : "bg-primary"
            }`}
            style={pct === null ? undefined : { width: `${pct}%` }}
          />
        </div>
      ) : null}
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
  const [sync, setSync] = useState<SyncProgress | null>(null);

  // Subscribe to the shared-board sync progress emitted by board_save_shared_url.
  // Clear the bar a few seconds after it finishes so it doesn't linger.
  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | undefined;
    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const un = await listen<SyncProgress>("board://sync-progress", (e) => {
        setSync(e.payload);
        if (clearTimer) clearTimeout(clearTimer);
        if (e.payload.phase === "done") {
          clearTimer = setTimeout(() => setSync(null), 6000);
        }
      });
      off = () => un();
    })();
    return () => {
      if (clearTimer) clearTimeout(clearTimer);
      if (off) off();
    };
  }, []);

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
        >
          <ConnectionBadge />
          <SyncBar progress={sync} />
        </SharingField>
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
