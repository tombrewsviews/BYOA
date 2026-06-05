import type { Delta, DialState, AxisKey } from "./types";

const AXES: AxisKey[] = ["temperature","contrast","density","softness","character","weight"];
const clamp3 = (n: number) => Math.min(3, Math.max(-3, Math.round(n)));

/** Parse + validate the agent's JSON-delta response. Pure; unit-testable. */
export function validateDeltaResponse(raw: string): Delta | null {
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  const out: Delta = {};
  for (const k of AXES) {
    const v = (obj as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = clamp3(v);
  }
  return Object.keys(out).length ? out : null;
}

export function buildPrompt(phrase: string, state: DialState): string {
  return [
    "You map a short design phrase to adjustments on six design dials.",
    "Axes (each integer -3..+3): temperature(cool..warm), contrast(hushed..punchy),",
    "density(airy..packed), softness(sharp..rounded), character(neutral..expressive), weight(light..bold).",
    `Current state: ${JSON.stringify(state)}.`,
    `Phrase: "${phrase}".`,
    "Respond with ONLY a JSON object of the axes to ADJUST (deltas), e.g. {\"temperature\":1,\"density\":-1}.",
    "No prose, no hex colors.",
  ].join("\n");
}

/** Single-shot call. Returns null if no transport is wired (fallback ships
 *  disabled; lexicon-only stands). */
export async function proposeDeltas(
  phrase: string,
  state: DialState,
  transport?: (prompt: string) => Promise<string>,
): Promise<Delta | null> {
  if (!transport) return null;
  try {
    const raw = await transport(buildPrompt(phrase, state));
    return validateDeltaResponse(raw);
  } catch {
    return null;
  }
}
