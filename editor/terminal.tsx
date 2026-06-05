/**
 * Embedded terminal.
 *
 * Desktop (Tauri): xterm.js <-> Rust pty commands. pty_open returns a
 * session id; pty://{id}/data events stream stdout back; keystrokes go
 * out via pty_write; resize via pty_resize; pty_close on unmount.
 *
 * Browser (npm run editor): the terminal is disabled — we print a single
 * line of instructions so the user knows where to find it. The browser
 * mode is preserved for fast UI iteration; production use is the
 * desktop app.
 */
import React, { useEffect, useRef } from "react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import "xterm/css/xterm.css";
import { isTauri } from "./runtime";
import { terminalThemeFromTokens } from "./design-language/terminal-bridge";
import type { TokenMap } from "./design-language/types";

/**
 * Hide xterm's native viewport scrollbar — it renders as a bright white bar
 * over the dark UI. We only hide the visual track; scrolling via wheel and
 * keys still works. Injected once, globally scoped to the terminal root so it
 * never touches other scrollable panels.
 */
const SCROLLBAR_STYLE_ID = "kinetic-terminal-scrollbar-style";
const ensureScrollbarStyle = (): void => {
  if (typeof document === "undefined") return;
  if (document.getElementById(SCROLLBAR_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = SCROLLBAR_STYLE_ID;
  el.textContent = `
[data-terminal-root] .xterm-viewport { scrollbar-width: none; }
[data-terminal-root] .xterm-viewport::-webkit-scrollbar { width: 0; height: 0; }
`;
  document.head.appendChild(el);
};

/**
 * Exposed for App.tsx so the merge-conflict flow can paste a prompt
 * into the live terminal. Single-pty-at-a-time, so a module mutable
 * is fine; refactor when multi-tab terminals arrive.
 */
let _activePtyId: string | null = null;
export const getActivePtyId = (): string | null => _activePtyId;

/** The mounted xterm instance, exposed so shell-level code can focus
 *  it programmatically (e.g. after the user copies a prompt from the
 *  Library). Set by the Terminal component on mount, cleared on
 *  unmount. */
let _activeTerm: XTerm | null = null;
let _activeFit: FitAddon | null = null;
export const focusActiveTerminal = (): void => {
  _activeTerm?.focus();
};

/** Push resolved design tokens into the live terminal (colors + font-size).
 *  No-op if no terminal is mounted. Re-fits only when font-size changed. */
export function applyToTerminal(map: TokenMap): void {
  const term = _activeTerm;
  if (!term) return;
  const { theme, fontSize } = terminalThemeFromTokens(map);
  term.options.theme = theme;
  if (term.options.fontSize !== fontSize) {
    term.options.fontSize = fontSize;
    _activeFit?.fit();
  }
}

// React.memo: Terminal has no props, so it should NEVER re-render once
// mounted. Without memo, every parent `setStory` (triggered by Player
// frameupdate or watcher reload) walks Terminal's subtree even though
// the xterm instance is stable inside a useEffect. Trivial guard, big
// win at high typing rates.
const TerminalInner: React.FC = () => {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ensureScrollbarStyle();
    if (!hostRef.current) return;

    const term = new XTerm({
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 12,
      // xterm's colors are a JS API, not CSS — these hex values mirror the
      // design tokens (background ≈ --background, foreground ≈ --foreground).
      // Selection uses a translucent grey instead of the old purple to match
      // the no-purple grey system; the cursor keeps its amber for visibility.
      theme: {
        background: "#0a0a0a",
        foreground: "#fafafa",
        cursor: "#facc15",
        selectionBackground: "#ffffff33",
      },
      cursorBlink: true,
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(hostRef.current);
    _activeTerm = term;
    _activeFit = fit;
    // NOTE: xterm-addon-canvas was previously loaded here for perf, but
    // its dispose() crashes ("undefined is not an object" on
    // _renderer.value.onRequestRedraw) whenever this Terminal unmounts —
    // which happens every project switch (key={project.path} in App.tsx)
    // and every dev StrictMode mount cycle. The DOM renderer is fast
    // enough for a one-column terminal in this app.
    fit.fit();

    const cleanupFns: Array<() => void | Promise<void>> = [];

    // Re-fit on ANY size change of the host element, not just window
    // resize. The terminal column is resized by dragging the column
    // divider, which updates a CSS custom property (--col-terminal) — that
    // does NOT fire a window 'resize' event, so without this the xterm grid
    // keeps its mount-time column count and content gets clipped when the
    // panel narrows. A ResizeObserver catches column drags, panel show/
    // hide, and window resizes alike. fit() throws on a zero-size element
    // (e.g. the terminal hidden behind a display:none Chat view), so skip
    // those; the next observable resize when it becomes visible re-fits.
    const refit = () => {
      const el = hostRef.current;
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        // transient layout state — ignore; a later resize re-fits
      }
    };
    const ro = new ResizeObserver(refit);
    ro.observe(hostRef.current);
    cleanupFns.push(() => ro.disconnect());

    if (!isTauri()) {
      term.writeln(
        "[terminal requires desktop app — run `npm run tauri:dev`]",
      );
    } else {
      // Captured by the async wiring below and read by the drag-drop
      // handler, which is registered after the pty opens. Null until then.
      let sessionId: string | null = null;

      // Async wiring; ignore the returned promise (cleanup uses cleanupFns).
      void (async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        const { listen } = await import("@tauri-apps/api/event");

        try {
          sessionId = await invoke<string>("pty_open", {
            cols: term.cols,
            rows: term.rows,
          });
          _activePtyId = sessionId;
        } catch (e) {
          term.writeln(`\r\n[pty_open failed: ${(e as Error).message ?? e}]`);
          return;
        }

        const unlistenData = await listen<string>(
          `pty://${sessionId}/data`,
          (e) => term.write(e.payload),
        );
        const unlistenClosed = await listen<null>(
          `pty://${sessionId}/closed`,
          () => term.writeln("\r\n[shell exited]"),
        );

        const dataDisp = term.onData((data) => {
          void invoke("pty_write", { id: sessionId, data });
        });
        const resizeDisp = term.onResize(({ cols, rows }) => {
          void invoke("pty_resize", { id: sessionId, cols, rows });
        });

        // Drag-drop: dropping files onto the terminal types their paths at
        // the cursor (single-quoted, space-separated), like macOS Terminal.
        // No newline — the user finishes the command.
        //
        // onDragDropEvent is webview-GLOBAL, not element-scoped: a drop
        // anywhere in the window fires this. The Terminal stays mounted
        // (display:none) even in Chat view, where Chat's Composer has its
        // own drop listener. So we gate on actual visibility — an element
        // under a display:none ancestor has a null offsetParent — to avoid
        // both handlers firing on the same drop.
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const unlistenDrop = await getCurrentWebview().onDragDropEvent(
          (event) => {
            const payload = event.payload as {
              type: string;
              paths?: string[];
            };
            if (payload.type !== "drop") return;
            if (!sessionId) return;
            if (!hostRef.current || hostRef.current.offsetParent === null) {
              return; // terminal not the visible view — let Chat handle it
            }
            const paths = payload.paths ?? [];
            if (!paths.length) return;
            // Single-quote each path; a literal ' inside a path becomes the
            // POSIX-safe '\'' sequence. Trailing space separates multiple.
            const quoted = paths
              .map((p) => `'${p.replace(/'/g, "'\\''")}'`)
              .join(" ");
            void invoke("pty_write", { id: sessionId, data: quoted });
          },
        );

        cleanupFns.push(
          () => unlistenDrop(),
          () => unlistenData(),
          () => unlistenClosed(),
          () => dataDisp.dispose(),
          () => resizeDisp.dispose(),
          async () => {
            try {
              await invoke("pty_close", { id: sessionId });
            } catch {
              // already gone — ignore
            }
            if (_activePtyId === sessionId) _activePtyId = null;
          },
        );
      })();
    }

    return () => {
      for (const fn of cleanupFns) {
        try {
          void fn();
        } catch {
          // ignore
        }
      }
      if (_activeTerm === term) _activeTerm = null;
      _activeFit = null;
      term.dispose();
    };
  }, []);

  return (
    <div
      data-terminal-root
      ref={hostRef}
      className="box-border h-full w-full overflow-hidden bg-background p-1.5"
    />
  );
};

export const Terminal = React.memo(TerminalInner);
Terminal.displayName = "Terminal";
