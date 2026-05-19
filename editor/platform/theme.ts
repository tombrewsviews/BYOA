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

export const color = {
  bg: {
    canvas: "#08080c",
    surface: "#0a0a10",
    raised: "#0f0f18",
    hover: "#14141e",
    selected: "#1a1a24",
  },
  border: {
    faint: "#1a1a24",
    line: "#232330",
    strong: "#2e2e3c",
    hover: "#3a3a4a",
  },
  text: {
    primary: "#fafafa",
    secondary: "#e4e4ee",
    muted: "#8b8b9a",
    dim: "#6b6b80",
    faint: "#5a5a6e",
  },
  accent: {
    fg: "#fafafa",
    bg: "#08080c",
    dot: "#fafafa",
    focus: "rgba(250,250,250,0.18)",
  },
  danger: {
    bg: "#3a1414",
    border: "#5a2020",
    text: "#ffb4b4",
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

export const primaryBtn = (
  opts: { size?: "sm" | "md"; disabled?: boolean } = {},
): React.CSSProperties => {
  const sm = opts.size === "sm";
  return {
    background: opts.disabled ? color.bg.selected : color.accent.fg,
    border: 0,
    borderRadius: radius.md,
    color: opts.disabled ? color.text.dim : color.accent.bg,
    fontSize: sm ? font.size.md : font.size.base,
    fontWeight: 700,
    padding: sm ? "6px 10px" : "10px 14px",
    cursor: opts.disabled ? "default" : "pointer",
    letterSpacing: 0,
    transition: "background 120ms ease",
  };
};

export const secondaryBtn = (
  opts: { active?: boolean; disabled?: boolean } = {},
): React.CSSProperties => ({
  background: opts.active ? color.bg.selected : "transparent",
  border: `1px solid ${color.border.strong}`,
  borderRadius: radius.md,
  color: opts.disabled
    ? color.text.dim
    : opts.active
      ? color.text.primary
      : color.text.secondary,
  fontSize: font.size.sm,
  fontWeight: 600,
  padding: "6px 12px",
  cursor: opts.disabled ? "default" : "pointer",
  opacity: opts.disabled ? 0.5 : 1,
  transition: "border-color 120ms ease, background 120ms ease",
});

export const ghostBtn = (
  opts: { disabled?: boolean } = {},
): React.CSSProperties => ({
  background: "transparent",
  border: 0,
  borderRadius: radius.sm,
  color: color.text.muted,
  fontSize: font.size.sm,
  fontWeight: 500,
  padding: "6px 8px",
  cursor: opts.disabled ? "default" : "pointer",
  opacity: opts.disabled ? 0.5 : 1,
  transition: "background 120ms ease, color 120ms ease",
});

/** One-off pattern for the terminal/secondary tab switcher. */
export const tabBtn = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: "6px 8px",
  fontSize: font.size.sm,
  fontWeight: 600,
  background: active ? color.bg.surface : "transparent",
  border: "1px solid",
  borderColor: active ? color.border.line : "transparent",
  borderBottomColor: active ? color.bg.surface : "transparent",
  borderRadius: "6px 6px 0 0",
  color: active ? color.text.primary : color.text.dim,
  cursor: "pointer",
  textTransform: "capitalize",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
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
