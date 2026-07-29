import React, { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "../runtime";
import { Chat, type ChatHandle } from "../agent-chat/Chat";
import { Terminal } from "../terminal";
import { startWatchLoop } from "./watch";
import { restoreBoard, startAutosave } from "./persistence";
import { exportBoardToFile, slugify } from "./portable";
import { BoardsList, type ProjectMeta } from "./BoardsList";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Download, Eye, MessageSquare, PanelRight } from "../icons";

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
const BrainstormEditor: React.FC<{
  project: ProjectMeta;
  /** Lifted so the title-bar Export button can reach the live canvas. */
  onCanvasUrl?: (url: string | null) => void;
}> = ({ project, onCanvasUrl }) => {
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
        // Restore this board's saved content into the (empty) canvas server
        // BEFORE opening the window or starting autosave, so the user sees
        // their work and autosave doesn't overwrite the saved scene with the
        // empty live one.
        await restoreBoard(url, true);
        setCanvasUrl(url);
        await invoke("brainstorm_canvas_open_window", { url }).catch(() => {});
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [project.path]);

  // Autosave the board to board.json (debounced) on any canvas change. Only
  // starts once the URL is known (i.e. after restore).
  useEffect(() => {
    if (!canvasUrl || !isTauri()) return;
    return startAutosave(canvasUrl, true);
  }, [canvasUrl]);

  // Publish the URL upward (and withdraw it on unmount, so a stale URL can't
  // outlive the board it belongs to).
  useEffect(() => {
    onCanvasUrl?.(canvasUrl);
    return () => onCanvasUrl?.(null);
  }, [canvasUrl, onCanvasUrl]);

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
      sendMention: (prompt, bubble) =>
        chatHandleRef.current?.sendMention(prompt, bubble),
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
            canvasUrl={canvasUrl ?? undefined}
          />
        </div>
      </div>
    </div>
  );
};

/** Title-bar second row shown while a board is open: back to the list + app name. */
const BoardChrome: React.FC<{
  onBack: () => void;
  onExport: () => void;
  exporting: boolean;
}> = ({ onBack, onExport, exporting }) => (
  <div className="flex h-9 flex-none items-center gap-2 border-b border-border bg-background px-2">
    <Button variant="secondary" size="sm" onClick={onBack} title="Back to all boards">
      <ChevronLeft className="size-3.5" />
      Boards
    </Button>
    <span className="truncate text-sm font-semibold text-foreground">
      Brainstorm Canvas
    </span>
    <Button
      variant="secondary"
      size="sm"
      onClick={onExport}
      disabled={exporting}
      title="Save this board as an .excalidraw file (open it on excalidraw.com to share)"
      className="ml-auto"
    >
      <Download className="size-3.5" />
      {exporting ? "Exporting…" : "Export"}
    </Button>
  </div>
);

export const BrainstormApp: React.FC<{
  onExit: () => void;
  /**
   * Wraps the app in the window chrome. `BrainstormApp` owns the board state,
   * so it decides what the title bar's second row shows; `main.tsx` supplies
   * the title bar itself.
   */
  renderChrome?: (
    secondRow: React.ReactNode,
    content: React.ReactNode,
  ) => React.ReactElement;
}> = ({ renderChrome }) => {
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [canvasUrl, setCanvasUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

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

  // Back to the list: close the board window and clear the Rust-side active
  // project (and its file watcher), so we don't leave the board we just left
  // floating on screen while the list is showing. Unmounting BrainstormEditor
  // stops its autosave; the canvas server keeps running and is re-restored from
  // board.json on the next open.
  const backToBoards = useCallback(async () => {
    setProject(null);
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("brainstorm_canvas_close_window").catch(() => {});
    await invoke("project_close").catch(() => {});
  }, []);

  const exportBoard = useCallback(async () => {
    if (!canvasUrl || !project) return;
    setExporting(true);
    setExportNote(null);
    try {
      const path = await exportBoardToFile(canvasUrl, slugify(project.name));
      // A null path means the user cancelled the save dialog — not an error.
      if (path) setExportNote(`Saved to ${path}`);
    } catch (e) {
      setExportNote(`Export failed: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }, [canvasUrl, project]);

  const content = project ? (
    <BrainstormEditor key={project.path} project={project} onCanvasUrl={setCanvasUrl} />
  ) : (
    <BoardsList onOpen={setProject} />
  );
  // The second row is board chrome — on the boards list there's nowhere to go
  // back to, and that screen has its own heading.
  const secondRow = project ? (
    <>
      <BoardChrome
        onBack={backToBoards}
        onExport={exportBoard}
        exporting={exporting}
      />
      {exportNote ? (
        <div className="flex-none border-b border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
          {exportNote}
        </div>
      ) : null}
    </>
  ) : null;

  return renderChrome ? renderChrome(secondRow, content) : content;
};
