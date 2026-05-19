/**
 * Undo button + arrow that opens a dropdown of recent history entries.
 *
 * Click the curved ← arrow = undo one step. Click the small ⏷ next to
 * it = open the dropdown and jump to any prior state. Cmd+Z / Cmd+Shift+
 * Z are bound globally inside useHistory().
 *
 * The dropdown lists the past from most-recent first. Clicking an item
 * jumps to that state — the still-newer entries become redo entries.
 */
import React, { useEffect, useRef, useState } from "react";
import type { HistoryHandle } from "./shell";
import { color, font, radius, secondaryBtn } from "./platform/theme";

const fmtAgo = (now: number, then: number): string => {
  const ms = Math.max(0, now - then);
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
};

export const UndoMenu: React.FC<{ history: HistoryHandle<any> }> = ({ history }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const baseBtn: React.CSSProperties = {
    ...secondaryBtn(),
    fontSize: font.size.sm,
    padding: "3px 8px",
  };

  const now = Date.now();
  // Show newest-first.
  const entries = [...history.past].reverse();

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "flex" }}>
      <button
        onClick={history.undo}
        disabled={!history.canUndo}
        title="Undo (⌘Z)"
        style={{
          ...baseBtn,
          borderRadius: "4px 0 0 4px",
          opacity: history.canUndo ? 1 : 0.4,
          cursor: history.canUndo ? "pointer" : "default",
        }}
      >
        ↶ Undo
      </button>
      <button
        onClick={history.redo}
        disabled={!history.canRedo}
        title="Redo (⌘⇧Z)"
        style={{
          ...baseBtn,
          borderLeft: 0,
          borderRadius: 0,
          opacity: history.canRedo ? 1 : 0.4,
          cursor: history.canRedo ? "pointer" : "default",
        }}
      >
        ↷
      </button>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={entries.length === 0}
        title="History"
        style={{
          ...baseBtn,
          borderLeft: 0,
          borderRadius: "0 4px 4px 0",
          opacity: entries.length === 0 ? 0.4 : 1,
          cursor: entries.length === 0 ? "default" : "pointer",
          padding: "3px 6px",
        }}
      >
        ▾
      </button>
      {open && entries.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 4,
            minWidth: 220,
            maxHeight: 320,
            overflowY: "auto",
            background: color.bg.surface,
            border: `1px solid ${color.border.strong}`,
            borderRadius: radius.md,
            boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
            zIndex: 100,
            fontSize: font.size.sm,
          }}
        >
          <div
            style={{
              padding: "6px 10px",
              borderBottom: `1px solid ${color.border.line}`,
              color: color.text.dim,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              fontSize: font.size.xs,
            }}
          >
            History · {entries.length}
          </div>
          {entries.map((entry, i) => {
            // entries are reversed (newest first); past index is the
            // original position counted from oldest.
            const pastIndex = history.past.length - 1 - i;
            return (
              <button
                key={pastIndex}
                onClick={() => {
                  history.jumpTo(pastIndex);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  width: "100%",
                  background: "transparent",
                  border: 0,
                  color: color.text.secondary,
                  padding: "6px 10px",
                  cursor: "pointer",
                  textAlign: "left",
                  alignItems: "baseline",
                  gap: 8,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = color.bg.hover)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ flex: 1 }}>{entry.label}</span>
                <span style={{ color: color.text.dim, fontSize: font.size.xs }}>
                  {fmtAgo(now, entry.at)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
