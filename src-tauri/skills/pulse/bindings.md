# Pulse bindings

A binding modulates an effect param with a live music feature:

```ts
{ param, source: { stem, feature }, amount, curve, offset }
```

- `param` — the effect param it drives (must be one of that effect's params).
- `source.stem` — a stem id (e.g. `stem-00`) or `"master"` (the whole mix).
- `source.feature` — one of: `level`, `bandLow`, `bandMid`, `bandHigh`,
  `onset`, `tempoPhase`, `brightness`, `flux`.
- `amount` — gain applied to the feature.
- `curve` — `linear | exp | log | smooth` shaping of the feature value.
- `offset` — added after shaping.

Resolved value = `base + Σ (shape(feature, curve) * amount + offset) * stemVolume`.
Crucially the stem's **volume scales the binding**, so lowering a stem's volume
shrinks the visual contribution of effects bound to it (volume = visual
amplitude, not just loudness).

Edit bindings in `project.json` under `decks.A.effects[i].bindings` (or `B`).
Preserve any binding marked `"locked": true`.
