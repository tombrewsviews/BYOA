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
 * Exposed for App.tsx so the merge-conflict flow can paste a prompt
 * into the live terminal. Single-pty-at-a-time, so a module mutable
 * is fine; refactor when multi-tab terminals arrive.
 */
let _activePtyId: string | null = null;
export const getActivePtyId = (): string | null => _activePtyId;

export const Terminal: React.FC = () => {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
      // Async wiring; ignore the returned promise (cleanup uses cleanupFns).
      void (async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        const { listen } = await import("@tauri-apps/api/event");

        let sessionId: string;
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

        cleanupFns.push(
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
