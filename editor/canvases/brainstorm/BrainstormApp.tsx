import React, { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "../../runtime";
import { Chat, type ChatHandle } from "../../agent-chat/Chat";
import { Terminal } from "../../terminal";
import { startWatchLoop } from "./watch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, MessageSquare, PanelRight, Plus, Trash2 } from "../../icons";

type ProjectMeta = { name: string; path: string; lastOpened?: string };
type Mode = "prompted" | "continuous";
type ViewMode = "terminal" | "chat";

const agentLabelFor = (id: string): string =>
  id === "codex" ? "Codex" : id === "gemini" ? "Gemini" : "Claude";

/**
 * The board/agent view: the main window is JUST the agent panel. The live
 * Excalidraw board renders in its own window (the Rust backend opens both
 * windows tiled — agent panel on the left, board filling the rest). The
 * "open board" icon button reopens/refocuses the board window if closed.
 */
const BrainstormEditor: React.FC<{ project: ProjectMeta }> = ({ project }) => {
  const [canvasUrl, setCanvasUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("prompted");
  const [viewMode, setViewMode] = useState<ViewMode>("terminal");
  const [agentId, setAgentId] = useState<"claude" | "codex" | "gemini">("claude");

  const chatHandleRef = useRef<ChatHandle | null>(null);
  const shownView: ViewMode = mode === "continuous" ? "chat" : viewMode;

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

  // Start the canvas server, then open the board window (the backend tiles both
  // windows to fill the screen). The board is a separate first-party window —
  // WKWebView partitions cross-origin iframe storage, which left an embedded
  // board blank.
  useEffect(() => {
    void (async () => {
      if (!isTauri()) {
        setCanvasUrl("http://127.0.0.1:3939");
        return;
      }
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const url = await invoke<string>("brainstorm_canvas_start");
        setCanvasUrl(url);
        await invoke("brainstorm_canvas_open_window", { url }).catch(() => {});
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [project.path]);

  const openBoard = useCallback(async () => {
    if (!isTauri() || !canvasUrl) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("brainstorm_canvas_open_window", { url: canvasUrl }).catch(() => {});
  }, [canvasUrl]);

  // Watch loop (continuous mode).
  useEffect(() => {
    if (mode !== "continuous" || !canvasUrl) return;
    const stop = startWatchLoop(canvasUrl, {
      sendWatch: (prompt) => chatHandleRef.current?.sendWatch(prompt),
      isRunning: () => chatHandleRef.current?.isRunning() ?? false,
    });
    return stop;
  }, [mode, canvasUrl]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: "#000",
      }}
    >
      {/* Mode row: Prompted/Continuous on the left, open-board on the right. */}
      <div className="flex flex-none items-center gap-2 border-b border-border p-2">
        <span className="text-xs text-muted-foreground">Mode</span>
        <div className="flex gap-1">
          <Button
            variant={mode === "prompted" ? "default" : "secondary"}
            size="sm"
            onClick={() => setMode("prompted")}
            title="Agent responds when you prompt it"
          >
            <MessageSquare className="size-3.5" />
            Prompted
          </Button>
          <Button
            variant={mode === "continuous" ? "default" : "secondary"}
            size="sm"
            onClick={() => setMode("continuous")}
            title="Agent watches the board and chimes in like a collaborator"
          >
            <Eye className="size-3.5" />
            Continuous
          </Button>
        </div>
        <Button
          variant="secondary"
          size="icon-sm"
          onClick={openBoard}
          disabled={!canvasUrl}
          title="Open / focus the board window"
          className="ml-auto"
        >
          <PanelRight className="size-4" />
        </Button>
      </div>

      {error ? (
        <div className="flex-none px-3 py-1.5 text-xs text-destructive">{error}</div>
      ) : null}

      {/* Terminal/Chat switch (hidden in continuous mode, which pins chat). */}
      {mode === "prompted" ? (
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
        </div>
      ) : (
        <div className="flex-none border-b border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
          Watching the board — {agentLabelFor(agentId)} will comment when it has
          something useful.
        </div>
      )}

      {/* Both views mounted; Chat stays mounted so its watch handle is live. */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: shownView === "terminal" ? "block" : "none",
          }}
        >
          <Terminal />
        </div>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: shownView === "chat" ? "block" : "none",
          }}
        >
          <Chat
            agentId={agentId}
            agentLabel={agentLabelFor(agentId)}
            cwd={project.path}
            onSwitchToTerminal={() => setViewMode("terminal")}
            onReady={(h) => {
              chatHandleRef.current = h;
            }}
          />
        </div>
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
      const list = await invoke<ProjectMeta[]>("projects_list", { canvas: "brainstorm" });
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
        name: newName.trim() || "Brainstorm Session",
        canvas: "brainstorm",
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
        <h1 className="text-xl font-semibold text-foreground">Brainstorm boards</h1>
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

export const BrainstormApp: React.FC<{ onExit: () => void }> = () => {
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
  return <BrainstormEditor key={project.path} project={project} />;
};
