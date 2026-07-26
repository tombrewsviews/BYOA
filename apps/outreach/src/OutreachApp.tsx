import React, { useCallback, useEffect, useState } from "react";
import { isTauri } from "./runtime";
import { Chat } from "./agent-chat/Chat";
import { Terminal } from "./terminal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelRight, Plus, Trash2 } from "./icons";
import { Inspector } from "./properties/Inspector";
import { Settings } from "./properties/Settings";
import {
  listStages,
  listLeads,
  getLead,
  getConfig,
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
} from "./board/api";
import type { Stage, Lead } from "./board/types";
import type { LeadDetail, BoardConfig } from "./board/api";

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
  const [selectedLead, setSelectedLead] = useState<LeadDetail | null>(null);
  const [actorName, setActorNameState] = useState<string | undefined>(undefined);
  const [databaseUrl, setDatabaseUrlState] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isTauri()) return;
    void getSettings()
      .then((s) => {
        setActorNameState(s.actorName);
        setDatabaseUrlState(s.databaseUrl);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const [s, l, c] = await Promise.all([listStages(), listLeads(), getConfig()]);
        if (!stopped) {
          setStages(s);
          setLeads(l);
          setConfig(c);
        }
      } catch {
        /* transient — try again next tick */
      }
    };
    void tick();
    const h = setInterval(tick, 2000);
    return () => {
      stopped = true;
      clearInterval(h);
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
    void getLead(selectedLeadId)
      .then(setSelectedLead)
      .catch(() => setSelectedLead(null));
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
        <select
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          value={selectedLeadId}
          onChange={(e) => setSelectedLeadId(e.target.value)}
        >
          <option value="">Select a lead…</option>
          {leads.map((lead) => (
            <option key={lead.id} value={lead.id}>
              {lead.name}
            </option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Inspector
          lead={selectedLead}
          stages={stages}
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
const OutreachEditor: React.FC<{ project: ProjectMeta }> = ({ project }) => {
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
        await refresh();
      } catch (e) {
        setError(`Delete failed: ${(e as Error).message}`);
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
                className="flex-1 text-left"
                onClick={() => void open(b)}
                title="Open this board"
              >
                <div className="text-sm font-medium text-foreground">{b.name}</div>
                <div className="text-xs text-muted-foreground">{b.path}</div>
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void remove(b.path)}
                title="Delete board"
                className="opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

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

  if (!project) return <BoardsList onOpen={setProject} />;
  return <OutreachEditor key={project.path} project={project} />;
};
