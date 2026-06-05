/**
 * The "Language" tab — descriptive control of the live token tier via mood
 * dials, a word lexicon (+ optional agent fallback), presets, and snapshots.
 * Thin caller over editor/design-language/ (all logic + math lives there).
 */
import React, { useMemo, useState } from "react";
import {
  DIAL_AXES, PRESETS, emptyState, mergeDeltas, clampState,
  resolve, parsePhrase, applyTokens, resetTokens, toPatch,
  SnapshotStore, type DialState, type AxisKey,
} from "./design-language";

export const DesignLanguagePanel: React.FC = () => {
  const [state, setState] = useState<DialState>(emptyState());
  const [phrase, setPhrase] = useState("");
  const [unknown, setUnknown] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const store = useMemo(() => new SnapshotStore(), []);
  const [snapNames, setSnapNames] = useState<string[]>([]);

  const applyState = (next: DialState) => {
    const clamped = clampState(next);
    setState(clamped);
    applyTokens(resolve(clamped));
  };

  const onDial = (key: AxisKey, v: number) => applyState({ ...state, [key]: v });

  const onPhrase = () => {
    const { deltas, unknownWords } = parsePhrase(phrase);
    setUnknown(unknownWords);
    if (deltas.length) applyState(mergeDeltas(state, deltas));
  };

  const onPreset = (name: string) => applyState(PRESETS[name]);

  const onReset = () => { resetTokens(); setState(emptyState()); setUnknown([]); };

  const onSaveSnapshot = () => {
    const name = `snap-${snapNames.length + 1}`;
    store.save(name, state);
    setSnapNames(store.names());
  };
  const onRecall = (name: string) => { const s = store.get(name); if (s) applyState(s); };

  const onCopyPatch = async () => {
    const patch = toPatch(resolve(state));
    try {
      await navigator.clipboard.writeText(JSON.stringify(patch, null, 2));
      setCopied(true); window.setTimeout(() => setCopied(false), 1200);
    } catch { /* visible below */ }
  };

  const onApplyToProject = async () => {
    const { cssVars, themeTs } = toPatch(resolve(state));
    if (!window.confirm("Write these tokens into index.css + theme.ts?")) return;
    try {
      const res = await fetch("/__apply-tokens", {
        method: "POST",
        body: JSON.stringify({ cssVars, themeTs }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      window.alert("Applied. Reload to see persisted values as the new BASE.");
    } catch (e) {
      window.alert(`Apply failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="flex flex-col gap-3 px-3 py-2">
      <div className="flex flex-col gap-2">
        {DIAL_AXES.map((a) => (
          <label key={a.key} className="flex items-center gap-2 text-[11px]">
            <span className="w-20 capitalize text-muted-foreground">{a.label}</span>
            <input
              aria-label={a.key}
              type="range" min={-3} max={3} step={1}
              value={state[a.key]}
              onChange={(e) => onDial(a.key, Number(e.target.value))}
              className="flex-1 accent-foreground"
            />
            <span className="w-4 text-center font-mono">{state[a.key]}</span>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder="warmer, airier, editorial…"
          className="h-7 flex-1 rounded border border-input bg-transparent px-2 text-[11px] text-foreground outline-none focus-visible:border-ring"
        />
        <button onClick={onPhrase}
          className="h-7 rounded-md bg-primary px-2 text-[11px] font-semibold text-primary-foreground">
          apply phrase
        </button>
      </div>
      {unknown.length > 0 && (
        <div className="text-[10px] text-muted-foreground">
          not in lexicon: {unknown.join(", ")} — (agent fallback wired separately)
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {Object.keys(PRESETS).map((name) => (
          <button key={name} onClick={() => onPreset(name)}
            className="h-6 rounded border border-border px-2 text-[10px] text-foreground">
            {name}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={onSaveSnapshot}
          className="h-6 rounded border border-border px-2 text-[10px] text-muted-foreground">
          save snapshot
        </button>
        {snapNames.map((n) => (
          <button key={n} onClick={() => onRecall(n)}
            className="h-6 rounded border border-border px-2 text-[10px] text-foreground">
            {n}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-border pt-2">
        <button onClick={onCopyPatch}
          className="h-7 flex-1 rounded-md border border-border px-2 text-[11px] text-foreground">
          {copied ? "copied ✓" : "copy patch"}
        </button>
        <button onClick={onApplyToProject}
          className="h-7 rounded-md bg-primary px-2 text-[11px] font-semibold text-primary-foreground">
          apply to project
        </button>
        <button onClick={onReset}
          className="h-7 rounded-md border border-border px-2 text-[11px] text-muted-foreground">
          reset
        </button>
      </div>
    </div>
  );
};
