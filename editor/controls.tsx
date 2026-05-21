/**
 * Reusable properties-panel controls — now backed by ReUI-style (Base UI)
 * components + Tailwind grey tokens. The PUBLIC API is unchanged (Row, Slider,
 * Dropdown, ColorControl, TextInput, EasingPicker) so panel.tsx and every other
 * consumer is unaffected; only the rendering swapped from inline styles to the
 * shared ui/ components.
 */
import React from "react";
import { resolveEasing, type EasingName } from "../src/typography/easings";
import { color } from "./platform/theme";
import { Slider as UISlider } from "./components/ui/slider";
import { Input as UIInput } from "./components/ui/input";
import {
  Select as UISelect,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./components/ui/select";

// --- Row scaffold (layout only) --------------------------------------------
export const Row: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="flex items-center gap-2.5 min-h-[30px]">
    <span className="w-[78px] shrink-0 text-[11px] lowercase text-muted-foreground">
      {label}
    </span>
    <div className="flex flex-1 items-center">{children}</div>
  </div>
);

// --- TextInput --------------------------------------------------------------
export const TextInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}> = ({ value, onChange, placeholder }) => (
  <UIInput
    type="text"
    value={value}
    placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)}
  />
);

// --- Slider (range + numeric readout) --------------------------------------
export const Slider: React.FC<{
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}> = ({ value, min, max, step, onChange }) => (
  <div className="flex flex-1 items-center gap-2">
    <UISlider
      value={value}
      min={min}
      max={max}
      step={step}
      onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : (v as number))}
    />
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-[52px] rounded-md border border-input bg-secondary px-1.5 py-1 text-right text-[11px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  </div>
);

// --- Dropdown (ReUI Select, same string-in/string-out API) -----------------
export const Dropdown: React.FC<{
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}> = ({ value, options, onChange }) => (
  <UISelect value={value} onValueChange={(v) => onChange(v as string)}>
    <SelectTrigger>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {options.map((o) => (
        <SelectItem key={o} value={o}>
          {o}
        </SelectItem>
      ))}
    </SelectContent>
  </UISelect>
);

// --- ColorControl: native color swatch + hex Input -------------------------
export const ColorControl: React.FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => (
  <div className="flex flex-1 items-center gap-2">
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="pick color"
      className="h-[22px] w-[22px] cursor-pointer rounded border border-border bg-transparent p-0"
    />
    <UIInput
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      className="font-mono"
    />
  </div>
);

// --- EasingPicker: bespoke SVG curve thumbnails (kept; retoned to grey) -----
const CURVE_SIZE = 44;

const CurveThumb: React.FC<{
  easing: EasingName;
  selected: boolean;
  onSelect: () => void;
}> = ({ easing, selected, onSelect }) => {
  const fn = resolveEasing(easing);
  const pts: string[] = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = fn(t);
    pts.push(
      `${(t * CURVE_SIZE).toFixed(1)},${((1 - y) * CURVE_SIZE).toFixed(1)}`,
    );
  }
  return (
    <button
      onClick={onSelect}
      title={easing}
      className={
        "flex flex-col items-center gap-0.5 rounded-md border p-1 cursor-pointer " +
        (selected ? "border-ring bg-accent" : "border-border bg-secondary")
      }
    >
      <svg width={CURVE_SIZE} height={CURVE_SIZE}>
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
      <span
        className={
          selected
            ? "text-[9px] text-foreground"
            : "text-[9px] text-muted-foreground"
        }
      >
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
    <div className="flex flex-wrap gap-1.5">
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
