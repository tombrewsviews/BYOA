/**
 * Divider-drag hook for resizable side panels.
 *
 * Reads/writes a CSS custom property on `document.documentElement` so
 * the grid template picks up changes without a React re-render of
 * the panes. Persists to localStorage.
 *
 * Constraints are clamped during drag so the middle (preview/timeline)
 * column never shrinks below `minMiddle`.
 */
import { useEffect } from "react";

export type Side = "left" | "right";

type Opts = {
  side: Side;
  storageKey: string;
  cssVar: string;       // e.g. "--col-terminal"
  defaultPx: number;
  minPx: number;
  maxPx: number;
};

export const usePersistedColumnWidth = ({
  storageKey,
  cssVar,
  defaultPx,
  minPx,
  maxPx,
}: Opts) => {
  useEffect(() => {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    const initial = Number.isFinite(parsed)
      ? Math.max(minPx, Math.min(maxPx, parsed))
      : defaultPx;
    document.documentElement.style.setProperty(cssVar, `${initial}px`);
  }, [storageKey, cssVar, defaultPx, minPx, maxPx]);
};

/**
 * Begin a drag. Call from onMouseDown on the divider element. Returns
 * a cleanup that you typically don't need (mouseup auto-cleans).
 */
export const beginColumnDrag = (
  e: React.MouseEvent,
  opts: Opts,
): void => {
  e.preventDefault();
  const startX = e.clientX;
  const startPx = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue(opts.cssVar) ||
      `${opts.defaultPx}`,
    10,
  );

  const sign = opts.side === "left" ? 1 : -1;

  const onMove = (ev: MouseEvent) => {
    const delta = (ev.clientX - startX) * sign;
    const next = Math.max(opts.minPx, Math.min(opts.maxPx, startPx + delta));
    document.documentElement.style.setProperty(opts.cssVar, `${next}px`);
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    const finalPx = Number.parseInt(
      getComputedStyle(document.documentElement)
        .getPropertyValue(opts.cssVar)
        .trim(),
      10,
    );
    if (Number.isFinite(finalPx)) {
      localStorage.setItem(opts.storageKey, String(finalPx));
    }
  };

  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
};
