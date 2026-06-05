import type { DialState, TokenMap } from "./types";
import { hexToHsl, hslToHex, shiftLightness, shiftSaturation } from "./color";

/** BASE token values — mirrors editor/index.css :root defaults, plus the
 *  Tailwind v4 spacing multiplier (default 0.25rem) which we expose so density
 *  can rescale every px-/py-/gap- utility at once. */
export const BASE_TOKENS: TokenMap = {
  "--background": "#0a0a0a",
  "--foreground": "#fafafa",
  "--card": "#121212",
  "--card-foreground": "#fafafa",
  "--popover": "#18181a",
  "--popover-foreground": "#fafafa",
  "--primary": "#fafafa",
  "--primary-foreground": "#0a0a0a",
  "--secondary": "#242427",
  "--secondary-foreground": "#fafafa",
  "--muted": "#1e1e20",
  "--muted-foreground": "#9a9a9d",
  "--accent": "#242427",
  "--accent-foreground": "#fafafa",
  "--destructive": "#f87171",
  "--destructive-foreground": "#0a0a0a",
  "--border": "#2a2a2c",
  "--input": "#2a2a2c",
  "--ring": "rgba(250, 250, 250, 0.22)",
  "--radius": "0.5rem",
  "--spacing": "0.25rem",
};

const ACCENTS = ["--primary", "--accent", "--secondary", "--destructive"];
const FG_BG_PAIRS: [string, string][] = [
  ["--foreground", "--background"],
  ["--card-foreground", "--card"],
  ["--popover-foreground", "--popover"],
];

const isHex = (v: string) => /^#[0-9a-fA-F]{3,8}$/.test(v.trim());
const remParts = (v: string) => parseFloat(v);

export function resolve(state: DialState, base: TokenMap = BASE_TOKENS): TokenMap {
  const out: TokenMap = { ...base };

  // 1. temperature: hue-shift hex neutrals toward amber(+)/blue(-).
  //    Skip entirely at 0 so neutral state round-trips BASE byte-for-byte.
  if (state.temperature !== 0) {
    const tempDeg = state.temperature * 6;
    const target = state.temperature >= 0 ? 40 : 220;
    for (const k of Object.keys(out)) {
      if (!isHex(out[k])) continue;
      const c = hexToHsl(out[k]);
      const diff = ((target - c.h + 540) % 360) - 180;
      const step = Math.sign(diff) * Math.min(Math.abs(diff), Math.abs(tempDeg));
      out[k] = hslToHex({
        ...c,
        h: (((c.h + step) % 360) + 360) % 360,
        s: Math.max(c.s, Math.abs(state.temperature) * 1.5),
      });
    }
  }

  // 2. contrast: push fg lighter / bg darker (punchy +).
  //    Skip at 0 so neutral state round-trips BASE byte-for-byte.
  if (state.contrast !== 0) {
    const cL = state.contrast * 4;
    for (const [fg, bg] of FG_BG_PAIRS) {
      if (isHex(out[fg])) out[fg] = hslToHex(shiftLightness(hexToHsl(out[fg]), cL));
      if (isHex(out[bg])) out[bg] = hslToHex(shiftLightness(hexToHsl(out[bg]), -cL));
    }
  }

  // 3. character: saturation of accents.
  const sat = state.character * 8;
  for (const k of ACCENTS) {
    if (isHex(out[k])) out[k] = hslToHex(shiftSaturation(hexToHsl(out[k]), sat));
  }

  // 4. density: global --spacing multiplier. airy(-) bigger, packed(+) smaller.
  //    Skip at 0 so neutral state round-trips BASE byte-for-byte.
  if (state.density !== 0) {
    const spaceBase = remParts(base["--spacing"]);
    out["--spacing"] = `${(spaceBase * (1 - state.density * 0.08)).toFixed(4)}rem`;
  }

  // 5. softness: --radius. rounded(+) bigger, floored at 0.
  //    Skip at 0 so neutral state round-trips BASE byte-for-byte.
  if (state.softness !== 0) {
    const radBase = remParts(base["--radius"]);
    out["--radius"] = `${Math.max(0, radBase + state.softness * 0.12).toFixed(3)}rem`;
  }

  // 6. weight (phase 1): nudge --border lightness for prominence.
  //    Skip at 0 so neutral state round-trips BASE byte-for-byte.
  if (state.weight !== 0) {
    if (isHex(out["--border"])) {
      out["--border"] = hslToHex(shiftLightness(hexToHsl(out["--border"]), state.weight * 3));
      out["--input"] = out["--border"];
    }
  }

  return out;
}
