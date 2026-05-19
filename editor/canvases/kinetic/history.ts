/**
 * Undo/redo history for the story.
 *
 * Wraps a setStory-style setter so every commit pushes onto a bounded
 * past-stack (default 100 entries). Snapshots are coalesced: writes
 * within COALESCE_MS of the previous one (e.g. during a drag) update
 * the in-progress snapshot rather than push a new one, so a 60-fps
 * drag = one undo step, not sixty.
 *
 * Labels are inferred from the diff between the previous and new
 * snapshot. They power the dropdown next to undo/redo so the user can
 * jump to a specific past state by name.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Story } from "../../../src/kinetic/schema";
import { diffFields, fieldLabel } from "./diff";
import type { HistoryHandle, HistoryEntry } from "../../shell";

const MAX_HISTORY = 100;
const COALESCE_MS = 400;

const inferLabel = (prev: Story | null, next: Story): string => {
  if (!prev) return "Initial";
  // Different beat counts → add/remove
  if (next.beats.length > prev.beats.length) return "Add beat";
  if (next.beats.length < prev.beats.length) return "Remove beat";
  // Same length: look for the first diff
  const diff = diffFields(prev, next);
  if (diff.size === 0) return "Change";
  const first = [...diff][0];
  return fieldLabel(first);
};

export const useHistory = (): HistoryHandle<Story> => {
  const [story, setStoryState] = useState<Story | null>(null);
  const pastRef = useRef<HistoryEntry<Story>[]>([]);
  const futureRef = useRef<HistoryEntry<Story>[]>([]);
  // For coalescing: when the last commit was, and whether it was eligible
  // to merge with the next one.
  const lastCommitAtRef = useRef<number>(0);
  // Triggers re-renders of the dropdown when history changes.
  const [, bump] = useState(0);
  const forceRender = useCallback(() => bump((n) => n + 1), []);

  const setStory = useCallback(
    (next: Story | ((prev: Story) => Story), label?: string) => {
      setStoryState((prev) => {
        if (!prev) {
          // No baseline yet — just take the value, don't record.
          const value = typeof next === "function" ? null : (next as Story);
          return value;
        }
        const value =
          typeof next === "function"
            ? (next as (p: Story) => Story)(prev)
            : (next as Story);
        // Skip if no actual change.
        if (JSON.stringify(value) === JSON.stringify(prev)) return prev;

        const now = Date.now();
        const past = pastRef.current;
        const coalesce =
          past.length > 0 &&
          now - lastCommitAtRef.current < COALESCE_MS &&
          !label; // an explicit label always pushes a new entry

        if (coalesce) {
          // Replace the top entry's "next state" by NOT pushing prev — we
          // just update the timestamp. The current `prev` was already saved
          // when the run started, so the top entry already represents the
          // pre-drag state. Nothing to mutate.
          lastCommitAtRef.current = now;
        } else {
          past.push({
            story: prev,
            label: label ?? inferLabel(past[past.length - 1]?.story ?? null, value),
            at: now,
          });
          if (past.length > MAX_HISTORY) past.shift();
          futureRef.current = [];
          lastCommitAtRef.current = now;
        }
        forceRender();
        return value;
      });
    },
    [forceRender],
  );

  const resetTo = useCallback(
    (s: Story | null) => {
      pastRef.current = [];
      futureRef.current = [];
      lastCommitAtRef.current = 0;
      setStoryState(s);
      forceRender();
    },
    [forceRender],
  );

  const undo = useCallback(() => {
    setStoryState((current) => {
      if (!current) return current;
      const top = pastRef.current.pop();
      if (!top) return current;
      futureRef.current.push({ story: current, label: top.label, at: Date.now() });
      lastCommitAtRef.current = 0; // force the next edit to make a fresh entry
      forceRender();
      return top.story;
    });
  }, [forceRender]);

  const redo = useCallback(() => {
    setStoryState((current) => {
      if (!current) return current;
      const top = futureRef.current.pop();
      if (!top) return current;
      pastRef.current.push({ story: current, label: top.label, at: Date.now() });
      if (pastRef.current.length > MAX_HISTORY) pastRef.current.shift();
      lastCommitAtRef.current = 0;
      forceRender();
      return top.story;
    });
  }, [forceRender]);

  const jumpTo = useCallback(
    (pastIndex: number) => {
      setStoryState((current) => {
        if (!current) return current;
        const past = pastRef.current;
        if (pastIndex < 0 || pastIndex >= past.length) return current;
        // Move everything ABOVE pastIndex into the future (most-recent first).
        const target = past[pastIndex];
        const removed = past.splice(pastIndex);
        // removed[0] is the target; removed[1..] become future entries (last
        // is current). Push current first, then the popped ones in reverse
        // so redo replays them oldest→newest.
        const newFuture: HistoryEntry<Story>[] = [
          { story: current, label: "Current", at: Date.now() },
          ...removed.slice(1).reverse().map((e) => ({ ...e })),
        ];
        futureRef.current = [...newFuture, ...futureRef.current];
        lastCommitAtRef.current = 0;
        forceRender();
        return target.story;
      });
    },
    [forceRender],
  );

  // Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z. App-owned: wins over the
  // terminal (so undo always undoes the canvas, even when xterm has
  // focus) but yields to inputs (where Cmd+Z should undo typing in
  // the field). Capture phase + stopImmediatePropagation ensures
  // xterm never sees the keystroke.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key !== "z" && e.key !== "Z") return;
      const t = e.target as HTMLElement | null;
      if (t && t.matches("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [undo, redo]);

  return {
    story,
    setStory,
    resetTo,
    undo,
    redo,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    past: pastRef.current,
    jumpTo,
  };
};
