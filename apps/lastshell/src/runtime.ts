/**
 * Runtime feature detection. Tauri 2 exposes window.__TAURI_INTERNALS__ in the
 * webview; it's absent in plain browser dev (`npm run dev`).
 *
 * Use this wherever a code path needs a desktop-only capability (PTY, file
 * writes) so the same UI still renders in a browser tab for quick iteration.
 */
export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
