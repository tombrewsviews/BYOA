/**
 * Shape cache + library — so development never re-hits a paid API.
 *
 * THE RULE: a real provider call (Recraft = $0.08 each) only happens when
 * the caller explicitly forces it. Everything else is served from disk for
 * free. This module is what enforces that.
 *
 * Two folders under shapes/:
 *   cache/    prompt-hash-keyed JSON — every real generation is cached here
 *             and auto-reused. Same provider + prompt = free forever after
 *             the first call.
 *   library/  named, hand-curated shapes (imported SVGs, favourites). Picked
 *             by name, never generated.
 *
 * The CLI flow:
 *   gen/set-shape           -> cache hit? reuse (free). miss? ERROR, tells
 *                              you to add --force.
 *   gen/set-shape --force   -> calls the real API, then caches the result.
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { VectorResult, ProviderId } from "./types";

const SHAPES_DIR = path.resolve(process.cwd(), "shapes");
const CACHE_DIR = path.join(SHAPES_DIR, "cache");
const LIBRARY_DIR = path.join(SHAPES_DIR, "library");

const ensureDirs = () => {
  for (const d of [SHAPES_DIR, CACHE_DIR, LIBRARY_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
};

/** Stable key for a (provider, prompt) pair. */
const cacheKey = (provider: ProviderId, prompt: string): string => {
  const h = crypto
    .createHash("sha1")
    .update(`${provider}::${prompt.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
  return `${provider}-${h}`;
};

const cachePath = (provider: ProviderId, prompt: string): string =>
  path.join(CACHE_DIR, `${cacheKey(provider, prompt)}.json`);

/** A cached generation — the VectorResult minus the bulky rawSvg. */
type CachedShape = Omit<VectorResult, "rawSvg"> & { prompt: string };

/** Look up a cached result. Returns null on miss. */
export const getCached = (
  provider: ProviderId,
  prompt: string,
): CachedShape | null => {
  ensureDirs();
  const p = cachePath(provider, prompt);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as CachedShape;
  } catch {
    return null;
  }
};

/** Store a real generation in the cache for free reuse later. */
export const putCached = (
  provider: ProviderId,
  prompt: string,
  result: VectorResult,
): void => {
  ensureDirs();
  const { rawSvg: _rawSvg, ...rest } = result;
  const entry: CachedShape = { ...rest, prompt };
  fs.writeFileSync(cachePath(provider, prompt), JSON.stringify(entry, null, 2));
};

// --- library (named, curated) ----------------------------------------------

export type LibraryShape = { name: string; d: string; fill: string | null };

/** A library file: { d, fill } JSON, named <name>.json. */
export const getLibraryShape = (name: string): LibraryShape | null => {
  ensureDirs();
  const p = path.join(LIBRARY_DIR, `${name}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return { name, d: j.d, fill: j.fill ?? null };
  } catch {
    return null;
  }
};

export const putLibraryShape = (
  name: string,
  d: string,
  fill: string | null,
): void => {
  ensureDirs();
  fs.writeFileSync(
    path.join(LIBRARY_DIR, `${name}.json`),
    JSON.stringify({ d, fill }, null, 2),
  );
};

/** List everything available offline — for the CLI and the editor picker. */
export const listShapes = (): {
  cache: { key: string; provider: string; prompt: string }[];
  library: string[];
} => {
  ensureDirs();
  const cache = fs
    .readdirSync(CACHE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const j = JSON.parse(
          fs.readFileSync(path.join(CACHE_DIR, f), "utf8"),
        );
        return {
          key: f.replace(/\.json$/, ""),
          provider: j.provider ?? "?",
          prompt: j.prompt ?? "?",
        };
      } catch {
        return { key: f, provider: "?", prompt: "?" };
      }
    });
  const library = fs
    .readdirSync(LIBRARY_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
  return { cache, library };
};

export const SHAPES_PATHS = {
  root: SHAPES_DIR,
  cache: CACHE_DIR,
  library: LIBRARY_DIR,
};
