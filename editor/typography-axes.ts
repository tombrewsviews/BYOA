/**
 * Pure helpers for the panel's typography controls.
 *
 * The schema stores each variable-font axis as a [start, end] tuple, animated
 * across the beat (see `axisRangesSchema` in schema.ts). The panel edits these
 * as either a single STATIC value ([v, v]) or an animated RANGE ([start, end]).
 *
 * Clamping uses the per-family bounds the renderer already enforces
 * (`FONT_AXIS_BOUNDS` in glyphs.ts), so the panel never lets the user set a
 * value the font can't render. These functions are pure and side-effect-free
 * so they can be unit-tested without React.
 */
import { FONT_AXIS_BOUNDS, FONT_STATIC_WEIGHTS } from "../src/kinetic/glyphs";
import type { FontFamily, AxisRanges } from "../src/kinetic/schema";

export type AxisKey = "wght" | "wdth" | "slnt";

/**
 * Discrete weights for a non-variable font, or null when the font varies its
 * weight axis (use the continuous slider instead). Falls back to a single
 * "Regular" 400 entry if a static font has no explicit list.
 */
export const staticWeightOptions = (
  family: FontFamily,
): { label: string; value: number }[] | null => {
  if (axisSupported("wght", family)) return null;
  return FONT_STATIC_WEIGHTS[family] ?? [{ label: "Regular", value: 400 }];
};

export const axisBounds = (
  axis: AxisKey,
  family: FontFamily,
): [number, number] => FONT_AXIS_BOUNDS[family][axis];

export const clampAxis = (
  value: number,
  axis: AxisKey,
  family: FontFamily,
): number => {
  const [min, max] = axisBounds(axis, family);
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
};

/** An axis whose bounds collapse to a single value (min === max) can't vary. */
export const axisSupported = (axis: AxisKey, family: FontFamily): boolean => {
  const [min, max] = axisBounds(axis, family);
  return max > min;
};

export const setAxisStatic = (
  axes: AxisRanges,
  axis: AxisKey,
  value: number,
  family: FontFamily,
): AxisRanges => {
  const v = clampAxis(value, axis, family);
  return { ...axes, [axis]: [v, v] };
};

export const setAxisRange = (
  axes: AxisRanges,
  axis: AxisKey,
  start: number,
  end: number,
  family: FontFamily,
): AxisRanges => ({
  ...axes,
  [axis]: [clampAxis(start, axis, family), clampAxis(end, axis, family)],
});

/** True when the stored tuple's two ends differ — i.e. it's animated. */
export const isAxisAnimated = (axes: AxisRanges, axis: AxisKey): boolean =>
  axes[axis][0] !== axes[axis][1];
