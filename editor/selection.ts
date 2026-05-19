/**
 * Selection model — a substrate-shared type.
 *
 * Every canvas plugin gets to interpret it (beats for kinetic, lines
 * for a code canvas, etc). The shell tracks it; the active canvas
 * decides what it means.
 */

export type Selection =
  | { kind: "story" }
  | { kind: "beat"; indices: number[] };

/** True if this beat index is selected (or the only beat selected). */
export const isBeatSelected = (sel: Selection, i: number): boolean =>
  sel.kind === "beat" && sel.indices.includes(i);

/** Convenience: returns the selected indices array, or [] if none. */
export const selectedIndices = (sel: Selection): number[] =>
  sel.kind === "beat" ? sel.indices : [];

/** Convenience: returns the first selected beat index, or null. */
export const primarySelectedIndex = (sel: Selection): number | null =>
  sel.kind === "beat" && sel.indices.length > 0 ? sel.indices[0] : null;
