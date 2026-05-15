/**
 * Ollama provider — a LOCAL model emits SVG path markup.
 *
 * This is the "test local vector models" angle of the product. It hits a
 * local Ollama server (default http://localhost:11434) with a code-capable
 * model (default qwen2.5-coder) and asks for SVG markup — the exact same
 * technique as the Claude provider, just running on your machine for free.
 *
 * The benchmark value: same prompt, same extraction, same morph test —
 * so you can put a local model head-to-head against Recraft and Claude
 * and SEE (and score) where it falls short. That's the harness.
 *
 * isAvailable() does a quick reachability check so the benchmark skips
 * Ollama gracefully when it isn't running.
 *
 * Setup: `ollama pull qwen2.5-coder:7b` (or set OLLAMA_MODEL to another).
 */
import type { VectorProvider, VectorResult } from "./types";
import { SHAPE_PROMPT_GUIDANCE } from "./types";
import { extractShapePath } from "./svg-extract";

const baseUrl = () => process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const model = () => process.env.OLLAMA_MODEL || "qwen2.5-coder:7b";

const SYSTEM = `You are an SVG generator for a kinetic-typography tool.
Output ONLY a single <svg viewBox="0 0 100 100">...</svg> with exactly ONE
<path> — one simple closed shape, very few points, flat fill, no background,
no text. The shape must morph cleanly into a letter, so keep node count low.
No explanation, no markdown fences — just the <svg> element.`;

const isolateSvg = (text: string): string => {
  const m = text.match(/<svg[\s\S]*?<\/svg>/i);
  return m ? m[0] : text;
};

export const ollamaProvider: VectorProvider = {
  id: "ollama",
  label: `Ollama (local: ${model()})`,

  isAvailable: async () => {
    try {
      // /api/tags is cheap and confirms the server is up.
      const res = await fetch(`${baseUrl()}/api/tags`, {
        signal: AbortSignal.timeout(1500),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  generate: async (prompt: string): Promise<VectorResult> => {
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(`${baseUrl()}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: model(),
          stream: false,
          messages: [
            { role: "system", content: SYSTEM },
            {
              role: "user",
              content: `Shape to draw: ${prompt}. ${SHAPE_PROMPT_GUIDANCE}`,
            },
          ],
        }),
      });
    } catch (e) {
      throw new Error(
        `Ollama unreachable at ${baseUrl()} — is \`ollama serve\` running? (${
          (e as Error).message
        })`,
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Ollama ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as { message?: { content?: string } };
    const text = json.message?.content ?? "";
    const rawSvg = isolateSvg(text);
    const latencyMs = Date.now() - started;

    const extracted = extractShapePath(rawSvg);
    if (!extracted) {
      throw new Error(
        `Ollama (${model()}) output had no usable <path>. This is a common ` +
          `local-model failure — exactly what the benchmark surfaces. ` +
          `Got: ${text.slice(0, 120)}`,
      );
    }

    return {
      d: extracted.d,
      fill: extracted.fill,
      provider: "ollama",
      model: model(),
      metrics: {
        latencyMs,
        nodeCount: extracted.nodeCount,
        rawPathCount: extracted.pathCount,
        costUsd: 0, // local = free
      },
      rawSvg,
    };
  },
};
