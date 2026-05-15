/**
 * Recraft V4 Vector provider — REAL API, verified working.
 *
 * Recraft's vector models return an actual SVG file (not a raster). Flow:
 *   POST /v1/images/generations { model: recraftv4_1_vector, prompt }
 *     -> { data: [{ url }] }   (url points to an .svg)
 *   GET url -> raw SVG markup
 *   extractShapePath() -> normalized 0..100 `d`
 *
 * The returned SVG is clean (verified: ~12-node bézier paths + a bg rect),
 * which is exactly the morph-friendly geometry the kinetic engine needs.
 *
 * Key is read from RECRAFT_API_KEY (loaded from .env by the CLI). Never
 * hard-code it.
 */
import type { VectorProvider, VectorResult } from "./types";
import { SHAPE_PROMPT_GUIDANCE } from "./types";
import { extractShapePath } from "./svg-extract";

const ENDPOINT = "https://external.api.recraft.ai/v1/images/generations";
// recraftv4_1_vector is the standard V4 vector model. Swap to a *_pro_*
// variant for higher quality at higher cost.
const MODEL = "recraftv4_1_vector";
// Recraft bills per generated image; v4 vector is ~$0.08/image (from the
// pricing card). Kept here so the benchmark can report cost.
const COST_PER_IMAGE_USD = 0.08;

export const recraftProvider: VectorProvider = {
  id: "recraft",
  label: "Recraft V4 Vector",

  isAvailable: () => Boolean(process.env.RECRAFT_API_KEY),

  generate: async (prompt: string): Promise<VectorResult> => {
    const key = process.env.RECRAFT_API_KEY;
    if (!key) {
      throw new Error("RECRAFT_API_KEY not set (.env)");
    }

    const fullPrompt = `${prompt}. ${SHAPE_PROMPT_GUIDANCE}`;
    const started = Date.now();

    const genRes = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: fullPrompt,
        model: MODEL,
        n: 1,
        size: "1024x1024",
      }),
    });

    if (!genRes.ok) {
      const body = await genRes.text().catch(() => "");
      throw new Error(`Recraft API ${genRes.status}: ${body.slice(0, 200)}`);
    }

    const json = (await genRes.json()) as { data?: { url?: string }[] };
    const url = json.data?.[0]?.url;
    if (!url) throw new Error("Recraft response had no image url");

    // The url points to an SVG file — fetch the actual markup.
    const svgRes = await fetch(url);
    if (!svgRes.ok) {
      throw new Error(`Recraft SVG fetch failed: ${svgRes.status}`);
    }
    const rawSvg = await svgRes.text();
    const latencyMs = Date.now() - started;

    const extracted = extractShapePath(rawSvg);
    if (!extracted) {
      throw new Error("Could not extract a shape path from Recraft SVG");
    }

    return {
      d: extracted.d,
      fill: extracted.fill,
      provider: "recraft",
      model: MODEL,
      metrics: {
        latencyMs,
        nodeCount: extracted.nodeCount,
        rawPathCount: extracted.pathCount,
        costUsd: COST_PER_IMAGE_USD,
      },
      rawSvg,
    };
  },
};
