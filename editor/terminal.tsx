/**
 * Embedded terminal. xterm.js in the browser <-> node-pty in the Vite
 * dev-server plugin, bridged by a WebSocket on /__terminal.
 *
 * Spawns a plain shell. Type `claude` to start the Claude Code CLI; its
 * OAuth login URL is clickable (web-links addon).
 */
import React, { useEffect, useRef } from "react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import "xterm/css/xterm.css";

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

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${window.location.host}/__terminal`,
    );

    ws.onopen = () => {
      const send = () => {
        try {
          ws.send(
            JSON.stringify({
              kind: "resize",
              cols: term.cols,
              rows: term.rows,
            }),
          );
        } catch {
          // ignore
        }
      };
      send();
      term.onResize(send);
    };
    ws.onmessage = (ev) => {
      // ev.data is string or Blob
      if (typeof ev.data === "string") term.write(ev.data);
      else (ev.data as Blob).text().then((s) => term.write(s));
    };
    ws.onclose = () =>
      term.writeln("\r\n[terminal disconnected — reload to reconnect]");
    ws.onerror = () => {
      // onclose will fire after; nothing extra needed.
    };

    const disp = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    const onWinResize = () => {
      fit.fit();
    };
    window.addEventListener("resize", onWinResize);

    return () => {
      window.removeEventListener("resize", onWinResize);
      disp.dispose();
      try {
        ws.close();
      } catch {
        // ignore
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
