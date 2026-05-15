/**
 * The VectorProvider contract — the plugin point of the product.
 *
 * Every source of SVG shapes (Recraft API, Claude API, a local Ollama
 * model, hand-written) implements this ONE interface. They all take a
 * text prompt and return a normalized shape path (0..100 box) plus
 * metadata used for the benchmark/comparison view.
 *
 * Adding a model = adding one file that implements VectorProvider.
 * Nothing downstream changes.
 */

export type ProviderId = "recraft" | "claude" | "ollama" | "handwritten";

export type VectorResult = {
  /** the shape as a single SVG path `d`, normalized to a 0..100 viewBox */
  d: string;
  /**
   * the fill color the provider gave the shape (hex), or null if none.
   * Carried through so the kinetic engine renders the shape in its real
   * color instead of flattening everything to one color.
   */
  fill: string | null;
  /** which provider produced it */
  provider: ProviderId;
  /** the model/identifier used (e.g. "recraftv4_1_vector", "qwen2.5-coder") */
  model: string;
  /** benchmark metrics — this is what the comparison view scores on */
  metrics: {
    /** wall-clock time for the generation call, ms */
    latencyMs: number;
    /** node/command count of the chosen path — lower morphs cleaner */
    nodeCount: number;
    /** how many <path> elements the raw SVG had (1-2 ideal; high = messy) */
    rawPathCount: number;
    /** cost in USD if known (Recraft bills per image), else null */
    costUsd: number | null;
  };
  /** the raw SVG markup, kept for debugging / the comparison view */
  rawSvg: string;
};

export type VectorProvider = {
  id: ProviderId;
  /** human label for the UI */
  label: string;
  /** true if this provider can actually run (key present / service up) */
  isAvailable: () => boolean | Promise<boolean>;
  /**
   * Generate a vector shape from a prompt. Should throw on hard failure
   * (no key, network error) so the caller can mark the provider failed in
   * a benchmark run rather than silently producing garbage.
   */
  generate: (prompt: string) => Promise<VectorResult>;
};

/** Shared prompt scaffolding — every provider benefits from asking for
 *  the SAME thing: a clean, low-node, single-shape, morph-friendly path.
 *  Centralized so the benchmark stays fair across providers. */
export const SHAPE_PROMPT_GUIDANCE =
  "a single minimal geometric shape, one closed path, very few anchor points, " +
  "flat solid color, no detail, no text, no background — designed to morph " +
  "cleanly into a letterform";
