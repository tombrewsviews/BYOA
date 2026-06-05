/**
 * Dev-only design-token control surface — the live proof of spec→UI binding.
 *
 * Hidden by default. Toggle with ⌃⇧D (Ctrl+Shift+D) or by setting localStorage
 * `studio.devControls` to `1`. Never shipped to production users — same gating
 * convention as PerfOverlay (`studio.perf`).
 *
 * What it does: lists the TOKEN TIER (the CSS custom properties defined in
 * editor/index.css `:root`) and lets you edit each value with the right input
 * (color picker for colors, number+unit for radius). Each edit writes the new
 * value straight onto `document.documentElement` via setProperty, so every
 * ReUI/Tailwind component that reads `var(--…)` (through the `@theme inline`
 * block) repaints INSTANTLY — no rebuild.
 *
 * This is the *runtime-bound* tier. It does NOT touch the parallel theme.ts
 * plane (inline-styled chrome, xterm) — those are documented as unbound in
 * design-spec/binding.manifest.yaml and deliberately will NOT move when you
 * edit here. That contrast is the point: it shows on screen exactly where the
 * spec is subscribed vs bypassed.
 *
 * State is in memory only. Nothing is written to disk or browser storage
 * (the localStorage key holds only the open/closed flag, never token values).
 * "Copy diff" is the escape hatch: it copies the changed tokens as a YAML
 * patch for tokens.yaml so a human decides what enters the spec.
 */
import React, { useEffect, useMemo, useState } from "react";
import { DesignLanguagePanel } from "./DesignLanguagePanel";

// --- Token tier, mirrored from editor/index.css :root -----------------------
// `value` is the default literal as written in index.css (the fallback the
// stylesheet provides). Editing a token overrides it on :root at runtime;
// Reset removes the override so the stylesheet value applies again.
type TokenKind = "color" | "rgba" | "radius";
type Token = {
  /** CSS custom property name, e.g. "--background". */
  name: string;
  /** Default value as authored in index.css. */
  value: string;
  kind: TokenKind;
  /** Grouping for the UI. */
  group: "color" | "radius";
};

const TOKENS: Token[] = [
  // dark grey (default) — editor/index.css:15-33
  { name: "--background", value: "#0a0a0a", kind: "color", group: "color" },
  { name: "--foreground", value: "#fafafa", kind: "color", group: "color" },
  { name: "--card", value: "#121212", kind: "color", group: "color" },
  { name: "--card-foreground", value: "#fafafa", kind: "color", group: "color" },
  { name: "--popover", value: "#18181a", kind: "color", group: "color" },
  { name: "--popover-foreground", value: "#fafafa", kind: "color", group: "color" },
  { name: "--primary", value: "#fafafa", kind: "color", group: "color" },
  { name: "--primary-foreground", value: "#0a0a0a", kind: "color", group: "color" },
  { name: "--secondary", value: "#242427", kind: "color", group: "color" },
  { name: "--secondary-foreground", value: "#fafafa", kind: "color", group: "color" },
  { name: "--muted", value: "#1e1e20", kind: "color", group: "color" },
  { name: "--muted-foreground", value: "#9a9a9d", kind: "color", group: "color" },
  { name: "--accent", value: "#242427", kind: "color", group: "color" },
  { name: "--accent-foreground", value: "#fafafa", kind: "color", group: "color" },
  { name: "--destructive", value: "#f87171", kind: "color", group: "color" },
  { name: "--destructive-foreground", value: "#0a0a0a", kind: "color", group: "color" },
  { name: "--border", value: "#2a2a2c", kind: "color", group: "color" },
  { name: "--input", value: "#2a2a2c", kind: "color", group: "color" },
  // --ring is an rgba (translucent focus ring) — editor/index.css:33
  { name: "--ring", value: "rgba(250, 250, 250, 0.22)", kind: "rgba", group: "color" },
  // radius — editor/index.css:12 (drives --radius-sm/md/lg via calc in @theme)
  { name: "--radius", value: "0.5rem", kind: "radius", group: "radius" },
];

const STORAGE_KEY = "studio.devControls";

// Parse "0.5rem" -> { num: 0.5, unit: "rem" } for the number+unit editor.
function parseRadius(v: string): { num: number; unit: string } {
  const m = v.trim().match(/^([\d.]+)\s*([a-z%]*)$/i);
  if (!m) return { num: 0, unit: "rem" };
  return { num: parseFloat(m[1]), unit: m[2] || "rem" };
}

export const DevControlSurface: React.FC<{ defaultOpen?: boolean }> = ({
  defaultOpen = false,
}) => {
  const [open, setOpen] = useState<boolean>(() => {
    if (defaultOpen) return true;
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  // Edited values, keyed by token name. Absent key = untouched (stylesheet value).
  const [edits, setEdits] = useState<Record<string, string>>({});

  const [tab, setTab] = useState<"language" | "tokens">("language");

  // hotkey ⌃⇧D toggles open/closed (visibility flag persists; values do not).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        setOpen((v) => {
          const next = !v;
          try {
            localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
          } catch {
            /* ignore */
          }
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setToken = (name: string, value: string) => {
    document.documentElement.style.setProperty(name, value);
    setEdits((e) => ({ ...e, [name]: value }));
  };

  const resetToken = (name: string) => {
    document.documentElement.style.removeProperty(name);
    setEdits((e) => {
      const next = { ...e };
      delete next[name];
      return next;
    });
  };

  const resetAll = () => {
    for (const t of TOKENS) document.documentElement.style.removeProperty(t.name);
    setEdits({});
  };

  // YAML patch of changed tokens only — the human-in-the-loop escape hatch.
  const diffYaml = useMemo(() => {
    const changed = TOKENS.filter((t) => t.name in edits);
    if (changed.length === 0) return "";
    const lines = changed.map((t) => {
      const key = t.name.replace(/^--/, "");
      // quote values that aren't bare hex (rgba/rem contain spaces/parens)
      const v = edits[t.name];
      const quoted = /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : `"${v}"`;
      return `  ${key}: ${quoted}`;
    });
    return `# tokens.yaml patch — changed token-tier values\ncolor_and_radius:\n${lines.join("\n")}\n`;
  }, [edits]);

  const [copied, setCopied] = useState(false);
  const copyDiff = async () => {
    if (!diffYaml) return;
    try {
      await navigator.clipboard.writeText(diffYaml);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — diff is still visible below for manual copy */
    }
  };

  if (!open) return null;

  const colorTokens = TOKENS.filter((t) => t.group === "color");
  const radiusTokens = TOKENS.filter((t) => t.group === "radius");
  const changedCount = Object.keys(edits).length;

  return (
    <div className="fixed right-3 top-3 z-[1000] flex max-h-[92vh] w-[320px] flex-col overflow-hidden rounded-md border border-border bg-popover/97 text-foreground shadow-md">
      {/* header: tab switch */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex gap-1">
          {(["language", "tokens"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={
                "h-6 rounded px-2 text-[11px] " +
                (tab === t ? "bg-secondary text-foreground" : "text-muted-foreground")
              }>
              {t}
            </button>
          ))}
        </div>
        <div className="text-[10px] text-muted-foreground">⌃⇧D</div>
      </div>

      {tab === "language" && (
        <div className="flex-1 overflow-y-auto">
          <DesignLanguagePanel />
        </div>
      )}
      {tab === "tokens" && (
        <>
      {/* scrollable token list */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          color
        </div>
        {colorTokens.map((t) => (
          <TokenRow
            key={t.name}
            token={t}
            value={edits[t.name] ?? t.value}
            dirty={t.name in edits}
            onChange={(v) => setToken(t.name, v)}
            onReset={() => resetToken(t.name)}
          />
        ))}

        <div className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          radius
        </div>
        {radiusTokens.map((t) => (
          <TokenRow
            key={t.name}
            token={t}
            value={edits[t.name] ?? t.value}
            dirty={t.name in edits}
            onChange={(v) => setToken(t.name, v)}
            onReset={() => resetToken(t.name)}
          />
        ))}
      </div>

      {/* footer actions */}
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <button
          onClick={copyDiff}
          disabled={changedCount === 0}
          className="h-7 flex-1 rounded-md bg-primary px-2 text-[11px] font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
        >
          {copied ? "copied ✓" : "copy diff"}
        </button>
        <button
          onClick={resetAll}
          disabled={changedCount === 0}
          className="h-7 rounded-md border border-border px-2 text-[11px] font-medium text-muted-foreground transition-opacity disabled:opacity-40"
        >
          reset all
        </button>
      </div>
        </>
      )}
    </div>
  );
};

// --- One editable token row -------------------------------------------------
const TokenRow: React.FC<{
  token: Token;
  value: string;
  dirty: boolean;
  onChange: (v: string) => void;
  onReset: () => void;
}> = ({ token, value, dirty, onChange, onReset }) => {
  return (
    <div className="group flex items-center gap-2 py-0.5">
      <span
        className="flex-1 truncate font-mono text-[11px]"
        title={token.name}
      >
        {token.name.replace(/^--/, "")}
      </span>

      {token.kind === "radius" ? (
        <RadiusEditor value={value} onChange={onChange} />
      ) : (
        <ColorEditor token={token} value={value} onChange={onChange} />
      )}

      {/* per-token reset — only when dirty */}
      <button
        onClick={onReset}
        disabled={!dirty}
        title="reset to stylesheet value"
        className="w-4 text-center text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-0"
      >
        ↺
      </button>
    </div>
  );
};

// Color (hex) and rgba both edit through a native color picker; rgba keeps its
// alpha via a separate text field since <input type=color> can't express alpha.
const ColorEditor: React.FC<{
  token: Token;
  value: string;
  onChange: (v: string) => void;
}> = ({ token, value, onChange }) => {
  if (token.kind === "rgba") {
    return (
      <input
        type="text"
        aria-label={token.name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-[150px] rounded border border-input bg-transparent px-1.5 font-mono text-[10px] text-foreground outline-none focus-visible:border-ring"
      />
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        aria-label={`${token.name} hex`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-[74px] rounded border border-input bg-transparent px-1.5 font-mono text-[10px] text-foreground outline-none focus-visible:border-ring"
      />
      <input
        type="color"
        aria-label={token.name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-6 cursor-pointer rounded border border-input bg-transparent p-0"
      />
    </div>
  );
};

const RadiusEditor: React.FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => {
  const { num, unit } = parseRadius(value);
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        aria-label="--radius"
        step="0.125"
        min="0"
        value={num}
        onChange={(e) => onChange(`${e.target.value}${unit}`)}
        className="h-6 w-[64px] rounded border border-input bg-transparent px-1.5 text-[11px] text-foreground outline-none focus-visible:border-ring"
      />
      <span className="w-8 font-mono text-[10px] text-muted-foreground">
        {unit}
      </span>
    </div>
  );
};
