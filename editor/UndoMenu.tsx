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
import { Button } from "@/components/ui/button";
import { Undo2, Redo2, ChevronDown } from "./icons";

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

  const now = Date.now();
  // Show newest-first.
  const entries = [...history.past].reverse();

  // Connected split-button group: the inner borders are collapsed and only
  // the outer corners are rounded, so undo / redo / history read as one unit.
  return (
    <div
      ref={wrapRef}
      className="relative flex [&>button]:rounded-none [&>button:first-child]:rounded-l-md [&>button:last-child]:rounded-r-md [&>button:not(:first-child)]:-ml-px"
    >
      <Button
        variant="secondary"
        size="sm"
        onClick={history.undo}
        disabled={!history.canUndo}
        title="Undo (⌘Z)"
      >
        <Undo2 />
        Undo
      </Button>
      <Button
        variant="secondary"
        size="icon-sm"
        onClick={history.redo}
        disabled={!history.canRedo}
        title="Redo (⌘⇧Z)"
      >
        <Redo2 />
      </Button>
      <Button
        variant="secondary"
        size="icon-sm"
        onClick={() => setOpen((v) => !v)}
        disabled={entries.length === 0}
        title="History"
        aria-label="History"
      >
        <ChevronDown />
      </Button>
      {open && entries.length > 0 && (
        <div className="absolute left-0 top-full z-[100] mt-1 max-h-80 min-w-[220px] overflow-y-auto rounded-md border border-border bg-popover text-sm shadow-md">
          <div className="border-b border-border px-2.5 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
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
                className="flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent"
              >
                <span className="flex-1">{entry.label}</span>
                <span className="text-[10px] text-muted-foreground">
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
