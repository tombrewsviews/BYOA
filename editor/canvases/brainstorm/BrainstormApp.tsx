import React, { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "../../runtime";
import { Chat, type ChatHandle } from "../../agent-chat/Chat";
import { Terminal } from "../../terminal";
import { startWatchLoop } from "./watch";
import { Button } from "@/components/ui/button";
import { Eye, MessageSquare } from "../../icons";

type ProjectMeta = { name: string; path: string };
type Mode = "prompted" | "continuous";
type ViewMode = "terminal" | "chat";

const agentLabelFor = (id: string): string =>
  id === "codex" ? "Codex" : id === "gemini" ? "Gemini" : "Claude";

/**
 * Brainstorm Canvas editor: agent panel (left) + live Excalidraw board (right).
 *
 * The board is a webview of the local canvas server (started by the Rust
 * backend, which returns its URL). The agent reaches the SAME board through the
 * `excalidraw` MCP (seeded in the project's `.mcp.json`). Two modes:
 *   - prompted: normal chat; the agent acts/draws when asked.
 *   - continuous: a watch loop fires observe-only turns after the user pauses
 *     drawing; the agent suggests (or stays silent) but does not draw.
 */
const BrainstormEditor: React.FC<{ project: ProjectMeta }> = ({ project }) => {
  const [canvasUrl, setCanvasUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("prompted");
  // Default to the terminal (interactive `claude --dangerously-skip-permissions`
  // launched by the PTY). The Chat view is the structured agent UI. Continuous
  // mode forces the Chat view so the watch observations are visible.
  const [viewMode, setViewMode] = useState<ViewMode>("terminal");
  const [agentId, setAgentId] = useState<"claude" | "codex" | "gemini">("claude");
  const [leftW, setLeftW] = useState(360);

  const chatHandleRef = useRef<ChatHandle | null>(null);
  // The view actually shown: continuous mode pins chat (watch comments land in
  // the chat transcript); otherwise the user's toggle wins.
  const shownView: ViewMode = mode === "continuous" ? "chat" : viewMode;

  // Resolve the default agent (same source as the other apps).
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

  // Start the canvas server and get its URL for the webview.
  useEffect(() => {
    void (async () => {
      if (!isTauri()) {
        // Browser dev: assume a server already running on the preferred port.
        setCanvasUrl("http://127.0.0.1:3939");
        return;
      }
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const url = await invoke<string>("brainstorm_canvas_start");
        setCanvasUrl(url);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [project.path]);

  // Drive the watch loop in continuous mode. Tears down on mode change /
  // unmount so leaving continuous mode stops watching immediately.
  useEffect(() => {
    if (mode !== "continuous" || !canvasUrl) return;
    const stop = startWatchLoop(canvasUrl, {
      sendWatch: (prompt) => chatHandleRef.current?.sendWatch(prompt),
      isRunning: () => chatHandleRef.current?.isRunning() ?? false,
    });
    return stop;
  }, [mode, canvasUrl]);

  // Drag the divider to resize the agent panel.
  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = leftW;
      const onMove = (ev: MouseEvent) =>
        setLeftW(Math.max(260, Math.min(640, startW + (ev.clientX - startX))));
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
      };
      document.body.style.cursor = "col-resize";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [leftW],
  );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `${leftW}px 5px minmax(0, 1fr)`,
        height: "100%",
        background: "#000",
      }}
    >
      {/* LEFT: mode toggle + agent panel */}
      <div
        style={{
          gridColumn: 1,
          borderRight: "1px solid #222",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
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
        </div>
        {/* Terminal/Chat switch. Hidden in continuous mode, which pins the
            chat view so watch observations are visible. */}
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
            Watching the board — {agentLabelFor(agentId)} will comment when it
            has something useful.
          </div>
        )}
        {/* Content: both views are mounted; visibility is toggled. Chat stays
            mounted always so its watch handle (onReady) stays live for the
            continuous-mode loop even while the terminal is showing. */}
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

      {/* DIVIDER */}
      <div
        onMouseDown={startDrag}
        title="Drag to resize"
        style={{ gridColumn: 2, cursor: "col-resize", background: "transparent" }}
      />

      {/* RIGHT: the live Excalidraw board */}
      <div style={{ gridColumn: 3, minWidth: 0, minHeight: 0, position: "relative" }}>
        {error ? (
          <div style={{ padding: 40, color: "#e66" }}>
            Canvas server failed to start: {error}
          </div>
        ) : canvasUrl ? (
          <iframe
            title="Brainstorm board"
            src={canvasUrl}
            style={{ width: "100%", height: "100%", border: "none", background: "#fff" }}
          />
        ) : (
          <div style={{ padding: 40, color: "#888" }}>Starting canvas…</div>
        )}
      </div>
    </div>
  );
};

const BrainstormBootstrap: React.FC<{ onReady: (m: ProjectMeta) => void }> = ({
  onReady,
}) => {
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      if (!isTauri()) return;
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        // Open only a BRAINSTORM project (board.json). The pool is shared with
        // kinetic/pulse, so we filter by canvas.
        const list = await invoke<ProjectMeta[]>("projects_list", {
          canvas: "brainstorm",
        }).catch(() => [] as ProjectMeta[]);
        const existing = Array.isArray(list) && list.length > 0 ? list[0] : null;
        const meta =
          existing ??
          (await invoke<ProjectMeta>("projects_create", {
            name: "Brainstorm Session",
            canvas: "brainstorm",
          }));
        await invoke("project_open", { path: meta.path }).catch(() => {});
        onReady(meta);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, [onReady]);
  if (err)
    return (
      <div style={{ padding: 40, color: "#e66" }}>
        Brainstorm failed to open a project: {err}
      </div>
    );
  return <div style={{ padding: 40, color: "#888" }}>Opening Brainstorm session…</div>;
};

export const BrainstormApp: React.FC<{ onExit: () => void }> = () => {
  const [project, setProject] = useState<ProjectMeta | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      setProject({ name: "Browser", path: "(browser)" });
      return;
    }
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

  if (!project) return <BrainstormBootstrap onReady={setProject} />;
  return <BrainstormEditor key={project.path} project={project} />;
};
