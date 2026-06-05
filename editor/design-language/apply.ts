import type { TokenMap } from "./types";
import { BASE_TOKENS } from "./fanout";

/** Fixed, reviewed CSS-var -> theme.ts color-path correspondence (spec table). */
const THEME_MAP: Record<string, string> = {
  "--background": "bg.canvas",
  "--card": "bg.surface",
  "--popover": "bg.raised",
  "--muted": "bg.hover",
  "--secondary": "bg.selected",
  "--border": "border.line",
  "--foreground": "text.primary",
  "--muted-foreground": "text.muted",
  "--ring": "accent.focus",
};
/** theme.ts color keys with NO clean CSS-var source — reported, never guessed. */
const NOT_REACHED = [
  "border.faint","border.strong","border.hover",
  "text.secondary","text.dim","text.faint",
  "accent.dot","danger.bg","danger.border","danger.text",
];

export function applyTokens(map: TokenMap): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(map)) root.style.setProperty(k, v);
}

export function resetTokens(): void {
  const root = document.documentElement;
  for (const k of Object.keys(BASE_TOKENS)) root.style.removeProperty(k);
}

export type Patch = {
  cssVars: TokenMap;
  themeTs: Record<string, string>;
  notReached: string[];
};

/** Diff against BASE so a patch contains only what actually changed. */
export function toPatch(map: TokenMap): Patch {
  const cssVars: TokenMap = {};
  for (const [k, v] of Object.entries(map)) if (v !== BASE_TOKENS[k]) cssVars[k] = v;
  const themeTs: Record<string, string> = {};
  for (const [cssVar, path] of Object.entries(THEME_MAP)) {
    if (map[cssVar] !== undefined && map[cssVar] !== BASE_TOKENS[cssVar]) {
      themeTs[path] = map[cssVar];
    }
  }
  return { cssVars, themeTs, notReached: [...NOT_REACHED] };
}
