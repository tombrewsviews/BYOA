/**
 * Board persistence for Brainstorm Canvas.
 *
 * The canvas server holds the scene in memory only — it persists nothing. So
 * each board's full Excalidraw content (elements + embedded image files) is
 * saved to the project's `board.json` on disk, our "local db" for the board.
 * Reopening a board reads that file and pushes it back into the freshly-started
 * (empty) canvas server so the user sees their work restored.
 *
 *   save:    GET /api/elements + GET /api/files  ->  board.json
 *   restore: board.json  ->  POST /api/files (images first) + POST /api/elements/sync
 *
 * Disk I/O goes through the existing Tauri save_doc/load_doc commands, which
 * read/write the active project's doc file (board.json for a brainstorm
 * project). In the browser (no Tauri) persistence is a no-op.
 */

export interface BoardFile {
  id: string;
  dataURL: string;
  mimeType?: string;
  created?: number;
}

export interface BoardScene {
  /** Marker kept for canvas detection / forward-compat. */
  type: "excalidraw";
  version: 2;
  source: "brainstorm-canvas";
  elements: Array<Record<string, unknown>>;
  /** Embedded image blobs, keyed by fileId. */
  files: Record<string, BoardFile>;
  savedAt: number;
}

const emptyScene = (): BoardScene => ({
  type: "excalidraw",
  version: 2,
  source: "brainstorm-canvas",
  elements: [],
  files: {},
  savedAt: 0,
});

/** Read the current live scene from the canvas server. */
async function readLiveScene(canvasUrl: string): Promise<BoardScene | null> {
  try {
    const [er, fr] = await Promise.all([
      fetch(`${canvasUrl}/api/elements`),
      fetch(`${canvasUrl}/api/files`),
    ]);
    if (!er.ok) return null;
    const elements = ((await er.json()) as { elements?: Array<Record<string, unknown>> })
      .elements ?? [];
    const files = fr.ok
      ? ((await fr.json()) as { files?: Record<string, BoardFile> }).files ?? {}
      : {};
    return { ...emptyScene(), elements, files };
  } catch {
    return null;
  }
}

/**
 * Save the live scene to `board.json`. Called debounced on canvas activity.
 * Returns true if it wrote (false on no-op / failure). When `now` is provided
 * it stamps savedAt (Date is unavailable in some contexts; the caller has it).
 */
export async function saveBoard(canvasUrl: string, isTauriEnv: boolean): Promise<boolean> {
  if (!isTauriEnv) return false;
  const scene = await readLiveScene(canvasUrl);
  if (!scene) return false;
  scene.savedAt = Date.now();
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_doc", { json: JSON.stringify(scene, null, 2) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Restore a board's saved scene into the (empty) canvas server. Reads
 * board.json from disk, pushes files first (so element image refs resolve),
 * then syncs elements. No-op if there's nothing to restore.
 */
export async function restoreBoard(canvasUrl: string, isTauriEnv: boolean): Promise<void> {
  if (!isTauriEnv) return;
  let scene: BoardScene;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = await invoke<string>("load_doc");
    scene = JSON.parse(raw) as BoardScene;
  } catch {
    return; // no saved board (or unreadable) — leave the empty canvas
  }
  const elements = Array.isArray(scene.elements) ? scene.elements : [];
  const files = scene.files && typeof scene.files === "object" ? scene.files : {};
  if (elements.length === 0 && Object.keys(files).length === 0) return;

  try {
    const fileList = Object.values(files);
    if (fileList.length > 0) {
      await fetch(`${canvasUrl}/api/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: fileList }),
      });
    }
    await fetch(`${canvasUrl}/api/elements/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements, timestamp: Date.now() }),
    });
  } catch {
    /* canvas server unreachable — board stays empty this session */
  }
}

/** Element-changing broadcast types from the canvas server WebSocket. */
const CHANGE_TYPES = new Set([
  "element_created",
  "element_updated",
  "element_deleted",
  "elements_batch_created",
  "elements_synced",
  "canvas_cleared",
  "files_added",
  "file_deleted",
]);

/**
 * Autosave: subscribe to the canvas server WebSocket and debounce-save the
 * scene to board.json whenever it changes (the user's edits OR the agent's).
 * Returns a stop fn. No-op outside Tauri. Reconnects on socket close.
 */
export function startAutosave(
  canvasUrl: string,
  isTauriEnv: boolean,
  debounceMs = 1000,
): () => void {
  if (!isTauriEnv) return () => {};
  const wsUrl = canvasUrl.replace(/^http/, "ws");
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void saveBoard(canvasUrl, true);
    }, debounceMs);
  };

  const connect = () => {
    if (stopped) return;
    socket = new WebSocket(wsUrl);
    socket.onmessage = (ev) => {
      let type = "";
      try {
        type = (JSON.parse(ev.data as string) as { type?: string }).type ?? "";
      } catch {
        return;
      }
      if (CHANGE_TYPES.has(type)) schedule();
    };
    socket.onclose = () => {
      if (!stopped) setTimeout(connect, 1000);
    };
    socket.onerror = () => socket?.close();
  };
  connect();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    socket?.close();
    socket = null;
  };
}
