import type { AxisKey, DialAxis, DialState, Delta } from "./types";

export const DIAL_AXES: DialAxis[] = [
  { key: "temperature", label: "Temperature", minLabel: "cooler", maxLabel: "warmer" },
  { key: "contrast", label: "Contrast", minLabel: "hushed", maxLabel: "punchy" },
  { key: "density", label: "Density", minLabel: "airy", maxLabel: "packed" },
  { key: "softness", label: "Softness", minLabel: "sharp", maxLabel: "rounded" },
  { key: "character", label: "Character", minLabel: "neutral", maxLabel: "expressive" },
  { key: "weight", label: "Weight", minLabel: "light", maxLabel: "bold" },
];

const KEYS = DIAL_AXES.map((a) => a.key) as AxisKey[];
const clamp3 = (n: number) => Math.min(3, Math.max(-3, Math.round(n)));

export const emptyState = (): DialState =>
  KEYS.reduce((s, k) => ((s[k] = 0), s), {} as DialState);

export const clampState = (s: DialState): DialState =>
  KEYS.reduce((o, k) => ((o[k] = clamp3(s[k] ?? 0)), o), {} as DialState);

export const mergeDeltas = (base: DialState, deltas: Delta[]): DialState => {
  const out = { ...base };
  for (const d of deltas) for (const k of KEYS) out[k] = (out[k] ?? 0) + (d[k] ?? 0);
  return clampState(out);
};

export const PRESETS: Record<string, DialState> = {
  default: emptyState(),
  editorial: clampState({ ...emptyState(), density: 2, character: 1, contrast: 1, softness: -1 }),
  brutalist: clampState({ ...emptyState(), contrast: 3, softness: -3, density: -1, character: -1 }),
  "soft-saas": clampState({ ...emptyState(), softness: 2, density: 1, character: 1, contrast: -1 }),
  terminal: clampState({ ...emptyState(), density: -2, softness: -2, contrast: 2, temperature: 1 }),
};
