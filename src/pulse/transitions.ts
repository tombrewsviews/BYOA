// src/pulse/transitions.ts
import type { Deck, EffectInstance, MixState } from "./schema";

export type Curve = MixState["curve"];
export type Template = MixState["template"];

// Reshape normalized progress t (0..1) by a curve.
export function shapeCurve(t: number, curve: Curve): number {
  const x = Math.max(0, Math.min(1, t));
  switch (curve) {
    case "linear": return x;
    case "ease": return x * x * (3 - 2 * x);
    case "exp": return x * x;
    case "seesaw": return 0.5 - 0.5 * Math.cos(x * Math.PI); // smooth settle
    case "step": return x < 0.5 ? 0 : 1;
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Interpolate numeric params of matching effects (by id, else by index).
function morphEffect(a: EffectInstance | undefined, b: EffectInstance | undefined, t: number): EffectInstance | null {
  if (a && b) {
    const params: Record<string, number> = { ...a.params };
    for (const k of Object.keys({ ...a.params, ...b.params })) {
      params[k] = lerp(a.params[k] ?? b.params[k] ?? 0, b.params[k] ?? a.params[k] ?? 0, t);
    }
    // bindings: take B's once past halfway (they're structural, not numeric).
    return { ...(t < 0.5 ? a : b), params, bindings: (t < 0.5 ? a : b).bindings };
  }
  // Effect exists on only one side → fade it via an _alpha param the shaders read.
  const only = a ?? b!;
  const present = a ? 1 - t : t; // A-only fades out, B-only fades in
  return { ...only, params: { ...only.params, _alpha: present } };
}

// Produce the deck to render at progress t for a given template.
export function blendDecks(a: Deck, b: Deck, t: number, template: Template): Deck {
  if (template === "cut") return t < 0.5 ? a : b;
  // crossfade/fast/slow render both decks alpha-mixed; the Renderer handles
  // the alpha. For deck-data purposes they behave like morphParams with an
  // overall _mix param the Renderer reads. We tag the deck with _mix on each
  // effect so the Stage can alpha-blend passes.
  if (template === "crossfade" || template === "fast" || template === "slow") {
    const tagged = (d: Deck, alpha: number): EffectInstance[] =>
      d.effects.map((e) => ({ ...e, params: { ...e.params, _alpha: alpha } }));
    return { effects: [...tagged(a, 1 - t), ...tagged(b, t)] };
  }
  if (template === "progressive") {
    // Stagger: effect i hands off in its own [i/n .. (i+1)/n] window.
    const n = Math.max(a.effects.length, b.effects.length);
    const out: EffectInstance[] = [];
    for (let i = 0; i < n; i++) {
      const lo = i / n, hi = (i + 1) / n;
      const local = Math.max(0, Math.min(1, (t - lo) / Math.max(1e-6, hi - lo)));
      const e = morphEffect(a.effects[i], b.effects[i], local);
      if (e) out.push(e);
    }
    return { effects: out };
  }
  if (template === "seesaw") {
    const s = shapeCurve(t, "seesaw");
    const n = Math.max(a.effects.length, b.effects.length);
    const out: EffectInstance[] = [];
    for (let i = 0; i < n; i++) {
      const e = morphEffect(a.effects[i], b.effects[i], s);
      if (e) out.push(e);
    }
    return { effects: out };
  }
  // morphParams (default)
  const n = Math.max(a.effects.length, b.effects.length);
  const out: EffectInstance[] = [];
  for (let i = 0; i < n; i++) {
    const e = morphEffect(a.effects[i], b.effects[i], t);
    if (e) out.push(e);
  }
  return { effects: out };
}
