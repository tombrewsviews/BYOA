/**
 * Tiny perf overlay — counts component renders + measures key intervals.
 *
 * Hidden by default. Toggle with ⌃P (Ctrl+P) or by setting localStorage
 * `studio.perf` to `1`. Never shipped to production users, only used
 * when diagnosing "the app feels slow".
 *
 * Tracks:
 *   - editor render count (mounts of <App>)
 *   - story-update count (each setStory in App.tsx)
 *   - frameupdate Hz (events/sec from the Player)
 *   - last 5 setStory frame-time deltas (how much time between successive
 *     story changes — if this is tiny during a drag, we know we're saving
 *     too often)
 */
import React, { useEffect, useMemo, useState } from "react";
import type { PlayerRef, CallbackListener } from "@remotion/player";

type Stats = {
  storyChanges: number;
  storyDeltas: number[]; // ms between recent storyChange increments
  frameupdateHz: number;
};

class PerfBus {
  private stats: Stats = {
    storyChanges: 0,
    storyDeltas: [],
    frameupdateHz: 0,
  };
  private listeners = new Set<() => void>();
  private lastStoryTime = 0;
  private frameupdateCount = 0;
  private frameupdateLastReset = performance.now();

  bumpStory() {
    const now = performance.now();
    if (this.lastStoryTime > 0) {
      this.stats.storyDeltas = [
        ...this.stats.storyDeltas,
        Math.round(now - this.lastStoryTime),
      ].slice(-8);
    }
    this.lastStoryTime = now;
    this.stats.storyChanges++;
    this.emit();
  }
  bumpFrameupdate() {
    this.frameupdateCount++;
    const now = performance.now();
    const elapsed = now - this.frameupdateLastReset;
    if (elapsed >= 1000) {
      this.stats.frameupdateHz = Math.round(
        (this.frameupdateCount * 1000) / elapsed,
      );
      this.frameupdateCount = 0;
      this.frameupdateLastReset = now;
      this.emit();
    }
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  snapshot(): Stats {
    return { ...this.stats };
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }
}

export const perf = new PerfBus();

export const PerfOverlay: React.FC<{
  playerRef: React.RefObject<PlayerRef | null>;
}> = ({ playerRef }) => {
  const [enabled, setEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem("studio.perf") === "1";
    } catch {
      return false;
    }
  });
  const [, force] = useState(0);

  // hotkey ⌃P toggles
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        setEnabled((v) => {
          const next = !v;
          try {
            localStorage.setItem("studio.perf", next ? "1" : "0");
          } catch {
            /* ignore */
          }
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Subscribe to perf bus.
  useEffect(() => {
    if (!enabled) return;
    return perf.subscribe(() => force((n) => n + 1));
  }, [enabled]);

  // Subscribe to frameupdate to measure Hz.
  useEffect(() => {
    if (!enabled) return;
    const player = playerRef.current;
    if (!player) return;
    const handler: CallbackListener<"frameupdate"> = () => perf.bumpFrameupdate();
    player.addEventListener("frameupdate", handler);
    return () => {
      player.removeEventListener("frameupdate", handler);
    };
  }, [enabled, playerRef]);

  const stats = useMemo(() => (enabled ? perf.snapshot() : null), [enabled]);

  if (!enabled || !stats) return null;

  return (
    // Dev-only diagnostic overlay — deliberately keeps its amber/monospace
    // "instrument" look (it is never user-facing); only the chrome is
    // tokenized to match the grey system.
    <div className="pointer-events-none fixed bottom-3 right-3 z-[1000] min-w-[200px] rounded-md border border-border bg-popover/95 px-2.5 py-2 font-mono text-[10px] text-amber-400">
      <div className="mb-1 font-bold">perf · ⌃P to hide</div>
      <div>setStory count: {stats.storyChanges}</div>
      <div>frameupdate Hz: {stats.frameupdateHz}</div>
      <div>recent setStory Δms: [{stats.storyDeltas.join(", ")}]</div>
    </div>
  );
};
