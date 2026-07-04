import React, { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "../../runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Download, ArrowLeft } from "../../icons";
import { FormPanel } from "./FormPanel";
import { Preview } from "./Preview";
import { buildFilledPdf } from "./export";
import { defaultDoc, exportFilename, parseDoc, type RemitDoc } from "./schema";
import whitePdfUrl from "./assets/remit-template-white.pdf?url";
import signaturePngUrl from "./assets/signature.png?url";

type ProjectMeta = { name: string; path: string; lastOpened?: string };

const SessionsList: React.FC<{ onOpen: (m: ProjectMeta) => void }> = ({ onOpen }) => {
  const [items, setItems] = useState<ProjectMeta[]>([]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!isTauri()) return setItems([]);
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      setItems(await invoke<ProjectMeta[]>("projects_list", { canvas: "remit" }));
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
        name: newName.trim() || "Transfer", canvas: "remit",
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
        <h1 className="text-xl font-semibold text-foreground">Remit transfers</h1>
        <p className="text-sm text-muted-foreground">
          Open a saved transfer, or start a new bank-transfer form.
        </p>
      </div>
      <div className="flex gap-2">
        <Input value={newName} onChange={(e) => setNewName(e.target.value)}
          placeholder="New transfer name…"
          onKeyDown={(e) => { if (e.key === "Enter") void create(); }} />
        <Button onClick={create} disabled={busy}><Plus className="size-4" />New transfer</Button>
      </div>
      {error ? <div className="text-sm text-destructive">{error}</div> : null}
      <div className="flex flex-1 flex-col gap-2 overflow-auto">
        {items.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No transfers yet. Create your first one above.
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

const RemitEditor: React.FC<{ project: ProjectMeta; onBack: () => void }> = ({
  project,
  onBack,
}) => {
  const [doc, setDoc] = useState<RemitDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load remit.json on open.
  useEffect(() => {
    void (async () => {
      if (!isTauri()) return setDoc(defaultDoc());
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        const raw = await invoke<string>("load_doc");
        setDoc(parseDoc(raw));
      } catch (e) { setError(`Load failed: ${(e as Error).message}`); }
    })();
  }, [project.path]);

  // Debounced save.
  const persist = useCallback((next: RemitDoc) => {
    setDoc(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (!isTauri()) return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_doc", { json: JSON.stringify(next, null, 2) }).catch(() => {});
    }, 400);
  }, []);

  const update = useCallback(
    (patch: (d: RemitDoc) => RemitDoc) => {
      setDoc((prev) => {
        if (!prev) return prev;
        const next = patch(prev);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const exportPdf = useCallback(async () => {
    if (!doc) return;
    setStatus(null);
    setError(null);
    const filename = exportFilename(doc);

    // Non-Tauri (browser dev): download directly, no folder picker available.
    if (!isTauri()) {
      setExporting(true);
      try {
        const [tpl, sig] = await Promise.all([
          fetch(whitePdfUrl).then((r) => r.arrayBuffer()),
          fetch(signaturePngUrl).then((r) => r.arrayBuffer()),
        ]);
        const bytes = await buildFilledPdf(doc, tpl, sig);
        const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        setStatus(`Downloaded ${filename}`);
      } catch (e) {
        setError(`Export failed: ${(e as Error).message}`);
      } finally {
        setExporting(false);
      }
      return;
    }

    // Tauri: ask where to save (folder picker), then write there and reveal.
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await open({
        directory: true,
        multiple: false,
        title: "Choose a folder to save the transfer PDF",
      });
      if (typeof dir !== "string") return; // cancelled
      setExporting(true);
      const [tpl, sig] = await Promise.all([
        fetch(whitePdfUrl).then((r) => r.arrayBuffer()),
        fetch(signaturePngUrl).then((r) => r.arrayBuffer()),
      ]);
      const bytes = await buildFilledPdf(doc, tpl, sig);
      const { invoke } = await import("@tauri-apps/api/core");
      const path = await invoke<string>("remit_export", {
        dir,
        filename,
        bytes: Array.from(bytes),
      });
      setStatus(`Saved to ${path}`);
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }, [doc]);

  if (!doc) {
    return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Left: form panel */}
      <div className="flex w-[420px] flex-none flex-col border-r border-border">
        <div className="flex flex-none items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="flex min-w-0 items-center gap-1">
            <Button size="icon-sm" variant="ghost" onClick={onBack} title="Back to transfers">
              <ArrowLeft className="size-4" />
            </Button>
            <div className="truncate text-sm font-medium text-foreground">{project.name}</div>
          </div>
          <Button size="sm" onClick={exportPdf} disabled={exporting}>
            <Download className="size-4" />
            {exporting ? "Exporting…" : "Export PDF"}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <FormPanel doc={doc} onChange={update} />
        </div>
        {error ? (
          <div className="flex-none border-t border-border px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : status ? (
          <div className="flex-none border-t border-border px-3 py-2 text-xs text-muted-foreground">
            {status}
          </div>
        ) : null}
      </div>

      {/* Center: live PDF preview */}
      <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-6">
        <Preview doc={doc} />
      </div>
    </div>
  );
};

export const RemitApp: React.FC<{ onExit: () => void }> = () => {
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

  const back = useCallback(async () => {
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("project_close").catch(() => {});
    }
    setProject(null);
  }, []);

  if (!project) return <SessionsList onOpen={setProject} />;
  return <RemitEditor key={project.path} project={project} onBack={back} />;
};
