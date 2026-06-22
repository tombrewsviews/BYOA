import React, { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "../../runtime";
import { Chat, type ChatHandle } from "../../agent-chat/Chat";
import { Terminal } from "../../terminal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "../../icons";
import { migrateToV2, type GraphDoc } from "../../../src/data/schema";
import { GraphCanvas } from "./GraphCanvas";
import type { NodeResult } from "./nodeTypes";

type ProjectMeta = { name: string; path: string; lastOpened?: string };
type ViewMode = "terminal" | "chat";

type EvaluateReport = { nodes: Record<string, NodeResult> };

const agentLabelFor = (id: string): string =>
  id === "codex" ? "Codex" : id === "gemini" ? "Gemini" : "Claude";

const SessionsList: React.FC<{ onOpen: (m: ProjectMeta) => void }> = ({ onOpen }) => {
  const [items, setItems] = useState<ProjectMeta[]>([]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!isTauri()) return setItems([]);
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      setItems(await invoke<ProjectMeta[]>("projects_list", { canvas: "data" }));
    } catch (e) {
      setError(`Failed to list: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const open = useCallback(async (meta: ProjectMeta) => {
    if (!isTauri()) return onOpen(meta);
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("project_open", { path: meta.path });
      onOpen(meta);
    } catch (e) { setError(`Open failed: ${(e as Error).message}`); }
  }, [onOpen]);

  const create = useCallback(async () => {
    if (!isTauri()) return;
    setBusy(true);
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const meta = await invoke<ProjectMeta>("projects_create", {
        name: newName.trim() || "Data Session", canvas: "data",
      });
      setNewName("");
      await open(meta);
    } catch (e) { setError(`Create failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }, [newName, open]);

  const remove = useCallback(async (path: string) => {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    try { await invoke("project_delete", { path }); await refresh(); }
    catch (e) { setError(`Delete failed: ${(e as Error).message}`); }
  }, [refresh]);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 p-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Lens sessions</h1>
        <p className="text-sm text-muted-foreground">
          Open a session to explore data with the agent, or start a new one.
        </p>
      </div>
      <div className="flex gap-2">
        <Input value={newName} onChange={(e) => setNewName(e.target.value)}
          placeholder="New session name…"
          onKeyDown={(e) => { if (e.key === "Enter") void create(); }} />
        <Button onClick={create} disabled={busy}><Plus className="size-4" />New session</Button>
      </div>
      {error ? <div className="text-sm text-destructive">{error}</div> : null}
      <div className="flex flex-1 flex-col gap-2 overflow-auto">
        {items.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No sessions yet. Create your first one above.
          </div>
        ) : items.map((b) => (
          <div key={b.path}
            className="group flex items-center justify-between rounded-lg border border-border bg-card p-3 hover:bg-accent">
            <button className="flex-1 text-left" onClick={() => void open(b)} title="Open">
              <div className="text-sm font-medium text-foreground">{b.name}</div>
              <div className="text-xs text-muted-foreground">{b.path}</div>
            </button>
            <Button variant="ghost" size="icon-sm" onClick={() => void remove(b.path)}
              title="Delete" className="opacity-0 group-hover:opacity-100">
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};

const DataEditor: React.FC<{ project: ProjectMeta }> = ({ project }) => {
  const [doc, setDoc] = useState<GraphDoc | null>(null);
  const [results, setResults] = useState<Record<string, NodeResult>>({});
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("terminal");
  const [agentId, setAgentId] = useState<"claude" | "codex" | "gemini">("claude");
  const chatHandleRef = useRef<ChatHandle | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Evaluate the whole graph and store per-node results for the card previews.
  const evaluate = useCallback(async (g: GraphDoc) => {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const report = await invoke<EvaluateReport>("data_evaluate", {
        projectPath: project.path, graphJson: JSON.stringify(g),
      });
      setResults(report.nodes ?? {});
    } catch (e) { setError(`Evaluate failed: ${(e as Error).message}`); }
  }, [project.path]);

  // Load query.json on open, then evaluate once.
  useEffect(() => {
    void (async () => {
      if (!isTauri()) return;
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        const raw = await invoke<string>("load_doc");
        const loaded = migrateToV2(JSON.parse(raw));
        setDoc(loaded);
        const settings = await invoke<{ default_agent?: string }>("get_settings").catch(() => ({}) as { default_agent?: string });
        const id = settings?.default_agent;
        if (id === "claude" || id === "codex" || id === "gemini") setAgentId(id);
        await evaluate(loaded);
      } catch (e) { setError(`Load failed: ${(e as Error).message}`); }
    })();
  }, [project.path, evaluate]);

  // Debounced save of query.json.
  const persist = useCallback((next: GraphDoc) => {
    setDoc(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (!isTauri()) return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_doc", { json: JSON.stringify(next, null, 2) }).catch(() => {});
    }, 400);
  }, []);

  // Non-structural change (e.g. dragging a node): save, but don't re-evaluate.
  const onDocChange = useCallback((next: GraphDoc) => { persist(next); }, [persist]);

  // Structural change (add node / add edge): save and re-evaluate.
  const onStructuralChange = useCallback((next: GraphDoc) => {
    persist(next);
    void evaluate(next);
  }, [persist, evaluate]);

  return (
    <div className="flex h-full min-h-0">
      {/* Left: agent panel */}
      <div className="flex w-[380px] flex-none flex-col border-r border-border">
        <div className="flex flex-none items-center gap-1 border-b border-border px-2 py-1">
          <Button size="sm" variant={viewMode === "terminal" ? "default" : "secondary"}
            onClick={() => setViewMode("terminal")}>Terminal</Button>
          <Button size="sm" variant={viewMode === "chat" ? "default" : "secondary"}
            onClick={() => setViewMode("chat")}>{`Chat · ${agentLabelFor(agentId)}`}</Button>
        </div>
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, display: viewMode === "terminal" ? "block" : "none" }}>
            <Terminal />
          </div>
          <div style={{ position: "absolute", inset: 0, display: viewMode === "chat" ? "block" : "none" }}>
            <Chat agentId={agentId} agentLabel={agentLabelFor(agentId)} cwd={project.path}
              onSwitchToTerminal={() => setViewMode("terminal")}
              onReady={(h) => { chatHandleRef.current = h; }} />
          </div>
        </div>
      </div>

      {/* Center: node-graph canvas */}
      <div className="flex flex-1 min-h-0 flex-col">
        {error ? <div className="flex-none px-2 py-1 text-xs text-destructive">{error}</div> : null}
        {doc ? (
          <GraphCanvas
            doc={doc}
            results={results}
            onDocChange={onDocChange}
            onStructuralChange={onStructuralChange}
          />
        ) : (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        )}
      </div>

      {/* Right: inspector (Task 6) */}
      <div className="w-72 flex-none border-l border-border p-3 text-sm text-muted-foreground">
        Inspector (Task 6)
      </div>
    </div>
  );
};

export const DataApp: React.FC<{ onExit: () => void }> = () => {
  const [project, setProject] = useState<ProjectMeta | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const un = await listen<ProjectMeta>("project://opened", (e) => setProject(e.payload));
      off = () => un();
    })();
    return () => { if (off) off(); };
  }, []);
  if (!project) return <SessionsList onOpen={setProject} />;
  return <DataEditor key={project.path} project={project} />;
};
