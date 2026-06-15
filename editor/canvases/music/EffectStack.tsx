import React from "react";
import { EFFECTS, effectTypes } from "../../../src/pulse/effects/registry";
import type { PulseProject, Deck, Stem, Binding, Feature } from "../../../src/pulse/schema";
import { Button } from "@/components/ui/button";

const FEATURES: Feature[] = [
  "level",
  "bandLow",
  "bandMid",
  "bandHigh",
  "onset",
  "tempoPhase",
  "brightness",
  "flux",
];

/**
 * Effect-stack editor for one deck: add/remove/reorder effects, toggle
 * enable/lock, edit static params, and edit music-feature → param
 * bindings. All edits flow through `onChange` as immutable PulseProject
 * updates on `decks[deckKey]`.
 */
export const EffectStack: React.FC<{
  project: PulseProject;
  deckKey: "A" | "B";
  onChange: (next: PulseProject | ((p: PulseProject) => PulseProject)) => void;
}> = ({ project, deckKey, onChange }) => {
  const deck: Deck = project.decks[deckKey];
  const stems: Stem[] = project.stems;

  const setDeck = (fn: (d: Deck) => Deck) =>
    onChange((p) => ({ ...p, decks: { ...p.decks, [deckKey]: fn(p.decks[deckKey]) } }));

  const addEffect = (type: string) =>
    setDeck((d) => ({
      effects: [
        ...d.effects,
        {
          id: `${type}-${d.effects.length}-${d.effects.reduce((n, e) => n + e.id.length, 0)}`,
          type,
          enabled: true,
          locked: false,
          params: Object.fromEntries(EFFECTS[type].params.map((s) => [s.name, s.default])),
          bindings: [],
        },
      ],
    }));

  const update = (
    i: number,
    fn: (e: Deck["effects"][number]) => Deck["effects"][number],
  ) => setDeck((d) => ({ effects: d.effects.map((e, j) => (j === i ? fn(e) : e)) }));

  const remove = (i: number) =>
    setDeck((d) => ({ effects: d.effects.filter((_, j) => j !== i) }));

  const move = (i: number, dir: -1 | 1) =>
    setDeck((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.effects.length) return d;
      const e = [...d.effects];
      [e[i], e[j]] = [e[j], e[i]];
      return { effects: e };
    });

  return (
    <div style={{ fontSize: 12, color: "#bbb" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ fontWeight: 600, color: "#ddd" }}>Deck {deckKey} effects</span>
        <select
          value=""
          onChange={(e) => e.target.value && addEffect(e.target.value)}
          style={{ marginLeft: "auto" }}
        >
          <option value="">+ add effect…</option>
          {effectTypes.map((t) => (
            <option key={t} value={t}>
              {EFFECTS[t].label}
            </option>
          ))}
        </select>
      </div>
      {deck.effects.length === 0 && <div style={{ color: "#666" }}>No effects.</div>}
      {deck.effects.map((eff, i) => (
        <div key={eff.id} style={{ border: "1px solid #222", borderRadius: 6, padding: 6, marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={eff.enabled}
              onChange={(e) => update(i, (x) => ({ ...x, enabled: e.target.checked }))}
            />
            <span style={{ flex: 1, color: "#ddd" }}>{EFFECTS[eff.type]?.label ?? eff.type}</span>
            <Button title="lock" variant="ghost" size="icon-xs" onClick={() => update(i, (x) => ({ ...x, locked: !x.locked }))}>
              {eff.locked ? "🔒" : "🔓"}
            </Button>
            <Button title="move up" variant="ghost" size="icon-xs" onClick={() => move(i, -1)}>↑</Button>
            <Button title="move down" variant="ghost" size="icon-xs" onClick={() => move(i, 1)}>↓</Button>
            <Button title="remove" variant="ghost" size="icon-xs" onClick={() => remove(i)}>✕</Button>
          </div>
          {(EFFECTS[eff.type]?.params ?? []).map((spec) => (
            <div key={spec.name} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <span style={{ width: 90 }}>{spec.name}</span>
              <input
                type="range"
                min={spec.min}
                max={spec.max}
                step={spec.step}
                value={eff.params[spec.name] ?? spec.default}
                onChange={(e) =>
                  update(i, (x) => ({ ...x, params: { ...x.params, [spec.name]: Number(e.target.value) } }))
                }
              />
              <span style={{ width: 40, textAlign: "right" }}>
                {(eff.params[spec.name] ?? spec.default).toFixed(2)}
              </span>
            </div>
          ))}
          <div style={{ marginTop: 6, color: "#8ab", display: "flex", alignItems: "center", gap: 8 }}>
            bindings
            <Button
              variant="outline"
              size="xs"
              onClick={() =>
                update(i, (x) => ({
                  ...x,
                  bindings: [
                    ...x.bindings,
                    {
                      param: EFFECTS[x.type]?.params[0]?.name ?? "",
                      source: { stem: "master", feature: "level" },
                      amount: 1,
                      curve: "linear",
                      offset: 0,
                    },
                  ],
                }))
              }
            >
              + bind
            </Button>
          </div>
          {eff.bindings.map((b, bi) => {
            const setB = (fn: (b: Binding) => Binding) =>
              update(i, (x) => ({ ...x, bindings: x.bindings.map((y, j) => (j === bi ? fn(y) : y)) }));
            return (
              <div key={bi} style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap", alignItems: "center" }}>
                <select value={b.param} onChange={(e) => setB((y) => ({ ...y, param: e.target.value }))}>
                  {(EFFECTS[eff.type]?.params ?? []).map((s) => (
                    <option key={s.name}>{s.name}</option>
                  ))}
                </select>
                <select
                  value={b.source.stem}
                  onChange={(e) => setB((y) => ({ ...y, source: { ...y.source, stem: e.target.value } }))}
                >
                  <option value="master">master</option>
                  {stems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <select
                  value={b.source.feature}
                  onChange={(e) =>
                    setB((y) => ({ ...y, source: { ...y.source, feature: e.target.value as Feature } }))
                  }
                >
                  {FEATURES.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
                <input
                  style={{ width: 48 }}
                  type="number"
                  step={0.1}
                  value={b.amount}
                  onChange={(e) => setB((y) => ({ ...y, amount: Number(e.target.value) }))}
                />
                <select
                  value={b.curve}
                  onChange={(e) => setB((y) => ({ ...y, curve: e.target.value as Binding["curve"] }))}
                >
                  <option>linear</option>
                  <option>exp</option>
                  <option>log</option>
                  <option>smooth</option>
                </select>
                <Button variant="ghost" size="icon-xs" onClick={() => update(i, (x) => ({ ...x, bindings: x.bindings.filter((_, j) => j !== bi) }))}>
                  ✕
                </Button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};
