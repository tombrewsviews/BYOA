import React, { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "../../runtime";
import { Chat, type ChatHandle } from "../../agent-chat/Chat";
import { Terminal } from "../../terminal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Play } from "../../icons";
import { queryDocSchema, type QueryDoc, type DataSource } from "../../../src/data/schema";
import { ChartView } from "./Chart";

type ProjectMeta = { name: string; path: string; lastOpened?: string };
type ViewMode = "terminal" | "chat";
type ResultTab = "grid" | "chart";

type Column = { name: string; type: string };
type QueryResult = {
  columns: Column[];
  rows: Array<Array<string | number | boolean | null>>;
  rowCount: number;
  truncated: boolean;
};

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
        <h1 className="text-xl font-semibold text-foreground">Data sessions</h1>
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
  const [doc, setDoc] = useState<QueryDoc | null>(null);
  const [schema, setSchema] = useState<Array<{ id: string; columns: Column[] }>>([]);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("terminal");
  const [resultTab, setResultTab] = useState<ResultTab>("grid");
  const [agentId, setAgentId] = useState<"claude" | "codex" | "gemini">("claude");
  const chatHandleRef = useRef<ChatHandle | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load query.json on open.
  useEffect(() => {
    void (async () => {
      if (!isTauri()) return;
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        const raw = await invoke<string>("load_doc");
        setDoc(queryDocSchema.parse(JSON.parse(raw)));
        const settings = await invoke<{ default_agent?: string }>("get_settings").catch(() => ({}) as { default_agent?: string });
        const id = settings?.default_agent;
        if (id === "claude" || id === "codex" || id === "gemini") setAgentId(id);
      } catch (e) { setError(`Load failed: ${(e as Error).message}`); }
    })();
  }, [project.path]);

  // Re-register all sources into the engine on open / when sources change,
  // then refresh schema for the sidebar.
  useEffect(() => {
    if (!doc || !isTauri()) return;
    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      for (const s of doc.sources) {
        await invoke("data_open_source",
          { projectPath: project.path, path: s.path, kind: s.kind }).catch(() => {});
      }
      try {
        setSchema(await invoke("data_schema", { projectPath: project.path }));
      } catch { /* ignore */ }
    })();
  }, [doc?.sources, project.path]);

  // Debounced save of query.json.
  const persist = useCallback((next: QueryDoc) => {
    setDoc(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (!isTauri()) return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_doc", { json: JSON.stringify(next, null, 2) }).catch(() => {});
    }, 400);
  }, []);

  const activeCell = doc?.cells.find((c) => c.id === doc.activeCell) ?? doc?.cells[0];

  const setSql = (sql: string) => {
    if (!doc || !activeCell) return;
    persist({ ...doc, cells: doc.cells.map((c) => c.id === activeCell.id ? { ...c, sql } : c) });
  };

  const run = useCallback(async () => {
    if (!activeCell || !isTauri()) return;
    setError(null);
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      setResult(await invoke<QueryResult>("data_run_sql",
        { projectPath: project.path, sql: activeCell.sql }));
    } catch (e) { setError(String(e)); setResult(null); }
  }, [activeCell, project.path]);

  const addSource = useCallback(async () => {
    if (!doc || !isTauri()) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: false,
      filters: [{ name: "Data", extensions: ["csv", "parquet", "json"] }] });
    if (!picked || typeof picked !== "string") return;
    const ext = picked.split(".").pop()?.toLowerCase();
    const kind: DataSource["kind"] = ext === "parquet" ? "parquet" : ext === "json" ? "json" : "csv";
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("data_open_source", { projectPath: project.path, path: picked, kind });
    const stem = picked.split("/").pop()?.split(".")[0] ?? "src";
    const id = stem.replace(/[^a-zA-Z0-9]/g, "_").replace(/^(\d)/, "_$1");
    persist({ ...doc, sources: [...doc.sources, { id, path: picked, kind }] });
  }, [doc, project.path, persist]);

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

      {/* Right: data canvas */}
      <div className="flex flex-1 min-h-0">
        {/* Sources sidebar */}
        <div className="flex w-56 flex-none flex-col border-r border-border">
          <div className="flex items-center justify-between border-b border-border p-2">
            <span className="text-xs font-medium text-muted-foreground">Sources</span>
            <Button size="icon-sm" variant="secondary" onClick={addSource} title="Add source">
              <Plus className="size-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-auto p-2 text-xs">
            {schema.length === 0 ? (
              <div className="text-muted-foreground">No sources. Add a CSV/Parquet/JSON.</div>
            ) : schema.map((s) => (
              <div key={s.id} className="mb-2">
                <div className="font-medium text-foreground">{s.id}</div>
                {s.columns.map((c) => (
                  <button key={c.name}
                    className="block w-full truncate text-left text-muted-foreground hover:text-foreground"
                    onClick={() => activeCell && setSql(`${activeCell.sql}${c.name}`)}
                    title={`${c.name} · ${c.type}`}>
                    {c.name} <span className="opacity-50">{c.type}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Cell: SQL editor + result */}
        <div className="flex flex-1 min-h-0 flex-col">
          <div className="flex items-center gap-2 border-b border-border p-2">
            <span className="text-sm font-medium text-foreground">{activeCell?.title ?? "Query"}</span>
            <Button size="sm" className="ml-auto" onClick={run} title="Run (Cmd+Enter)">
              <Play className="size-3.5" />Run
            </Button>
          </div>
          <textarea
            className="flex-none resize-none border-b border-border bg-background p-2 font-mono text-sm text-foreground outline-none"
            rows={5}
            value={activeCell?.sql ?? ""}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void run(); } }}
            spellCheck={false}
          />
          {error ? <div className="flex-none px-2 py-1 text-xs text-destructive">{error}</div> : null}
          <div className="flex flex-none items-center gap-1 border-b border-border px-2 py-1">
            <Button size="sm" variant={resultTab === "grid" ? "default" : "secondary"}
              onClick={() => setResultTab("grid")}>Grid</Button>
            <Button size="sm" variant={resultTab === "chart" ? "default" : "secondary"}
              onClick={() => setResultTab("chart")}>Chart</Button>
            {result?.truncated ? (
              <span className="ml-auto text-xs text-muted-foreground">showing first {result.rowCount} rows</span>
            ) : null}
          </div>
          <div className="flex-1 overflow-auto p-2">
            {!result ? (
              <div className="text-sm text-muted-foreground">Run a query to see results.</div>
            ) : resultTab === "grid" ? (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr>{result.columns.map((c) => (
                    <th key={c.name} className="border-b border-border px-2 py-1 font-medium text-foreground">{c.name}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i}>{row.map((cell, j) => (
                      <td key={j} className="border-b border-border/40 px-2 py-1 text-muted-foreground">{String(cell ?? "")}</td>
                    ))}</tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <ChartView viz={activeCell?.viz ?? { type: "table", x: null, y: null, color: null }}
                columns={result.columns.map((c) => c.name)} rows={result.rows} />
            )}
          </div>
        </div>
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
