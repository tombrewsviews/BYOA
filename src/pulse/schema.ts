// src/pulse/schema.ts
import { z } from "zod";

export const stemRoleSchema = z.enum([
  "kick", "bass", "drums", "harmony", "lead", "vocal", "fx", "unknown",
]);
export type StemRole = z.infer<typeof stemRoleSchema>;

export const featureSchema = z.enum([
  "level", "bandLow", "bandMid", "bandHigh", "onset", "tempoPhase", "brightness", "flux",
]);
export type Feature = z.infer<typeof featureSchema>;

export const bindingSchema = z.object({
  param: z.string(),
  source: z.object({ stem: z.string(), feature: featureSchema }),
  amount: z.number(),
  curve: z.enum(["linear", "exp", "log", "smooth"]).default("linear"),
  offset: z.number().default(0),
});
export type Binding = z.infer<typeof bindingSchema>;

export const effectInstanceSchema = z.object({
  id: z.string(),
  type: z.string(),
  enabled: z.boolean().default(true),
  locked: z.boolean().default(false),
  params: z.record(z.string(), z.number()).default({}),
  bindings: z.array(bindingSchema).default([]),
});
export type EffectInstance = z.infer<typeof effectInstanceSchema>;

export const deckSchema = z.object({ effects: z.array(effectInstanceSchema).default([]) });
export type Deck = z.infer<typeof deckSchema>;

export const stemSchema = z.object({
  id: z.string(),
  file: z.string(),
  label: z.string(),
  role: stemRoleSchema,
  volume: z.number().min(0).max(1),
  muted: z.boolean().default(false),
});
export type Stem = z.infer<typeof stemSchema>;

export const mixSchema = z.object({
  active: z.enum(["A", "B", "transitioning"]).default("A"),
  template: z.enum(["cut", "crossfade", "progressive", "seesaw", "fast", "slow", "morphParams"]).default("crossfade"),
  durationSec: z.number().default(4),
  curve: z.enum(["linear", "ease", "exp", "seesaw", "step"]).default("ease"),
  progress: z.number().min(0).max(1).default(0),
});
export type MixState = z.infer<typeof mixSchema>;

export const pulseProjectSchema = z.object({
  version: z.literal(1),
  song: z.object({
    sourceFolder: z.string(),
    durationSec: z.number().default(0),
    tempoBpm: z.number().default(0),
  }),
  stems: z.array(stemSchema).default([]),
  decks: z.object({ A: deckSchema, B: deckSchema }),
  mix: mixSchema,
});
export type PulseProject = z.infer<typeof pulseProjectSchema>;

export function seedProject(sourceFolder: string): PulseProject {
  return {
    version: 1,
    song: { sourceFolder, durationSec: 0, tempoBpm: 0 },
    stems: [],
    decks: { A: { effects: [] }, B: { effects: [] } },
    mix: { active: "A", template: "crossfade", durationSec: 4, curve: "ease", progress: 0 },
  };
}
