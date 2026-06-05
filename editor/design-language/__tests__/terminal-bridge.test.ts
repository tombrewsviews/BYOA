import { describe, it, expect } from "vitest";
import { terminalThemeFromTokens } from "../terminal-bridge";
import { resolve, BASE_TOKENS } from "../fanout";
import { emptyState } from "../dials";

describe("terminalThemeFromTokens (pure)", () => {
  it("maps token map to an xterm theme + fontSize", () => {
    const out = terminalThemeFromTokens(BASE_TOKENS);
    expect(out.theme.background).toBe("#0a0a0a");
    expect(out.theme.foreground).toBe("#fafafa");
    expect(typeof out.fontSize).toBe("number");
    expect(out.fontSize).toBeGreaterThan(0);
  });
  it("fontSize grows when scale dial is large", () => {
    const big = terminalThemeFromTokens(resolve({ ...emptyState(), scale: 3 }));
    const base = terminalThemeFromTokens(BASE_TOKENS);
    expect(big.fontSize).toBeGreaterThan(base.fontSize);
  });
});
