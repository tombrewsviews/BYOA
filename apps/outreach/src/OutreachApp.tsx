import React, { useCallback, useEffect, useState } from "react";
import { isTauri } from "./runtime";
import { Chat } from "./agent-chat/Chat";
import { Terminal } from "./terminal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelRight, Plus, Trash2 } from "./icons";

type ProjectMeta = { name: string; path: string; lastOpened?: string };
type ViewMode = "terminal" | "chat";

const agentLabelFor = (id: string): string =>
  id === "codex" ? "Codex" : id === "gemini" ? "Gemini" : "Claude";

/**
 * The board/agent view: the main window is the Agent panel (Terminal/Chat)
 * on the left and a Properties panel on the right. The kanban board renders
 * in its own window, opened/refocused via the board_window_open command.
 */
const OutreachEditor: React.FC<{ project: ProjectMeta }> = ({ project }) => {
  const [viewMode, setViewMode] = useState<ViewMode>("terminal");
  const [agentId, setAgentId] = useState<"claude" | "codex" | "gemini">("claude");

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
          variant="secondary"
          size="icon-sm"
          onClick={openBoard}
          title="Open / focus the board window"
          className="ml-auto"
        >
          <PanelRight className="size-4" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
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
        </div>
        <aside className="w-80 flex-none overflow-auto border-l border-border bg-card">
          {/* Task 4.2 fills this with the Lead Inspector + Settings. */}
          <div className="p-4 text-sm text-muted-foreground">Properties</div>
        </aside>
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
