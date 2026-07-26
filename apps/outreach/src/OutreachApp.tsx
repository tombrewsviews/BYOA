import React, { useCallback, useEffect, useState } from "react";
import { isTauri } from "./runtime";
import { Chat } from "./agent-chat/Chat";
import { Terminal } from "./terminal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelRight, Plus, MoreHorizontal, ArrowLeft } from "./icons";
import { Modal } from "./components/Modal";
import { Inspector } from "./properties/Inspector";
import { LeadCombobox } from "./properties/LeadCombobox";
import { Settings } from "./properties/Settings";
import {
  listStages,
  getLead,
  snapshot,
  renameStage,
  reorderStages,
  addStage,
  retireStage,
  moveLead,
  setLeadArchived,
  deleteLead,
  appendContext,
  attachFile,
  revealFile,
  getSettings,
  setActorName,
  saveSharedUrl,
  listActors,
} from "./board/api";
import type { Stage, Lead } from "./board/types";
import type { LeadDetail, BoardConfig, Actor } from "./board/api";

type ProjectMeta = { name: string; path: string; lastOpened?: string };
type ViewMode = "terminal" | "chat" | "inspector" | "settings";

const agentLabelFor = (id: string): string =>
  id === "codex" ? "Codex" : id === "gemini" ? "Gemini" : "Claude";

/**
 * The Properties content: Inspector (a selected lead's context/messages/
 * transcripts) and Settings (stage list with stable ids + board created_by,
 * rename-in-place). Its own tab bar was hoisted into OutreachEditor so all
 * four views share a single tab bar; this component only renders the body
 * for whichever of the two is active.
 */
const PropertiesPanel: React.FC<{
  tab: "inspector" | "settings";
  selectedLeadId: string;
  setSelectedLeadId: (id: string) => void;
}> = ({ tab, selectedLeadId, setSelectedLeadId }) => {
  const [stages, setStages] = useState<Stage[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [config, setConfig] = useState<BoardConfig | null>(null);
  const [actors, setActors] = useState<Actor[]>([]);
  const [selectedLead, setSelectedLead] = useState<LeadDetail | null>(null);
  const [actorName, setActorNameState] = useState<string | undefined>(undefined);
  const [databaseUrl, setDatabaseUrlState] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);
  // Latest leads without making the select effect re-run every poll tick.
  const leadsRef = React.useRef<Lead[]>([]);
  leadsRef.current = leads;
  // Full-detail cache, keyed by lead id. Selecting a lead we've opened before
  // paints its detail INSTANTLY from this map (0ms, no network) — the ~600ms
  // getLead round-trip on the shared board is what made re-selection feel slow.
  // getLead still runs in the background to refresh the entry.
  const detailCache = React.useRef<Map<string, LeadDetail>>(new Map());

  useEffect(() => {
    if (!isTauri()) return;
    void getSettings()
      .then((s) => {
        setActorNameState(s.actorName);
        setDatabaseUrlState(s.databaseUrl);
      })
      .catch(() => {});
  }, []);

  // The @-mention roster (everyone who has opened the board, INCLUDING you so
  // you can @-mention yourself). Fetch whenever the Inspector is shown so the
  // roster is ready before you type `@`, and re-fetch on each show so a new
  // collaborator appears. (An empty roster was why the @-popup showed nothing.)
  useEffect(() => {
    if (!isTauri() || tab !== "inspector") return;
    void listActors()
      .then(setActors)
      .catch(() => {});
  }, [tab]);

  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // One `board_snapshot` round-trip per tick (not 3 separate commands), and
    // poll a remote board rarely (5s) vs a local one often (2s) — hammering a
    // transatlantic DB is what made the app laggy.
    const tick = async () => {
      if (stopped) return;
      let nextMs = 2000;
      try {
        const snap = await snapshot();
        if (!stopped) {
          setStages(snap.stages);
          setLeads(snap.leads);
          setConfig(snap.config);
          nextMs = snap.mode === "shared" ? 5000 : 2000;
        }
      } catch {
        /* transient — try again next tick */
      } finally {
        if (!stopped) timer = setTimeout(tick, nextMs);
      }
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // The selected lead's stage/archived state as seen by the 2s board poll. When
  // it changes (e.g. the card was dragged to another column in the board
  // window), re-fetch the detail so the Inspector's Stage dropdown and badge
  // stay in sync — otherwise the detail is stale until the lead is reselected.
  const selectedSignal = (() => {
    const l = leads.find((x) => x.id === selectedLeadId);
    return l ? `${l.stage}|${l.archivedAt ?? ""}` : "";
  })();

  useEffect(() => {
    if (!isTauri() || !selectedLeadId) {
      setSelectedLead(null);
      return;
    }
    // Paint the Inspector INSTANTLY (<50ms, no network). Prefer a cached full
    // detail from a previous open of this lead; otherwise fall back to a stub
    // built from the local `leads` row (name/org/stage/archived are already in
    // hand). The rich detail (context/messages/transcripts) fills in when the
    // background getLead resolves.
    const cached = detailCache.current.get(selectedLeadId);
    if (cached) {
      setSelectedLead(cached);
    } else {
      const local = leadsRef.current.find((l) => l.id === selectedLeadId);
      if (local) {
        setSelectedLead((prev) =>
          prev && prev.id === selectedLeadId
            ? prev // keep the already-loaded full detail; getLead below refreshes it
            : {
                id: local.id,
                stage: local.stage,
                name: local.name,
                org: local.org,
                context: {},
                messages: [],
                transcripts: [],
                archivedAt: local.archivedAt,
                createdAt: "",
                updatedAt: "",
                version: local.version,
              },
        );
      }
    }
    void getLead(selectedLeadId)
      .then((detail) => {
        detailCache.current.set(detail.id, detail);
        // Only apply if this lead is still the selected one (guards a fast
        // re-select landing an older lead's response on the newer selection).
        setSelectedLead((prev) => (prev && prev.id !== detail.id ? prev : detail));
      })
      .catch(() => {
        /* keep the cached detail / local stub on failure rather than blanking */
      });
  }, [selectedLeadId, reloadKey, selectedSignal]);

  const reloadLead = useCallback(() => setReloadKey((k) => k + 1), []);

  const handleRename = useCallback((id: string, label: string) => {
    void renameStage(id, label)
      .then(() => listStages())
      .then(setStages)
      .catch(() => {});
  }, []);

  const handleChangeStage = useCallback(
    (toStage: string) => {
      if (!selectedLead) return;
      void moveLead(selectedLead.id, toStage, selectedLead.version)
        .then(reloadLead)
        .catch(() => {});
    },
    [selectedLead, reloadLead],
  );

  const handleAddNote = useCallback(
    (note: string) => {
      if (!selectedLead) return;
      void appendContext(selectedLead.id, { note }, selectedLead.version)
        .then(reloadLead)
        .catch(() => {});
    },
    [selectedLead, reloadLead],
  );

  const handleAttach = useCallback(() => {
    if (!selectedLead) return;
    const lead = selectedLead;
    void (async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: false,
        title: "Attach a presentation",
      }).catch(() => null);
      if (!picked || typeof picked !== "string") return;
      const stored = await attachFile(lead.id, picked).catch(() => null);
      if (!stored) return;
      const name = picked.split("/").pop() ?? "Attachment";
      // Re-read the lead for a fresh version before appending (attach is async).
      const fresh = await getLead(lead.id).catch(() => null);
      const version = fresh?.version ?? lead.version;
      await appendContext(lead.id, { presentation: { name, path: stored } }, version).catch(
        () => {},
      );
      reloadLead();
    })();
  }, [selectedLead, reloadLead]);

  const handleReveal = useCallback((path: string) => {
    void revealFile(path).catch(() => {});
  }, []);

  const handleArchive = useCallback(
    (archived: boolean) => {
      if (!selectedLead) return;
      void setLeadArchived(selectedLead.id, archived)
        .then(reloadLead)
        .catch(() => {});
    },
    [selectedLead, reloadLead],
  );

  const handleDelete = useCallback(() => {
    if (!selectedLead) return;
    if (!window.confirm(`Delete "${selectedLead.name}"? This removes the card from the board.`)) {
      return;
    }
    const id = selectedLead.id;
    void deleteLead(id)
      .then(() => setSelectedLeadId(""))
      .catch(() => {});
  }, [selectedLead, setSelectedLeadId]);

  const handleSaveActor = useCallback((name: string) => {
    setActorNameState(name);
    void setActorName(name).catch(() => {});
  }, []);

  const handleSaveDbUrl = useCallback((url: string) => {
    setDatabaseUrlState(url);
    // The Rust command runs the connect + copy off the UI thread and reports
    // progress via the `board://sync-progress` event (rendered as a bar in
    // Settings). Errors also arrive on that event, so nothing to do here on
    // failure but swallow the rejection.
    void saveSharedUrl(url).catch(() => {});
  }, []);

  const handleReorder = useCallback((ids: string[]) => {
    void reorderStages(ids)
      .then(() => listStages())
      .then(setStages)
      .catch(() => {});
  }, []);

  const handleAddStage = useCallback((label: string) => {
    void (async () => {
      const current = await listStages().catch(() => [] as Stage[]);
      const maxPos = current.reduce((m, s) => Math.max(m, s.position), -1);
      await addStage(label, maxPos + 1).catch(() => {});
      const fresh = await listStages().catch(() => current);
      setStages(fresh);
    })();
  }, []);

  const handleRemoveStage = useCallback(
    (id: string, label: string) => {
      const inColumn = leads.filter((l) => l.stage === id && l.archivedAt === null).length;
      const warning =
        inColumn > 0
          ? `Remove the "${label}" column? Its ${inColumn} card${inColumn === 1 ? "" : "s"} will move to an "Unsorted" column — move them first if you want to keep them sorted.`
          : `Remove the "${label}" column?`;
      if (!window.confirm(warning)) return;
      void retireStage(id)
        .then(() => listStages())
        .then(setStages)
        .catch(() => {});
    },
    [leads],
  );

  return tab === "inspector" ? (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col">
      <div className="flex-none p-2">
        <LeadCombobox leads={leads} value={selectedLeadId} onChange={setSelectedLeadId} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Inspector
          lead={selectedLead}
          stages={stages}
          actors={actors}
          onChangeStage={handleChangeStage}
          onAddNote={handleAddNote}
          onAttach={handleAttach}
          onRevealAttachment={handleReveal}
          onArchive={handleArchive}
          onDelete={handleDelete}
        />
      </div>
    </div>
  ) : (
    <div className="mx-auto h-full min-h-0 w-full max-w-2xl overflow-auto">
      <Settings
        stages={stages}
        config={config}
        onRename={handleRename}
        onReorder={handleReorder}
        onAddStage={handleAddStage}
        onRemoveStage={handleRemoveStage}
        actorName={actorName}
        databaseUrl={databaseUrl}
        onSaveActor={handleSaveActor}
        onSaveDbUrl={handleSaveDbUrl}
      />
    </div>
  );
};

/**
 * The board/agent view: the main window is the Agent panel (Terminal/Chat)
 * on the left and a Properties panel on the right. The kanban board renders
 * in its own window, opened/refocused via the board_window_open command.
 */
const OutreachEditor: React.FC<{ project: ProjectMeta; onBackToBoards: () => void }> = ({
  project,
  onBackToBoards,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>("terminal");
  const [agentId, setAgentId] = useState<"claude" | "codex" | "gemini">("claude");
  const [selectedLeadId, setSelectedLeadId] = useState<string>("");

  // Clicking a card in the board window emits this; open the Inspector on it.
  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const un = await listen<string>("board://select-lead", (e) => {
        setSelectedLeadId(e.payload);
        setViewMode("inspector");
      });
      off = () => un();
    })();
    return () => {
      if (off) off();
    };
  }, []);

  useEffect(() => {
    void (async () => {
      if (!isTauri()) return;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const settings = await invoke<{ default_agent?: string }>("get_settings").catch(
          () => ({}) as { default_agent?: string },
        );
        const id = settings?.default_agent;
        if (id === "claude" || id === "codex" || id === "gemini") setAgentId(id);
      } catch {
        /* keep claude default */
      }
    })();
  }, []);

  // Open the board window on mount. It self-polls, so nothing else here
  // needs to drive it.
  useEffect(() => {
    if (!isTauri()) return;
    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      // Warm the (shared) board connection off the UI thread first, so this
      // window's Settings poll doesn't try to connect synchronously and freeze.
      await invoke("board_ensure_connected").catch(() => {});
      await invoke("board_window_open").catch(() => {});
    })();
  }, [project.path]);

  const openBoard = useCallback(async () => {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("board_window_open").catch(() => {});
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Board title row (below the app's system title bar): a Boards back
          button to the left of the current board's name. */}
      <div className="flex flex-none items-center gap-2 border-b border-border px-2 py-1.5">
        <Button size="sm" variant="secondary" onClick={onBackToBoards} title="Back to all boards">
          <ArrowLeft className="size-4" />
          Boards
        </Button>
        <span className="truncate text-sm font-semibold text-foreground">{project.name}</span>
      </div>
      <div className="flex flex-none items-center gap-1 border-b border-border px-2 py-1">
        <Button
          size="sm"
          variant={viewMode === "terminal" ? "default" : "secondary"}
          onClick={() => setViewMode("terminal")}
        >
          Terminal
        </Button>
        <Button
          size="sm"
          variant={viewMode === "chat" ? "default" : "secondary"}
          onClick={() => setViewMode("chat")}
        >
          {`Chat · ${agentLabelFor(agentId)}`}
        </Button>
        <Button
          size="sm"
          variant={viewMode === "inspector" ? "default" : "secondary"}
          onClick={() => setViewMode("inspector")}
        >
          Inspector
        </Button>
        <Button
          size="sm"
          variant={viewMode === "settings" ? "default" : "secondary"}
          onClick={() => setViewMode("settings")}
        >
          Settings
        </Button>
        <Button
          variant="secondary"
          size="icon-sm"
          onClick={openBoard}
          title="Open / focus the board window"
          className="ml-auto"
        >
          <PanelRight className="size-4" />
        </Button>
      </div>

      <div className="relative min-h-0 min-w-0 flex-1">
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: viewMode === "terminal" ? "block" : "none",
          }}
        >
          <Terminal />
        </div>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: viewMode === "chat" ? "block" : "none",
          }}
        >
          <Chat
            agentId={agentId}
            agentLabel={agentLabelFor(agentId)}
            cwd={project.path}
            onSwitchToTerminal={() => setViewMode("terminal")}
          />
        </div>
        {viewMode === "inspector" || viewMode === "settings" ? (
          <div className="absolute inset-0 overflow-auto">
            <PropertiesPanel
              tab={viewMode}
              selectedLeadId={selectedLeadId}
              setSelectedLeadId={setSelectedLeadId}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
};

/**
 * Boards list — the entry screen. The user picks or creates a board here;
 * opening one is the ONLY way into the board/agent view.
 */
const BoardsList: React.FC<{ onOpen: (m: ProjectMeta) => void }> = ({ onOpen }) => {
  const [boards, setBoards] = useState<ProjectMeta[]>([]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Which board a modal is acting on (null = closed).
  const [renaming, setRenaming] = useState<ProjectMeta | null>(null);
  const [deleting, setDeleting] = useState<ProjectMeta | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri()) {
      setBoards([]);
      return;
    }
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const list = await invoke<ProjectMeta[]>("projects_list", { canvas: "outreach" });
      setBoards(list);
    } catch (e) {
      setError(`Failed to list boards: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = useCallback(
    async (meta: ProjectMeta) => {
      if (!isTauri()) return onOpen(meta);
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        await invoke("project_open", { path: meta.path });
        onOpen(meta);
      } catch (e) {
        setError(`Open failed: ${(e as Error).message}`);
      }
    },
    [onOpen],
  );

  const create = useCallback(async () => {
    if (!isTauri()) return;
    setBusy(true);
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const meta = await invoke<ProjectMeta>("projects_create", {
        name: newName.trim() || "Outreach Board",
        canvas: "outreach",
      });
      setNewName("");
      await open(meta);
    } catch (e) {
      setError(`Create failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [newName, open]);

  const remove = useCallback(
    async (path: string) => {
      if (!isTauri()) return;
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        await invoke("project_delete", { path });
        setDeleting(null);
        await refresh();
      } catch (e) {
        setError(`Delete failed: ${(e as Error).message}`);
      }
    },
    [refresh],
  );

  const rename = useCallback(
    async (path: string, name: string) => {
      if (!isTauri()) return;
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        await invoke("projects_rename", { path, name });
        setRenaming(null);
        await refresh();
      } catch (e) {
        setError(`Rename failed: ${(e as Error).message}`);
      }
    },
    [refresh],
  );

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 p-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Outreach boards</h1>
        <p className="text-sm text-muted-foreground">
          Pick a board to open it with the agent, or start a new one.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New board name…"
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
        />
        <Button onClick={create} disabled={busy}>
          <Plus className="size-4" />
          New board
        </Button>
      </div>

      {error ? <div className="text-sm text-destructive">{error}</div> : null}

      <div className="flex flex-1 flex-col gap-2 overflow-auto">
        {boards.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No boards yet. Create your first one above.
          </div>
        ) : (
          boards.map((b) => (
            <div
              key={b.path}
              className="group flex items-center justify-between rounded-lg border border-border bg-card p-3 hover:bg-accent"
            >
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => void open(b)}
                title="Open this board"
              >
                <div className="truncate text-sm font-medium text-foreground">{b.name}</div>
                <div className="truncate text-xs text-muted-foreground">{b.path}</div>
              </button>
              <BoardRowMenu
                onRename={() => setRenaming(b)}
                onDelete={() => setDeleting(b)}
              />
            </div>
          ))
        )}
      </div>

      <RenameBoardModal
        board={renaming}
        onClose={() => setRenaming(null)}
        onSubmit={(name) => renaming && void rename(renaming.path, name)}
      />
      <DeleteBoardModal
        board={deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && void remove(deleting.path)}
      />
    </div>
  );
};

/** Hover-revealed 3-dot menu on a board row: Rename / Delete. */
const BoardRowMenu: React.FC<{ onRename: () => void; onDelete: () => void }> = ({
  onRename,
  onDelete,
}) => {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={ref} className="relative flex-none">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen((v) => !v)}
        title="Board options"
        className={open ? "" : "opacity-0 group-hover:opacity-100"}
      >
        <MoreHorizontal className="size-4" />
      </Button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-36 overflow-hidden rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md">
          <button
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => {
              setOpen(false);
              onRename();
            }}
          >
            Rename…
          </button>
          <button
            className="block w-full px-3 py-1.5 text-left text-sm text-destructive hover:bg-accent"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            Delete…
          </button>
        </div>
      ) : null}
    </div>
  );
};

/** Rename modal: a text field prefilled with the board's current name. */
const RenameBoardModal: React.FC<{
  board: ProjectMeta | null;
  onClose: () => void;
  onSubmit: (name: string) => void;
}> = ({ board, onClose, onSubmit }) => {
  const [name, setName] = useState("");
  // Prefill each time a board is chosen for renaming.
  useEffect(() => {
    if (board) setName(board.name);
  }, [board]);
  const submit = () => {
    if (name.trim()) onSubmit(name.trim());
  };
  return (
    <Modal
      open={board !== null}
      title="Rename board"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Board name…"
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
    </Modal>
  );
};

/** Delete confirmation modal. */
const DeleteBoardModal: React.FC<{
  board: ProjectMeta | null;
  onClose: () => void;
  onConfirm: () => void;
}> = ({ board, onClose, onConfirm }) => (
  <Modal
    open={board !== null}
    title="Delete board"
    onClose={onClose}
    footer={
      <>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={onConfirm}>
          Delete
        </Button>
      </>
    }
  >
    <p className="text-sm text-foreground">
      Delete <span className="font-medium">{board?.name}</span>? The board is moved to the Trash.
    </p>
  </Modal>
);

export const OutreachApp: React.FC = () => {
  const [project, setProject] = useState<ProjectMeta | null>(null);

  // A project opened elsewhere (the platform's project://opened event) also
  // enters the board view, keeping behaviour consistent with the other apps.
  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const un = await listen<ProjectMeta>("project://opened", (e) =>
        setProject(e.payload),
      );
      off = () => un();
    })();
    return () => {
      if (off) off();
    };
  }, []);

  const backToBoards = useCallback(() => {
    setProject(null);
    void (async () => {
      if (!isTauri()) return;
      const { invoke } = await import("@tauri-apps/api/core");
      // Close the project (clears the active project + cached board connections)
      // and the separate board window, so the boards list is a clean slate.
      await invoke("board_window_close").catch(() => {});
      await invoke("project_close").catch(() => {});
    })();
  }, []);

  if (!project) return <BoardsList onOpen={setProject} />;
  return <OutreachEditor key={project.path} project={project} onBackToBoards={backToBoards} />;
};
