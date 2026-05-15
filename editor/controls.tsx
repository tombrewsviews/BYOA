/**
 * Reusable design-properties-panel controls.
 *
 * Styled like a real design tool's properties panel — compact rows,
 * popovers for color, drawn curve thumbnails for easing. Every control is
 * "controlled": value in, onChange out. The panel composes these; they
 * know nothing about the story schema.
 */
import React, { useState, useRef, useEffect } from "react";
import { resolveEasing, type EasingName } from "../src/typography/easings";

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
        color: "#8b8b9a",
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
      style={{ flex: 1, accentColor: "#7c5cff", height: 4 }}
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
        background: "#1c1c26",
        border: "1px solid #2e2e3c",
        borderRadius: 5,
        color: "#e4e4ee",
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
      background: "#1c1c26",
      border: "1px solid #2e2e3c",
      borderRadius: 5,
      color: "#e4e4ee",
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

// --- ColorControl: swatch + popover picker ---------------------------------

export const ColorControl: React.FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "flex", gap: 8 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 26,
          height: 26,
          borderRadius: 6,
          background: value,
          border: "1px solid #3a3a4a",
          cursor: "pointer",
          flexShrink: 0,
        }}
        aria-label="pick color"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          flex: 1,
          background: "#1c1c26",
          border: "1px solid #2e2e3c",
          borderRadius: 5,
          color: "#e4e4ee",
          fontSize: 11,
          padding: "3px 6px",
          fontFamily: "monospace",
        }}
      />
      {open && (
        <div
          style={{
            position: "absolute",
            top: 32,
            left: 0,
            zIndex: 50,
            background: "#16161e",
            border: "1px solid #2e2e3c",
            borderRadius: 8,
            padding: 10,
            boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
          }}
        >
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
            onChange={(e) => onChange(e.target.value)}
            style={{
              width: 160,
              height: 120,
              border: "none",
              background: "none",
              cursor: "pointer",
            }}
          />
        </div>
      )}
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
        background: selected ? "#241f3d" : "#1c1c26",
        border: `1px solid ${selected ? "#7c5cff" : "#2e2e3c"}`,
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
          stroke="#2e2e3c"
          strokeWidth={1}
        />
        <polyline
          points={pts.join(" ")}
          fill="none"
          stroke={selected ? "#9d83ff" : "#6b6b80"}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span style={{ fontSize: 9, color: selected ? "#9d83ff" : "#8b8b9a" }}>
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
