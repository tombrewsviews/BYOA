/**
 * Export / import a board as a standard `.excalidraw` file.
 *
 * Export lets a board leave the app: upload the file to excalidraw.com to view
 * it or share it with people who don't have this app. Import brings one back,
 * into the current board or a new one.
 *
 * Export reads the LIVE scene from the canvas server rather than `board.json`
 * — the file on disk lags by up to the autosave debounce, and exporting what
 * the user is actually looking at is the least surprising behaviour.
 *
 * Import reuses the same push the restore path uses (files first, so element
 * image refs resolve, then an element sync that clears before writing).
 */

export interface PortableScene {
  elements: Array<Record<string, unknown>>;
  files: Record<string, unknown>;
}

/** Board name -> a safe default filename stem for the save dialog. */
export const slugify = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "board";

/** Read the live scene from the canvas server. */
export async function readLiveScene(canvasUrl: string): Promise<PortableScene> {
  const [er, fr] = await Promise.all([
    fetch(`${canvasUrl}/api/elements`),
    fetch(`${canvasUrl}/api/files`),
  ]);
  if (!er.ok) throw new Error("could not read the board from the canvas server");
  const elements =
    ((await er.json()) as { elements?: Array<Record<string, unknown>> }).elements ?? [];
  const files = fr.ok
    ? ((await fr.json()) as { files?: Record<string, unknown> }).files ?? {}
    : {};
  return { elements, files };
}

/**
 * Push a scene into the canvas server, replacing whatever is there.
 * `/api/elements/sync` clears before writing, so this is a genuine replace.
 */
export async function pushScene(canvasUrl: string, scene: PortableScene): Promise<void> {
  const fileList = Object.values(scene.files ?? {});
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
    body: JSON.stringify({ elements: scene.elements, timestamp: Date.now() }),
  });
}

/**
 * Export the live board to a `.excalidraw` file the user picks.
 * Returns the path written, or null if they cancelled the save dialog.
 */
export async function exportBoardToFile(
  canvasUrl: string,
  defaultStem: string,
): Promise<string | null> {
  const scene = await readLiveScene(canvasUrl);
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({
    defaultPath: `${defaultStem}.excalidraw`,
    filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
  });
  if (!path) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("board_export_file", {
    path,
    elements: scene.elements,
    files: scene.files,
    background: null,
  });
  return path;
}

/**
 * Let the user pick a `.excalidraw` file and read it. Returns null if they
 * cancelled. Throws with a human-readable reason if the file isn't a scene —
 * validation happens in Rust so a bad file never reaches the canvas.
 */
export async function pickAndReadScene(): Promise<PortableScene | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    multiple: false,
    filters: [{ name: "Excalidraw", extensions: ["excalidraw", "json"] }],
  });
  const path = Array.isArray(picked) ? picked[0] : picked;
  if (!path) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<PortableScene>("board_import_file", { path });
}
