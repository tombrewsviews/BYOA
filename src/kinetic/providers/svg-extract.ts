/**
 * Shared SVG → normalized path extraction.
 *
 * Every vector provider (Recraft, Claude, Ollama, hand-written) returns
 * raw SVG markup with arbitrary structure. The kinetic engine only wants
 * ONE thing: a single `d` path string in the 0..100 coordinate box, so
 * flubber can morph it into a glyph (also normalized to 0..100).
 *
 * This module is the funnel: raw SVG in, clean normalized `d` out. It runs
 * in Node (the CLI) — no DOM — so it parses with regex, deliberately
 * handling only the path commands real providers emit (M/L/C/Q/Z, plus
 * their relative forms which we don't expect but guard against).
 */

/** A path plus its fill color (if the SVG specified one). */
type RawPath = { d: string; fill: string | null };

/** Pull all <path> elements (d + fill) out of an SVG document. */
const extractPaths = (svg: string): RawPath[] => {
  const matches = [...svg.matchAll(/<path\b[^>]*>/gi)];
  return matches
    .map((m) => {
      const tag = m[0];
      const d = tag.match(/\sd=["']([^"']+)["']/i)?.[1]?.trim();
      const fill = tag.match(/\sfill=["']([^"']+)["']/i)?.[1]?.trim() ?? null;
      return d ? { d, fill } : null;
    })
    .filter((p): p is RawPath => p !== null);
};

/**
 * Normalize a color to a hex string the rest of the app uses. Handles
 * rgb(r,g,b) — what Recraft emits — and passes through hex / named colors.
 */
const toHex = (color: string | null): string | null => {
  if (!color || color === "none") return null;
  const rgb = color.match(/rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgb) {
    const h = (n: string) => Number(n).toString(16).padStart(2, "0");
    return `#${h(rgb[1])}${h(rgb[2])}${h(rgb[3])}`;
  }
  return color; // already hex or a named color
};

/** Pull the viewBox so we know the provider's coordinate space. */
const extractViewBox = (
  svg: string,
): { x: number; y: number; w: number; h: number } | null => {
  const m = svg.match(/viewBox=["']\s*([\d.\s-]+)["']/i);
  if (!m) return null;
  const [x, y, w, h] = m[1].trim().split(/\s+/).map(Number);
  if ([x, y, w, h].some((n) => Number.isNaN(n))) return null;
  return { x, y, w, h };
};

/**
 * Split a path `d` into its subpaths (one per `M`/`m` command).
 *
 * ⚠️ Recraft often merges the background rect AND the real shape into ONE
 * compound <path> ("M 0 0 L 100 0 ... z M 46 37 C ..."). If we don't split,
 * the bg rect rides along — and its black fill / canvas-spanning geometry
 * poisons both the morph and the color. So: split, then drop rect subpaths.
 */
const splitSubpaths = (d: string): string[] => {
  // each subpath starts at an M/m; keep the command with it
  const parts = d.match(/[Mm][^Mm]*/g);
  return parts ? parts.map((s) => s.trim()).filter(Boolean) : [d];
};

/**
 * Heuristic: is this (sub)path just the full-canvas background rectangle?
 * A bg rect is few points, all near the canvas corners, spanning ~the
 * whole viewBox.
 */
const isBackgroundRect = (
  d: string,
  vb: { w: number; h: number } | null,
): boolean => {
  const nodeCount = (d.match(/[MLCQZ]/gi) ?? []).length;
  // a rect is M + 3-4 L's + Z — very few commands, and NO curves.
  const hasCurves = /[CQ]/i.test(d);
  if (hasCurves || nodeCount > 7) return false;
  const nums = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  if (!xs.length || !ys.length) return false;
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  if (!vb) {
    // no viewBox: a rect-ish path starting at origin spanning a large area
    return /^[Mm]\s*0[\s,]+0/.test(d) && spanX > 50 && spanY > 50;
  }
  return spanX > vb.w * 0.9 && spanY > vb.h * 0.9;
};

/**
 * Parse a path's coordinate numbers and return its bounding box.
 * Approximate (uses control points too) — good enough for normalization.
 */
const pathBounds = (d: string) => {
  const nums = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < nums.length - 1; i += 2) {
    xs.push(nums[i]);
    ys.push(nums[i + 1]);
  }
  return {
    x1: Math.min(...xs),
    y1: Math.min(...ys),
    x2: Math.max(...xs),
    y2: Math.max(...ys),
  };
};

/**
 * Scale + translate every coordinate pair in a path so the shape fits a
 * 0..100 box, centered. Builds the output with explicit separators (the
 * concatenation bug from glyphs.ts applies here too).
 */
const normalizeTo100 = (d: string): string => {
  const bb = pathBounds(d);
  const w = bb.x2 - bb.x1 || 1;
  const h = bb.y2 - bb.y1 || 1;
  const scale = Math.min(100 / w, 100 / h);
  const offsetX = (100 - w * scale) / 2 - bb.x1 * scale;
  const offsetY = (100 - h * scale) / 2 - bb.y1 * scale;

  // Tokenize into commands + numbers, rebuild with transformed coords.
  // Path commands real providers emit: M L C Q Z (and lowercase relative).
  // We treat all numbers as alternating x,y — correct for M/L/C/Q absolute.
  let coordIndex = 0;
  return d.replace(
    /([MLCQZ])|(-?\d*\.?\d+(?:e-?\d+)?)/gi,
    (_full, cmd, num) => {
      if (cmd) {
        // a command letter resets nothing — the x/y alternation continues
        // correctly because each command's params are coordinate pairs.
        return ` ${cmd} `;
      }
      const n = parseFloat(num);
      const isX = coordIndex % 2 === 0;
      coordIndex++;
      return `${(n * scale + (isX ? offsetX : offsetY)).toFixed(2)} `;
    },
  );
};

export type ExtractResult = {
  /** the chosen shape path, normalized to the 0..100 box */
  d: string;
  /** the fill color the provider gave the shape (hex), or null if none */
  fill: string | null;
  /** how many path elements the SVG had (diagnostics / benchmark) */
  pathCount: number;
  /** node count of the chosen path (lower = morphs better) */
  nodeCount: number;
};

/**
 * The main entry: raw SVG markup -> one normalized shape path + its fill.
 *
 * Pipeline:
 *  1. extract every <path> (d + fill)
 *  2. split each into SUBPATHS — Recraft merges the bg rect into the
 *     shape's compound path, so subpath-level splitting is required
 *  3. drop background-rect subpaths
 *  4. pick the subpath with the most drawing commands = the main subject
 *  5. its fill comes from the parent <path> element (carried through so
 *     the engine renders the real color — the "why is it black & white" fix)
 *
 * Returns null if no usable shape is found.
 */
export const extractShapePath = (svg: string): ExtractResult | null => {
  const paths = extractPaths(svg);
  if (!paths.length) return null;

  const vb = extractViewBox(svg);

  // flatten to subpaths, each tagged with its parent's fill
  type Sub = { d: string; fill: string | null; n: number };
  const subs: Sub[] = [];
  for (const p of paths) {
    for (const sub of splitSubpaths(p.d)) {
      if (isBackgroundRect(sub, vb)) continue; // drop the canvas rect
      subs.push({
        d: sub,
        fill: p.fill,
        n: (sub.match(/[MLCQ]/gi) ?? []).length,
      });
    }
  }
  if (!subs.length) return null;

  // the main subject = the subpath with the most drawing commands
  const chosen = subs.sort((a, b) => b.n - a.n)[0];

  return {
    d: normalizeTo100(chosen.d).replace(/\s+/g, " ").trim(),
    fill: toHex(chosen.fill),
    pathCount: paths.length,
    nodeCount: chosen.n,
  };
};
