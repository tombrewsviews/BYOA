import type { Delta } from "./types";

/** Pre-built word nudges. The lexicon is the navigation aid: each word is a
 *  small, predictable move so users discover the language by trying words.
 *  Multi-axis words act as mini-presets. */
export const LEXICON: Record<string, Delta> = {
  // temperature
  warmer: { temperature: 1 }, warm: { temperature: 1 }, cozier: { temperature: 2 },
  cooler: { temperature: -1 }, cool: { temperature: -1 }, icy: { temperature: -2 },
  // contrast
  punchier: { contrast: 1 }, punchy: { contrast: 1 }, bolder: { contrast: 1, weight: 1 },
  hushed: { contrast: -1 }, softer: { contrast: -1, softness: 1 }, calmer: { contrast: -1 },
  // density
  airier: { density: -1 }, airy: { density: -1 }, spacious: { density: -2 }, roomier: { density: -1 },
  denser: { density: 1 }, packed: { density: 2 }, compact: { density: 1 }, tighter: { density: 1 },
  // softness
  rounder: { softness: 1 }, rounded: { softness: 1 }, pill: { softness: 3 },
  sharper: { softness: -1 }, sharp: { softness: -1 }, crisp: { softness: -1 },
  // character
  expressive: { character: 2 }, vivid: { character: 2 }, vibrant: { character: 2 },
  muted: { character: -2 }, neutral: { character: -1 }, restrained: { character: -1 },
  // multi-axis "mini presets"
  editorial: { density: 2, character: 1, contrast: 1, softness: -1 },
  brutalist: { contrast: 3, softness: -3, character: -1 },
  terminal: { density: -2, softness: -2, contrast: 2 },
};

const FILLER = new Set(["a","an","the","it","is","more","less","and","feel","make","very","bit","touch","of","to","like","please","just"]);

export function parsePhrase(text: string): { deltas: Delta[]; unknownWords: string[] } {
  const words = text.toLowerCase().replace(/[^a-z\s-]/g, "").split(/\s+/).filter(Boolean);
  const deltas: Delta[] = [];
  const unknownWords: string[] = [];
  for (const w of words) {
    if (FILLER.has(w)) continue;
    if (LEXICON[w]) deltas.push(LEXICON[w]);
    else unknownWords.push(w);
  }
  return { deltas, unknownWords };
}
