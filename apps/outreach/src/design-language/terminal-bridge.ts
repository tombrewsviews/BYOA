import type { TokenMap } from "./types";

/** xterm theme uses a JS color API, not CSS, so a TokenMap must be translated
 *  into xterm's ITheme + a fontSize. Pure — no terminal access here. */
export type XtermBridge = {
  theme: { background: string; foreground: string; cursor: string; selectionBackground: string };
  fontSize: number;
};

/** Convert a rem string ("0.6875rem") to px (assumes 16px root). */
const remToPx = (v: string): number => Math.round(parseFloat(v) * 16);

export function terminalThemeFromTokens(map: TokenMap): XtermBridge {
  return {
    theme: {
      background: map["--background"],
      foreground: map["--foreground"],
      // cursor keeps the app's amber for visibility — not token-bound.
      cursor: "#facc15",
      selectionBackground: "#ffffff33",
    },
    // the terminal sits at the small UI tier; track --ui-sm.
    fontSize: remToPx(map["--ui-sm"]),
  };
}
