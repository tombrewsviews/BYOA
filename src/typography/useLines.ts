/**
 * Wraps @chenglou/pretext — the SAME text-layout library the portfolio
 * uses (`window.__pretext`) — to split a string into wrapped lines.
 *
 * pretext is a measurement library, not an animation library: given text,
 * a font, and a max width, it tells you where the lines break. That's
 * pure computation with no DOM and no time dependency, so it's safe and
 * deterministic inside a Remotion composition.
 *
 * REMOTION CONSTRAINT: this must be computed ONCE and be stable across
 * every frame — if line breaks changed frame-to-frame the animation would
 * jitter. Hence useMemo keyed only on the inputs that affect layout.
 *
 * pretext API (v0.0.3+):
 *   prepareWithSegments(text, font)  -> PreparedText
 *   layoutWithLines(prepared, maxWidth, lineHeight) -> { lines: [{text,...}] }
 * `font` is CSS font shorthand, e.g. "700 96px 'Space Grotesk'".
 */
import { useMemo } from "react";
import { prepareWithSegments, layoutWithLines } from "@chenglou/pretext";

export type SplitLine = { text: string; width: number };

export const useLines = (
  text: string,
  font: string,
  maxWidth: number,
  lineHeight: number,
): SplitLine[] => {
  return useMemo(() => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return [];
    try {
      const prepared = prepareWithSegments(clean, font);
      const result = layoutWithLines(prepared, maxWidth, lineHeight);
      return result.lines.map((l) => ({ text: l.text, width: l.width }));
    } catch {
      // pretext can throw on exotic input — fall back to the whole string
      // as a single line so the composition still renders.
      return [{ text: clean, width: maxWidth }];
    }
  }, [text, font, maxWidth, lineHeight]);
};

/** Split text into individual characters, preserving spaces. */
export const splitChars = (text: string): string[] => Array.from(text);
