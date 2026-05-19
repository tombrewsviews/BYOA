/**
 * Shell actions — the substrate's outward-facing API for canvas
 * plugins. Plugins call `useShellActions()` to ask the shell to
 * switch tabs, focus the terminal, etc, without coupling to App.tsx.
 *
 * Why a context rather than module-level globals: actions depend on
 * shell state (the current leftTab setter, the terminal element ref)
 * and there can be more than one shell mounted in tests. A context
 * also keeps the seam visible — anything a plugin can do to the
 * shell is on this object.
 */
import { createContext, useContext } from "react";

export type ShellActions = {
  /** Switch the left-column tab to the terminal and focus it. Use
   *  this after any action that should hand keyboard control back to
   *  the agent (paste-prompt from Library, dismiss a modal, etc). */
  focusTerminal: () => void;
};

const noop: ShellActions = {
  focusTerminal: () => {},
};

export const ShellActionsContext = createContext<ShellActions>(noop);

export const useShellActions = (): ShellActions => useContext(ShellActionsContext);

/**
 * Generic interface a canvas's history implementation must satisfy.
 * The shell's UndoMenu consumes this; each canvas plugin provides an
 * implementation tailored to its doc shape.
 */
export type HistoryEntry<Doc> = {
  story: Doc;
  label: string;
  /** ms epoch when this entry was committed */
  at: number;
};

export type HistoryHandle<Doc> = {
  story: Doc | null;
  setStory: (next: Doc | ((prev: Doc) => Doc), label?: string) => void;
  /** Replace baseline without pushing onto history (e.g. file load). */
  resetTo: (story: Doc | null) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Past entries, most recent last. */
  past: HistoryEntry<Doc>[];
  /** Jump to a specific past index (0 = oldest in current past). */
  jumpTo: (pastIndex: number) => void;
};
