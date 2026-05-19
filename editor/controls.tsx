/**
 * Reusable design-properties-panel controls.
 *
 * Styled like a real design tool's properties panel — compact rows,
 * popovers for color, drawn curve thumbnails for easing. Every control is
 * "controlled": value in, onChange out. The panel composes these; they
 * know nothing about the story schema.
 */
import React from "react";
import { resolveEasing, type EasingName } from "../src/typography/easings";
import { color } from "./platform/theme";

// --- shared row scaffold ----------------------------------------------------

export const Row: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      minHeight: 30,
    }}
  >
    <span
      style={{
        width: 78,
        fontSize: 11,
        color: color.text.muted,
        flexShrink: 0,
        textTransform: "lowercase",
      }}
    >
      {label}
    </span>
    <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
      {children}
    </div>
  </div>
);

// --- TextInput --------------------------------------------------------------
// Live text editor. Updates the parent on every keystroke (we don't debounce —
// updates are cheap relative to a render, and the user expects WYSIWYG as
// they type a word).
export const TextInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}> = ({ value, onChange, placeholder }) => (
  <input
    type="text"
    value={value}
    placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)}
    style={{
      width: "100%",
      background: color.bg.canvas,
      border: `1px solid ${color.border.line}`,
      borderRadius: 4,
      color: color.text.primary,
      fontSize: 12,
      padding: "5px 8px",
      fontFamily: "inherit",
      outline: "none",
    }}
  />
);

// --- Slider -----------------------------------------------------------------

export const Slider: React.FC<{
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}> = ({ value, min, max, step, onChange }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ flex: 1, accentColor: color.text.primary, height: 4 }}
    />
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        width: 52,
        background: color.bg.selected,
        border: `1px solid ${color.border.strong}`,
        borderRadius: 5,
        color: color.text.secondary,
        fontSize: 11,
        padding: "3px 5px",
        textAlign: "right",
      }}
    />
  </div>
);

// --- Dropdown ---------------------------------------------------------------

export const Dropdown: React.FC<{
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}> = ({ value, options, onChange }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    style={{
      flex: 1,
      background: color.bg.selected,
      border: `1px solid ${color.border.strong}`,
      borderRadius: 5,
      color: color.text.secondary,
      fontSize: 11,
      padding: "4px 6px",
    }}
  >
    {options.map((o) => (
      <option key={o} value={o}>
        {o}
      </option>
    ))}
  </select>
);

// --- ColorControl: native color picker + hex input -------------------------

export const ColorControl: React.FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="pick color"
        style={{
          width: 22,
          height: 22,
          border: `1px solid ${color.border.strong}`,
          borderRadius: 4,
          padding: 0,
          background: "transparent",
          cursor: "pointer",
        }}
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        style={{
          flex: 1,
          background: color.bg.selected,
          border: `1px solid ${color.border.strong}`,
          borderRadius: 5,
          color: color.text.secondary,
          fontSize: 11,
          padding: "3px 6px",
          fontFamily: "ui-monospace, Menlo, monospace",
        }}
      />
    </div>
  );
};

// --- EasingPicker: drawn curve thumbnails, click to select -----------------

const CURVE_SIZE = 44;

const CurveThumb: React.FC<{
  easing: EasingName;
  selected: boolean;
  onSelect: () => void;
}> = ({ easing, selected, onSelect }) => {
  // sample the easing function into an SVG polyline
  const fn = resolveEasing(easing);
  const pts: string[] = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = fn(t);
    // y-up in viewBox: invert
    pts.push(`${(t * CURVE_SIZE).toFixed(1)},${((1 - y) * CURVE_SIZE).toFixed(1)}`);
  }
  return (
    <button
      onClick={onSelect}
      title={easing}
      style={{
        background: selected ? color.bg.selected : color.bg.selected,
        border: `1px solid ${selected ? color.border.strong : color.border.strong}`,
        borderRadius: 6,
        padding: 4,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
      }}
    >
      <svg width={CURVE_SIZE} height={CURVE_SIZE}>
        {/* baseline + diagonal reference */}
        <line
          x1={0}
          y1={CURVE_SIZE}
          x2={CURVE_SIZE}
          y2={0}
          stroke={color.border.strong}
          strokeWidth={1}
        />
        <polyline
          points={pts.join(" ")}
          fill="none"
          stroke={selected ? color.text.primary : color.text.dim}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span style={{ fontSize: 9, color: selected ? color.text.primary : color.text.muted }}>
        {easing.replace("power", "p")}
      </span>
    </button>
  );
};

export const EasingPicker: React.FC<{
  value: EasingName;
  onChange: (v: EasingName) => void;
}> = ({ value, onChange }) => {
  const options: EasingName[] = [
    "power3.out",
    "power3.inOut",
    "power4.out",
    "spring",
  ];
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((e) => (
        <CurveThumb
          key={e}
          easing={e}
          selected={value === e}
          onSelect={() => onChange(e)}
        />
      ))}
    </div>
  );
};
