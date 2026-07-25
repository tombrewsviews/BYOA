/**
 * Runtime feature detection. Tauri 2 exposes window.__TAURI_INTERNALS__ in
 * the webview; absent in plain browser dev (`npm run editor`).
 *
 * Use this whenever a code path needs a desktop-only capability (PTY,
 * direct filesystem write) so the same UI still works in a browser tab
 * for quick visual debugging.
 */
export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
