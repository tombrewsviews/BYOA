/**
 * Shell-wide design tokens and button style helpers.
 *
 * Single source of truth for colors, spacing, radii, and the three
 * button variants used across the platform shell (The Square, the
 * platform titlebar) and the Kinetic editor chrome.
 *
 * Pure data + style returners. No React imports — these are consumed
 * as plain CSSProperties objects by every UI module.
 */
import type React from "react";

// Neutral-grey scheme. These hex values mirror the shadcn CSS variables in
// editor/index.css so the inline-styled (not-yet-migrated) parts of the app
// match the ReUI/Tailwind components. Keep the two in sync until later
// migration phases retire the inline styles entirely.
export const color = {
  bg: {
    canvas: "#0a0a0a",
    surface: "#121212",
    raised: "#18181a",
    hover: "#1e1e20",
    selected: "#242427",
  },
  border: {
    faint: "#1e1e20",
    line: "#2a2a2c",
    strong: "#3a3a3d",
    hover: "#4a4a4d",
  },
  text: {
    primary: "#fafafa",
    secondary: "#e6e6e8",
    muted: "#9a9a9d",
    dim: "#6e6e72",
    faint: "#5a5a5d",
  },
  accent: {
    fg: "#fafafa",
    bg: "#0a0a0a",
    dot: "#fafafa",
    focus: "rgba(250,250,250,0.22)",
  },
  danger: {
    bg: "#2a1414",
    border: "#5a2424",
    text: "#fca5a5",
  },
} as const;

export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 10,
  pill: 999,
} as const;

export const space = {
  s2: 2,
  s4: 4,
  s6: 6,
  s8: 8,
  s10: 10,
  s12: 12,
  s14: 14,
  s16: 16,
  s20: 20,
  s24: 24,
  s32: 32,
  s40: 40,
} as const;

export const font = {
  family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  size: { xs: 10, sm: 11, md: 12, base: 13, lg: 14, xl: 18, display: 36 },
} as const;

// --- Button rhythm -----------------------------------------------------------
// One shared height/padding/font/radius for ALL chrome buttons so the toolbar,
// transport, tabs, projects, and dialogs line up. Variants differ only in
// fill/border/color — never in size. `sm` is the single smaller step (compact
// inline buttons); everything else uses the default 28px height.
const BTN_HEIGHT = 28;
const BTN_HEIGHT_SM = 22;

const btnBase = (sm: boolean): React.CSSProperties => ({
  height: sm ? BTN_HEIGHT_SM : BTN_HEIGHT,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  borderRadius: radius.md,
  fontSize: sm ? font.size.sm : font.size.md,
  fontWeight: 600,
  padding: sm ? "0 8px" : "0 12px",
  lineHeight: 1,
  whiteSpace: "nowrap",
  boxSizing: "border-box",
  transition: "background 120ms ease, border-color 120ms ease, color 120ms ease",
});

export const primaryBtn = (
  opts: { size?: "sm" | "md"; disabled?: boolean } = {},
): React.CSSProperties => ({
  ...btnBase(opts.size === "sm"),
  background: opts.disabled ? color.bg.selected : color.accent.fg,
  border: "1px solid transparent",
  color: opts.disabled ? color.text.dim : color.accent.bg,
  fontWeight: 700,
  cursor: opts.disabled ? "default" : "pointer",
});

export const secondaryBtn = (
  opts: { active?: boolean; disabled?: boolean; size?: "sm" | "md" } = {},
): React.CSSProperties => ({
  ...btnBase(opts.size === "sm"),
  background: opts.active ? color.bg.selected : "transparent",
  border: `1px solid ${color.border.strong}`,
  color: opts.disabled
    ? color.text.dim
    : opts.active
      ? color.text.primary
      : color.text.secondary,
  cursor: opts.disabled ? "default" : "pointer",
  opacity: opts.disabled ? 0.5 : 1,
});

export const ghostBtn = (
  opts: { disabled?: boolean; size?: "sm" | "md" } = {},
): React.CSSProperties => ({
  ...btnBase(opts.size === "sm"),
  background: "transparent",
  border: "1px solid transparent",
  color: color.text.muted,
  fontWeight: 500,
  cursor: opts.disabled ? "default" : "pointer",
  opacity: opts.disabled ? 0.5 : 1,
});

/** The terminal/secondary tab switcher — shares the button rhythm, with the
 *  tab-style top-rounded border treatment. */
export const tabBtn = (active: boolean): React.CSSProperties => ({
  ...btnBase(false),
  flex: 1,
  background: active ? color.bg.surface : "transparent",
  border: "1px solid",
  borderColor: active ? color.border.line : "transparent",
  borderBottomColor: active ? color.bg.surface : "transparent",
  borderRadius: "6px 6px 0 0",
  color: active ? color.text.primary : color.text.dim,
  cursor: "pointer",
  textTransform: "capitalize",
});

/** Standard inset focus ring used on the editor's three focus zones. */
export const focusRing = `inset 0 0 0 2px ${color.accent.focus}`;

/** Format a byte count as KB/MB/GB with one decimal. */
export const formatBytes = (bytes: number): string => {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
};
