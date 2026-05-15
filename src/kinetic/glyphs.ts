/**
 * Glyph → SVG path extraction, using opentype.js.
 *
 * For the "morph" capability we need letterforms AS SVG PATHS (not text)
 * so flubber can interpolate a shape into a letter. opentype.js parses the
 * raw .ttf and gives us per-glyph vector outlines.
 *
 * ⚠️ HARD-WON BUG NOTE: in this opentype.js version, `path.getBoundingBox()`
 * MUTATES the path's command list — calling it before `path.toPathData()`
 * corrupts the output (emits "NaN" coords). So we ALWAYS call toPathData()
 * first, then getBoundingBox(). Order matters. Do not reorder.
 *
 * REMOTION CONCERNS handled here:
 *  - The font file is fetched once via staticFile() and parsed once into a
 *    module-level cache. Parsing per frame would be absurdly slow.
 *  - Loading is async, so callers use delayRender()/continueRender() (see
 *    useFont) to hold the render until the font is ready.
 *  - getGlyphPath is pure given a parsed font, so it's frame-deterministic.
 */
import { useEffect, useState } from "react";
import { staticFile, delayRender, continueRender } from "remotion";
// Namespace import: opentype.js's .mjs build has no usable default export
// in Rollup (the editor's Vite build) — `import opentype from` breaks the
// build. `import * as` works in tsx, the renderer, AND Rollup. The type
// names (Font, PathCommand) still resolve from @types/opentype.js.
import * as opentype from "opentype.js";

let cachedFont: opentype.Font | null = null;
let loadingPromise: Promise<opentype.Font> | null = null;

const FONT_URL = staticFile("fonts/SpaceGrotesk-Bold.ttf");

const loadFontOnce = (): Promise<opentype.Font> => {
  if (cachedFont) return Promise.resolve(cachedFont);
  if (loadingPromise) return loadingPromise;
  loadingPromise = fetch(FONT_URL)
    .then((r) => r.arrayBuffer())
    .then((buf) => {
      const font = opentype.parse(buf);
      cachedFont = font;
      return font;
    });
  return loadingPromise;
};

/**
 * Hook: returns the parsed font (or null until ready). Holds the Remotion
 * render via delayRender so no frame paints before glyphs are available.
 */
export const useFont = (): opentype.Font | null => {
  const [font, setFont] = useState<opentype.Font | null>(cachedFont);

  useEffect(() => {
    if (font) return;
    const handle = delayRender("Parsing font for glyph paths");
    loadFontOnce()
      .then((f) => {
        setFont(f);
        continueRender(handle);
      })
      .catch((e) => {
        // Don't deadlock the render if the font fails — continue and let
        // the morph fall back to its circle primitive.
        console.error("Font parse failed:", e);
        continueRender(handle);
      });
  }, [font]);

  return font;
};

export type GlyphPath = {
  /** SVG path data, normalized into a 0..100 x 0..100 viewBox */
  d: string;
};

/**
 * Build an SVG path `d` string from opentype's structured command objects,
 * applying scale + offset, with EXPLICIT separators.
 *
 * ⚠️ Why not regex the toPathData() string instead? opentype's toPathData
 * omits the separator between a number and a following positive decimal
 * ("12.71" + "0.00" -> "12.710.00"), which is unparseable. The command
 * objects are unambiguous structured data — use those.
 */
const buildPathData = (
  commands: opentype.PathCommand[],
  scale: number,
  offsetX: number,
  offsetY: number,
): string => {
  const X = (v: number) => (v * scale + offsetX).toFixed(2);
  const Y = (v: number) => (v * scale + offsetY).toFixed(2);
  return commands
    .map((c) => {
      switch (c.type) {
        case "M":
          return `M${X(c.x)} ${Y(c.y)}`;
        case "L":
          return `L${X(c.x)} ${Y(c.y)}`;
        case "C":
          return `C${X(c.x1)} ${Y(c.y1)} ${X(c.x2)} ${Y(c.y2)} ${X(c.x)} ${Y(c.y)}`;
        case "Q":
          return `Q${X(c.x1)} ${Y(c.y1)} ${X(c.x)} ${Y(c.y)}`;
        case "Z":
          return "Z";
        default:
          return "";
      }
    })
    .join("");
};

/**
 * Get a single character's outline as an SVG path, normalized so the glyph
 * fits a 0..100 coordinate box (matching the `shape` paths in the schema,
 * so flubber can morph between them in the same space).
 */
export const getGlyphPath = (
  font: opentype.Font,
  char: string,
): GlyphPath | null => {
  const glyph = font.charToGlyph(char);
  if (!glyph || glyph.unicode === undefined) return null;

  const SIZE = 100;
  const path = glyph.getPath(0, 0, SIZE);

  // Snapshot commands BEFORE getBoundingBox() — see the file-header note
  // about getBoundingBox mutating the command list in this version.
  const commands = path.commands.map((c) => ({ ...c }));
  const bb = path.getBoundingBox();

  const w = bb.x2 - bb.x1 || 1;
  const h = bb.y2 - bb.y1 || 1;
  const scale = Math.min(SIZE / w, SIZE / h);
  const offsetX = (SIZE - w * scale) / 2 - bb.x1 * scale;
  const offsetY = (SIZE - h * scale) / 2 - bb.y1 * scale;

  return { d: buildPathData(commands, scale, offsetX, offsetY) };
};

/** A default "shape to morph from" when a beat provides no custom path. */
export const DEFAULT_MORPH_SHAPE = "M50,8 A42,42 0 1,1 49.9,8 Z"; // ~circle
