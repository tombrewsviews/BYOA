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
export const focusActiveTerminal = (): void => {
  _activeTerm?.focus();
};

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
      theme: {
        background: "#0a0a10",
        foreground: "#e4e4ee",
        cursor: "#facc15",
        selectionBackground: "#7c5cff66",
      },
      cursorBlink: true,
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(hostRef.current);
    _activeTerm = term;
    // NOTE: xterm-addon-canvas was previously loaded here for perf, but
    // its dispose() crashes ("undefined is not an object" on
    // _renderer.value.onRequestRedraw) whenever this Terminal unmounts —
    // which happens every project switch (key={project.path} in App.tsx)
    // and every dev StrictMode mount cycle. The DOM renderer is fast
    // enough for a one-column terminal in this app.
    fit.fit();

    const cleanupFns: Array<() => void | Promise<void>> = [];

    const onWinResize = () => fit.fit();
    window.addEventListener("resize", onWinResize);
    cleanupFns.push(() => window.removeEventListener("resize", onWinResize));

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
      term.dispose();
    };
  }, []);

  return (
    <div
      data-terminal-root
      ref={hostRef}
      style={{
        width: "100%",
        height: "100%",
        background: "#0a0a10",
        padding: 6,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    />
  );
};

export const Terminal = React.memo(TerminalInner);
Terminal.displayName = "Terminal";
