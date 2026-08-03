/**
 * Embedded terminal — the agent's seat at the table.
 *
 * Desktop (Tauri): xterm.js <-> Rust pty commands. `pty_open` returns a session
 * id; `pty://{id}/data` events stream stdout back; keystrokes go out via
 * `pty_write`; resize via `pty_resize`; `pty_close` on unmount. The PTY spawns
 * the agent CLI in the table's project dir, so it picks up CLAUDE.md and the
 * installed skill automatically.
 *
 * Browser (`npm run dev`): the terminal is disabled — we print a line saying so.
 * Browser mode exists for fast UI iteration; real play is the desktop app.
 */
import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import { isTauri } from './runtime';

/** Hide xterm's bright native scrollbar; wheel/keys still scroll. */
const SCROLLBAR_STYLE_ID = 'lastshell-terminal-scrollbar';
function ensureScrollbarStyle(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(SCROLLBAR_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = SCROLLBAR_STYLE_ID;
  el.textContent = `
[data-terminal-root] .xterm-viewport { scrollbar-width: none; }
[data-terminal-root] .xterm-viewport::-webkit-scrollbar { width: 0; height: 0; }
`;
  document.head.appendChild(el);
}

/** Matches the felt/brass palette in styles.css. */
const THEME = {
  background: '#0d1d16',
  foreground: '#f2e9d8',
  cursor: '#c9a227',
  cursorAccent: '#0d1d16',
  selectionBackground: 'rgba(201,162,39,0.35)',
  black: '#0d1d16',
  red: '#e23b3b',
  green: '#4caf7d',
  yellow: '#c9a227',
  blue: '#3b82f6',
  magenta: '#b57edc',
  cyan: '#5bc8c8',
  white: '#f2e9d8',
  brightBlack: '#5a6b62',
  brightRed: '#f58a8a',
  brightGreen: '#7fd9a8',
  brightYellow: '#ecd07a',
  brightBlue: '#8fb4fa',
  brightMagenta: '#d3aef0',
  brightCyan: '#9fe3e3',
  brightWhite: '#ffffff',
};

let activeTerm: XTerm | null = null;
export const focusActiveTerminal = (): void => activeTerm?.focus();

export function Terminal({
  project,
  agent,
  kickoff,
}: {
  project: string | null;
  /** which CLI to launch (id from detect_agents) */
  agent?: string;
  /** opening prompt, so the agent starts playing without being asked */
  kickoff?: string | null;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    ensureScrollbarStyle();

    const term = new XTerm({
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      lineHeight: 1.25,
      cursorBlink: true,
      theme: THEME,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);
    activeTerm = term;
    try {
      fit.fit();
    } catch {
      /* host not laid out yet — the observer below refits */
    }

    let disposed = false;
    let sessionId: string | null = null;
    let unlisten: (() => void) | null = null;

    if (!isTauri()) {
      term.writeln('\x1b[33mTerminal needs the desktop app.\x1b[0m');
      term.writeln('');
      term.writeln('Run \x1b[1mnpm run tauri:dev\x1b[0m to play with a live agent.');
      term.writeln('In the browser the game works, but no agent can be seated.');
    } else if (!project) {
      term.writeln('\x1b[90mNo table open yet.\x1b[0m');
    } else {
      void (async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        const { listen } = await import('@tauri-apps/api/event');
        try {
          sessionId = await invoke<string>('pty_open', {
            cols: term.cols,
            rows: term.rows,
            project,
            agent: agent ?? 'claude',
            kickoff: kickoff ?? null,
          });
        } catch (e) {
          term.writeln(`\r\n\x1b[31m[pty_open failed: ${(e as Error).message ?? e}]\x1b[0m`);
          return;
        }
        if (disposed) {
          void invoke('pty_close', { id: sessionId });
          return;
        }
        unlisten = await listen<string>(`pty://${sessionId}/data`, (ev) => {
          term.write(ev.payload);
        });
        term.onData((data) => {
          void invoke('pty_write', { id: sessionId, data });
        });
        term.onResize(({ cols, rows }) => {
          void invoke('pty_resize', { id: sessionId, cols, rows });
        });
      })();
    }

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* mid-layout; next tick refits */
      }
    });
    ro.observe(host);

    return () => {
      disposed = true;
      ro.disconnect();
      unlisten?.();
      if (sessionId) {
        const id = sessionId;
        void import('@tauri-apps/api/core').then(({ invoke }) => invoke('pty_close', { id }));
      }
      if (activeTerm === term) activeTerm = null;
      term.dispose();
    };
  }, [project, agent, kickoff]);

  return <div className="term-host" data-terminal-root ref={hostRef} />;
}
