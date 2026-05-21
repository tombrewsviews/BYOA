/**
 * Glyph → SVG path extraction, using opentype.js. Multi-font edition.
 *
 * For the "morph" capability we need letterforms AS SVG PATHS (not text)
 * so flubber can interpolate a shape into a letter. opentype.js parses
 * the raw .ttf and gives us per-glyph vector outlines.
 *
 * We now ship four families:
 *  - SpaceGrotesk  : static bold (legacy default)
 *  - RobotoFlex    : variable, 16 axes (wght/wdth/slnt/grad/opsz/…)
 *  - Recursive     : variable (CASL/CRSV/MONO/slnt/wght) — display
 *  - InterVF       : variable (wght, optical size)
 *
 * opentype.js parses *static* outlines (the default instance of a VF).
 * The morph beat only morphs the FIRST letter from a shape — the value
 * of the variable axes for that first letter just uses the parsed
 * default. The remaining letters are HTML text (RevealBeat etc.) and
 * THOSE animate `font-variation-settings` in CSS, where the browser
 * (and Remotion's headless Chromium during render) honours the VF axes.
 *
 * ⚠️ HARD-WON BUG NOTE: in this opentype.js version,
 * `path.getBoundingBox()` MUTATES the path's command list — calling it
 * before `path.toPathData()` corrupts the output (emits "NaN" coords).
 * ALWAYS snapshot commands first, then call getBoundingBox(). Order matters.
 *
 * REMOTION CONCERNS:
 *  - Each font is fetched once and parsed once into a module-level cache.
 *  - useFont returns null until the requested family is parsed, and holds
 *    the Remotion render via delayRender so no frame paints prematurely.
 *  - getGlyphPath is pure given a parsed font, so it's frame-deterministic.
 */
import { useEffect, useState } from "react";
import { staticFile, delayRender, continueRender } from "remotion";
import * as opentype from "opentype.js";
import type { FontFamily } from "./schema";

// ---------------------------------------------------------------------------
// Font registry — file paths + CSS family name (for HTML beats)
// ---------------------------------------------------------------------------

type FontRegistryEntry = {
  /** path under public/ (consumed by staticFile()) */
  file: string;
  /** CSS font-family value used in <style> and inline styles */
  cssFamily: string;
};

export const FONT_REGISTRY: Record<FontFamily, FontRegistryEntry> = {
  SpaceGrotesk: {
    file: "fonts/SpaceGrotesk-Bold.ttf",
    cssFamily: "SpaceGroteskKinetic",
  },
  RobotoFlex: {
    file: "fonts/RobotoFlex.ttf",
    cssFamily: "RobotoFlexKinetic",
  },
  Recursive: {
    file: "fonts/Recursive.ttf",
    cssFamily: "RecursiveKinetic",
  },
  InterVF: {
    file: "fonts/InterVF.ttf",
    cssFamily: "InterVFKinetic",
  },
  Fraunces: {
    file: "fonts/Fraunces.ttf",
    cssFamily: "FrauncesKinetic",
  },
  BricolageGrotesque: {
    file: "fonts/BricolageGrotesque.ttf",
    cssFamily: "BricolageGrotesqueKinetic",
  },
  InstrumentSans: {
    file: "fonts/InstrumentSans.ttf",
    cssFamily: "InstrumentSansKinetic",
  },
  Archivo: {
    file: "fonts/Archivo.ttf",
    cssFamily: "ArchivoKinetic",
  },
};

/** Sensible per-family axis bounds, for clamping schema axis ranges. */
export const FONT_AXIS_BOUNDS: Record<
  FontFamily,
  { wght: [number, number]; wdth: [number, number]; slnt: [number, number] }
> = {
  SpaceGrotesk: {
    wght: [700, 700], // static — no variation
    wdth: [100, 100],
    slnt: [0, 0],
  },
  RobotoFlex: {
    wght: [100, 1000],
    wdth: [25, 151],
    slnt: [-10, 0],
  },
  Recursive: {
    wght: [300, 1000],
    wdth: [100, 100], // no width axis in this build
    slnt: [-15, 0],
  },
  InterVF: {
    wght: [100, 900],
    wdth: [100, 100],
    slnt: [0, 0],
  },
  // opsz/SOFT/WONK axes also present, but we only animate weight here.
  Fraunces: {
    wght: [100, 900],
    wdth: [100, 100],
    slnt: [0, 0],
  },
  BricolageGrotesque: {
    wght: [200, 800],
    wdth: [75, 100],
    slnt: [0, 0],
  },
  InstrumentSans: {
    wght: [400, 700],
    wdth: [75, 100],
    slnt: [0, 0],
  },
  Archivo: {
    wght: [100, 900],
    wdth: [62, 125],
    slnt: [0, 0],
  },
};

/**
 * Discrete named weights for NON-variable fonts. A font is "variable on
 * weight" when its FONT_AXIS_BOUNDS wght range is non-degenerate (min < max);
 * those use the continuous axis slider. Static fonts can only render the
 * specific weights their file ships, so the panel shows a dropdown of these
 * instead. SpaceGrotesk in this app is the bold-only file, so it offers a
 * single weight; add more entries if a multi-weight static font is bundled.
 */
export const FONT_STATIC_WEIGHTS: Partial<
  Record<FontFamily, { label: string; value: number }[]>
> = {
  SpaceGrotesk: [{ label: "Bold", value: 700 }],
};

// ---------------------------------------------------------------------------
// Font loading — cached per family
// ---------------------------------------------------------------------------

const cachedFonts: Partial<Record<FontFamily, opentype.Font>> = {};
const loadingPromises: Partial<Record<FontFamily, Promise<opentype.Font>>> = {};

const loadFontOnce = (family: FontFamily): Promise<opentype.Font> => {
  const cached = cachedFonts[family];
  if (cached) return Promise.resolve(cached);
  const inflight = loadingPromises[family];
  if (inflight) return inflight;
  const url = staticFile(FONT_REGISTRY[family].file);
  const p = fetch(url)
    .then((r) => r.arrayBuffer())
    .then((buf) => {
      const font = opentype.parse(buf);
      cachedFonts[family] = font;
      return font;
    });
  loadingPromises[family] = p;
  return p;
};

/**
 * Hook: returns the parsed font for the requested family (or null until
 * ready). Holds the Remotion render via delayRender so no frame paints
 * before glyphs are available.
 */
export const useFont = (family: FontFamily = "RobotoFlex"): opentype.Font | null => {
  const [font, setFont] = useState<opentype.Font | null>(
    cachedFonts[family] ?? null,
  );

  useEffect(() => {
    if (cachedFonts[family]) {
      setFont(cachedFonts[family]!);
      return;
    }
    const handle = delayRender(`Parsing font: ${family}`);
    loadFontOnce(family)
      .then((f) => {
        setFont(f);
        continueRender(handle);
      })
      .catch((e) => {
        console.error(`Font parse failed (${family}):`, e);
        continueRender(handle);
      });
  }, [family]);

  return font;
};

export type GlyphPath = {
  /** SVG path data, normalized into a 0..100 x 0..100 viewBox */
  d: string;
  /** number of subpaths in the glyph (1 for most letters, 2+ for O/e/g/A) */
  subpaths: number;
};

/**
 * Build an SVG path `d` string from opentype's structured command objects,
 * applying scale + offset, with EXPLICIT separators.
 */
const buildPathData = (
  commands: opentype.PathCommand[],
  scale: number,
  offsetX: number,
  offsetY: number,
): { d: string; subpaths: number } => {
  const X = (v: number) => (v * scale + offsetX).toFixed(2);
  const Y = (v: number) => (v * scale + offsetY).toFixed(2);
  let subpaths = 0;
  const d = commands
    .map((c) => {
      switch (c.type) {
        case "M":
          subpaths++;
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
  return { d, subpaths };
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

  // Snapshot commands BEFORE getBoundingBox() — see file-header note.
  const commands = path.commands.map((c) => ({ ...c }));
  const bb = path.getBoundingBox();

  const w = bb.x2 - bb.x1 || 1;
  const h = bb.y2 - bb.y1 || 1;
  const scale = Math.min(SIZE / w, SIZE / h);
  const offsetX = (SIZE - w * scale) / 2 - bb.x1 * scale;
  const offsetY = (SIZE - h * scale) / 2 - bb.y1 * scale;

  return buildPathData(commands, scale, offsetX, offsetY);
};

/**
 * Extract JUST the outer (largest) subpath from a glyph path string.
 * Letters with holes (o, e, a, g, p, b, d) come back as multiple "M…Z"
 * subpaths from opentype. Flubber's `interpolate(from, to)` can only
 * morph between SINGLE closed paths, so we morph to the outer shape and
 * fade the counter (the hole) in separately. See MorphBeat.
 */
export const splitSubpaths = (d: string): string[] => {
  // split on M but preserve it as the start of each segment
  const parts = d.split(/(?=M)/).filter((s) => s.trim().length);
  return parts;
};

/** Pick the longest subpath (heuristic for "outer contour"). */
export const outerSubpath = (d: string): string => {
  const subs = splitSubpaths(d);
  if (subs.length <= 1) return d;
  return subs.reduce((a, b) => (b.length > a.length ? b : a), subs[0]);
};

/** A default "shape to morph from" when a beat provides no custom path. */
export const DEFAULT_MORPH_SHAPE = "M50,8 A42,42 0 1,1 49.9,8 Z";
