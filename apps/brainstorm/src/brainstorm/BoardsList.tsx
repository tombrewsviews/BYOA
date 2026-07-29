/**
 * Boards list — the entry screen. The user picks or creates a board here;
 * opening one is the ONLY way into the board/agent view.
 *
 * Each row's 3-dot menu renames or deletes the board. A rename only rewrites
 * the board's `board-name.txt` (the folder never moves), and a delete moves the
 * folder to the Trash, so both are recoverable.
 */
import React, { useCallback, useEffect, useState } from "react";
import { isTauri } from "../runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Pencil, Plus, Trash2, Upload } from "../icons";
import { pickAndReadScene } from "./portable";

export type ProjectMeta = { name: string; path: string; lastOpened?: string };

export const BoardsList: React.FC<{ onOpen: (m: ProjectMeta) => void }> = ({
  onOpen,
}) => {
  const [boards, setBoards] = useState<ProjectMeta[]>([]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Modal targets. Both dialogs stay mounted with a nullable target so closing
  // one doesn't unmount it mid-transition.
  const [renaming, setRenaming] = useState<ProjectMeta | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<ProjectMeta | null>(null);

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

  /**
   * Import a `.excalidraw` file as a NEW board — never into an existing one, so
   * an import can't destroy work.
   *
   * The scene is written to the new board's board.json directly (via save_doc,
   * after project_open makes it the active project) rather than pushed to the
   * canvas server: the board isn't open yet, and opening it runs restoreBoard,
   * which loads board.json into the canvas. So writing the file IS the import.
   */
  const importBoard = useCallback(async () => {
    if (!isTauri()) return;
    setError(null);
    let scene;
    try {
      scene = await pickAndReadScene();
    } catch (e) {
      setError(`Import failed: ${(e as Error).message}`);
      return;
    }
    if (!scene) return; // cancelled the file picker

    setBusy(true);
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const meta = await invoke<ProjectMeta>("projects_create", {
        name: newName.trim() || "Imported board",
        canvas: "brainstorm",
      });
      await invoke("project_open", { path: meta.path });
      await invoke("save_doc", {
        json: JSON.stringify({
          type: "excalidraw",
          version: 2,
          source: "brainstorm-canvas",
          elements: scene.elements,
          files: scene.files,
          savedAt: Date.now(),
        }),
      });
      setNewName("");
      onOpen(meta);
    } catch (e) {
      setError(`Import failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [newName, onOpen]);

  const confirmRename = useCallback(async () => {
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name) return;
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("project_rename", { path: renaming.path, name });
      setRenaming(null);
      await refresh();
    } catch (e) {
      setError(`Rename failed: ${(e as Error).message}`);
      setRenaming(null);
    }
  }, [renaming, renameValue, refresh]);

  const confirmDelete = useCallback(async () => {
    if (!deleting) return;
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("project_delete", { path: deleting.path });
      setDeleting(null);
      await refresh();
    } catch (e) {
      setError(`Delete failed: ${(e as Error).message}`);
      setDeleting(null);
    }
  }, [deleting, refresh]);

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
        <Button
          variant="secondary"
          onClick={importBoard}
          disabled={busy}
          title="Import an .excalidraw file as a new board"
        >
          <Upload className="size-4" />
          Import
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
                <div className="truncate text-sm font-medium text-foreground">
                  {b.name}
                </div>
                <div className="truncate text-xs text-muted-foreground">{b.path}</div>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Board options"
                    aria-label={`Options for ${b.name}`}
                    className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onSelect={() => {
                      setRenameValue(b.name);
                      setRenaming(b);
                    }}
                  >
                    <Pencil />
                    Rename…
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(b)}>
                    <Trash2 />
                    Delete…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))
        )}
      </div>

      <Dialog open={renaming !== null} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename board</DialogTitle>
            <DialogDescription>
              This changes the board's name only — its files stay where they are.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            autoFocus
            placeholder="Board name"
            aria-label="Board name"
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void confirmRename();
            }}
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button onClick={confirmRename} disabled={!renameValue.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete board?</DialogTitle>
            <DialogDescription>
              “{deleting?.name}” will be moved to the Trash. You can restore it from
              there.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete board
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
