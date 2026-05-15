/**
 * Claude provider — the LLM emits SVG path markup directly.
 *
 * This is NOT a special model: we prompt the Anthropic Messages API for
 * clean SVG. As argued earlier, an LLM writing deliberate, sparse geometry
 * is often the BEST source for morphing — far better than raster-traced
 * output, because flubber needs low node counts.
 *
 * Needs ANTHROPIC_API_KEY. NOTE: a Claude Max subscription does NOT cover
 * API usage — this is billed separately. If no key is set, isAvailable()
 * returns false and the benchmark just skips this provider.
 *
 * No SDK dependency — the Messages API is a single fetch.
 */
import type { VectorProvider, VectorResult } from "./types";
import { SHAPE_PROMPT_GUIDANCE } from "./types";
import { extractShapePath } from "./svg-extract";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-7";

// Pricing changes; left null so the benchmark doesn't report a stale cost.
// Wire a real token-based estimate later if you want cost in the compare view.
const COST_USD = null;

const SYSTEM = `You generate SVG vector shapes for a kinetic-typography tool.
Rules:
- Output ONLY a single <svg>...</svg> element. No prose, no markdown fences.
- Use viewBox="0 0 100 100".
- Exactly ONE <path> element — one closed shape, no background rect.
- Keep it SIMPLE: very few anchor points, prefer C/Q curves over many L's.
- Flat single fill color. No gradients, no text, no groups.
The shape must morph cleanly into a letterform, so low node count is critical.`;

/** Strip anything around the <svg> block — LLMs sometimes add prose. */
const isolateSvg = (text: string): string => {
  const m = text.match(/<svg[\s\S]*?<\/svg>/i);
  return m ? m[0] : text;
};

export const claudeProvider: VectorProvider = {
  id: "claude",
  label: "Claude (SVG via prompt)",

  isAvailable: () => Boolean(process.env.ANTHROPIC_API_KEY),

  generate: async (prompt: string): Promise<VectorResult> => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error(
        "ANTHROPIC_API_KEY not set (.env). Note: Claude Max does not cover API usage.",
      );
    }

    const started = Date.now();
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `Shape to draw: ${prompt}. ${SHAPE_PROMPT_GUIDANCE}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      content?: { type: string; text?: string }[];
    };
    const text = json.content?.find((c) => c.type === "text")?.text ?? "";
    const rawSvg = isolateSvg(text);
    const latencyMs = Date.now() - started;

    const extracted = extractShapePath(rawSvg);
    if (!extracted) {
      throw new Error(
        `Claude output had no usable <path>. Got: ${text.slice(0, 120)}`,
      );
    }

    return {
      d: extracted.d,
      fill: extracted.fill,
      provider: "claude",
      model: MODEL,
      metrics: {
        latencyMs,
        nodeCount: extracted.nodeCount,
        rawPathCount: extracted.pathCount,
        costUsd: COST_USD,
      },
      rawSvg,
    };
  },
};
