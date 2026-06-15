import React, { useState } from "react";
import type { PulseProject, Deck, EffectInstance, Binding, Feature } from "../../../src/pulse/schema";
import { EFFECTS, effectTypes } from "../../../src/pulse/effects/registry";
import { EFFECT_HELP, STACK_TIP } from "../../../src/pulse/effects/help";
import { Button } from "@/components/ui/button";

const FEATURES: Feature[] = [
  "level", "bandLow", "bandMid", "bandHigh", "onset", "tempoPhase", "brightness", "flux",
];

/**
 * Reason-style stacked rack. One accordion "deck" per stem (plus a Master
 * deck for master-bound effects). Each deck shows the stem's audio level
 * and, expanded, the effects whose first binding targets that stem — with
 * their param sliders, bindings, and an in-context explanation.
 *
 * The render order is still the flat Deck A stack (effects composite over
 * each other); this UI just groups the *editing* of those effects by the
 * stem that drives them, the way a DAW groups inserts under a track.
 */
export const StemRack: React.FC<{
  project: PulseProject;
  onChange: (next: PulseProject | ((p: PulseProject) => PulseProject)) => void;
}> = ({ project, onChange }) => {
  const deck: Deck = project.decks.A;

  // Which stem "owns" an effect = the stem id of its first binding, else master.
  const ownerOf = (e: EffectInstance): string => e.bindings[0]?.source.stem ?? "master";

  const setDeck = (fn: (d: Deck) => Deck) =>
    onChange((p) => ({ ...p, decks: { ...p.decks, A: fn(p.decks.A) } }));

  const addEffectFor = (stemId: string, type: string) =>
    setDeck((d) => ({
      effects: [
        ...d.effects,
        {
          id: `${type}-${d.effects.length}-${Math.round(d.effects.reduce((n, e) => n + e.id.length, 1))}`,
          type,
          enabled: true,
          locked: false,
          params: Object.fromEntries(EFFECTS[type].params.map((s) => [s.name, s.default])),
          // Seed a binding to this stem so the effect lands in this rack row.
          bindings: [
            {
              param: EFFECTS[type].params[0]?.name ?? "",
              source: { stem: stemId, feature: "level" },
              amount: 1,
              curve: "linear",
              offset: 0,
            },
          ],
        },
      ],
    }));

  const updateEffect = (id: string, fn: (e: EffectInstance) => EffectInstance) =>
    setDeck((d) => ({ effects: d.effects.map((e) => (e.id === id ? fn(e) : e)) }));
  const removeEffect = (id: string) =>
    setDeck((d) => ({ effects: d.effects.filter((e) => e.id !== id) }));

  const decks: { id: string; label: string; role: string }[] = [
    ...project.stems.map((s) => ({ id: s.id, label: s.label, role: s.role })),
    { id: "master", label: "Master (whole mix)", role: "master" },
  ];

  return (
    <div style={{ fontSize: 12, color: "#bbb" }}>
      <div style={{ padding: "8px 4px", color: "#888", lineHeight: 1.5, borderBottom: "1px solid #1c1c1c" }}>
        {STACK_TIP}
      </div>
      {decks.map((d) => {
        const stem = project.stems.find((s) => s.id === d.id) ?? null;
        const owned = deck.effects.filter((e) => ownerOf(e) === d.id);
        return (
          <StemDeck
            key={d.id}
            id={d.id}
            label={d.label}
            role={d.role}
            stemVolume={stem?.volume ?? 1}
            stemMuted={stem?.muted ?? false}
            isStem={!!stem}
            effects={owned}
            stems={project.stems}
            onVolume={(v) =>
              onChange((p) => ({ ...p, stems: p.stems.map((s) => (s.id === d.id ? { ...s, volume: v } : s)) }))
            }
            onMute={(m) =>
              onChange((p) => ({ ...p, stems: p.stems.map((s) => (s.id === d.id ? { ...s, muted: m } : s)) }))
            }
            onAddEffect={(type) => addEffectFor(d.id, type)}
            onUpdateEffect={updateEffect}
            onRemoveEffect={removeEffect}
          />
        );
      })}
    </div>
  );
};

const StemDeck: React.FC<{
  id: string;
  label: string;
  role: string;
  stemVolume: number;
  stemMuted: boolean;
  isStem: boolean;
  effects: EffectInstance[];
  stems: PulseProject["stems"];
  onVolume: (v: number) => void;
  onMute: (m: boolean) => void;
  onAddEffect: (type: string) => void;
  onUpdateEffect: (id: string, fn: (e: EffectInstance) => EffectInstance) => void;
  onRemoveEffect: (id: string) => void;
}> = ({
  id, label, role, stemVolume, stemMuted, isStem, effects, stems,
  onVolume, onMute, onAddEffect, onUpdateEffect, onRemoveEffect,
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid #1c1c1c", background: "#0c0c0c" }}>
      {/* Deck header row — like a DAW track strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 6px" }}>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{ width: 16, background: "transparent", border: 0, color: "#888", cursor: "pointer" }}
          title={open ? "collapse" : "expand"}
        >
          {open ? "▾" : "▸"}
        </button>
        {isStem && (
          <input type="checkbox" title="mute" checked={!stemMuted} onChange={(e) => onMute(!e.target.checked)} />
        )}
        <span style={{ width: 56, color: "#6a9", fontVariant: "small-caps", fontSize: 11 }}>{role}</span>
        <span style={{ flex: 1, color: "#ddd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        {effects.length > 0 && (
          <span style={{ color: "#567", fontSize: 11 }}>{effects.length} fx</span>
        )}
        {isStem && (
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={stemVolume}
            onChange={(e) => onVolume(Number(e.target.value))}
            style={{ width: 90 }}
            title="audio level (also scales visual amplitude)"
          />
        )}
      </div>

      {open && (
        <div style={{ padding: "0 8px 10px 30px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span style={{ color: "#888" }}>effects driven by this {isStem ? "stem" : "group"}</span>
            <select
              value=""
              onChange={(e) => e.target.value && onAddEffect(e.target.value)}
              style={{ marginLeft: "auto" }}
            >
              <option value="">+ add effect…</option>
              {effectTypes.map((t) => (
                <option key={t} value={t}>{EFFECTS[t].label}</option>
              ))}
            </select>
          </div>
          {effects.length === 0 && (
            <div style={{ color: "#555", fontStyle: "italic", marginBottom: 6 }}>
              No effects yet — add one and it will react to this {isStem ? "stem" : "group"}.
            </div>
          )}
          {effects.map((eff) => (
            <EffectCard
              key={eff.id}
              eff={eff}
              stems={stems}
              onUpdate={(fn) => onUpdateEffect(eff.id, fn)}
              onRemove={() => onRemoveEffect(eff.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const EffectCard: React.FC<{
  eff: EffectInstance;
  stems: PulseProject["stems"];
  onUpdate: (fn: (e: EffectInstance) => EffectInstance) => void;
  onRemove: () => void;
}> = ({ eff, stems, onUpdate, onRemove }) => {
  const [showHelp, setShowHelp] = useState(false);
  const spec = EFFECTS[eff.type];
  const help = EFFECT_HELP[eff.type];
  return (
    <div style={{ border: "1px solid #222", borderRadius: 6, padding: 6, marginBottom: 6, background: "#111" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input type="checkbox" checked={eff.enabled} onChange={(e) => onUpdate((x) => ({ ...x, enabled: e.target.checked }))} />
        <span style={{ flex: 1, color: "#ddd" }}>{spec?.label ?? eff.type}</span>
        <Button variant="ghost" size="icon-xs" title="what is this?" onClick={() => setShowHelp((s) => !s)}>?</Button>
        <Button variant="ghost" size="icon-xs" title="lock" onClick={() => onUpdate((x) => ({ ...x, locked: !x.locked }))}>
          {eff.locked ? "🔒" : "🔓"}
        </Button>
        <Button variant="ghost" size="icon-xs" title="remove" onClick={onRemove}>✕</Button>
      </div>
      {showHelp && help && (
        <div style={{ margin: "4px 0", padding: 6, borderRadius: 4, background: "#0a0a0a", color: "#9ab", fontSize: 11, lineHeight: 1.5 }}>
          <div style={{ color: "#cde" }}>{help.what}</div>
          <div style={{ marginTop: 2 }}>{help.how}</div>
        </div>
      )}
      {(spec?.params ?? []).map((p) => (
        <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
          <span style={{ width: 84 }}>{p.name}</span>
          <input
            type="range"
            min={p.min}
            max={p.max}
            step={p.step}
            value={eff.params[p.name] ?? p.default}
            onChange={(e) => onUpdate((x) => ({ ...x, params: { ...x.params, [p.name]: Number(e.target.value) } }))}
          />
          <span style={{ width: 40, textAlign: "right" }}>{(eff.params[p.name] ?? p.default).toFixed(2)}</span>
        </div>
      ))}
      <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, color: "#8ab" }}>
        bindings
        <Button
          variant="outline"
          size="xs"
          onClick={() =>
            onUpdate((x) => ({
              ...x,
              bindings: [
                ...x.bindings,
                { param: spec?.params[0]?.name ?? "", source: { stem: "master", feature: "level" }, amount: 1, curve: "linear", offset: 0 },
              ],
            }))
          }
        >
          + bind
        </Button>
      </div>
      {eff.bindings.map((b, bi) => {
        const setB = (fn: (b: Binding) => Binding) =>
          onUpdate((x) => ({ ...x, bindings: x.bindings.map((y, j) => (j === bi ? fn(y) : y)) }));
        return (
          <div key={bi} style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap", alignItems: "center" }}>
            <select value={b.param} onChange={(e) => setB((y) => ({ ...y, param: e.target.value }))}>
              {(spec?.params ?? []).map((s) => <option key={s.name}>{s.name}</option>)}
            </select>
            <select value={b.source.stem} onChange={(e) => setB((y) => ({ ...y, source: { ...y.source, stem: e.target.value } }))}>
              <option value="master">master</option>
              {stems.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <select value={b.source.feature} onChange={(e) => setB((y) => ({ ...y, source: { ...y.source, feature: e.target.value as Feature } }))}>
              {FEATURES.map((f) => <option key={f}>{f}</option>)}
            </select>
            <input style={{ width: 48 }} type="number" step={0.1} value={b.amount} onChange={(e) => setB((y) => ({ ...y, amount: Number(e.target.value) }))} />
            <select value={b.curve} onChange={(e) => setB((y) => ({ ...y, curve: e.target.value as Binding["curve"] }))}>
              <option>linear</option><option>exp</option><option>log</option><option>smooth</option>
            </select>
            <Button variant="ghost" size="icon-xs" onClick={() => onUpdate((x) => ({ ...x, bindings: x.bindings.filter((_, j) => j !== bi) }))}>✕</Button>
          </div>
        );
      })}
    </div>
  );
};
