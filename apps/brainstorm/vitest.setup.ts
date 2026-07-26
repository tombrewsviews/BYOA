import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom lacks ResizeObserver, which Radix UI components (Slider, Select, …)
// use. The real Tauri/Chromium webview has it; this polyfill lets the
// components mount in tests.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom also lacks the Pointer Events API entirely. Radix's DropdownMenu /
// Dialog open on pointerdown and guard on `event.button` / `pointerType`, so
// without these a trigger click is silently ignored and the menu never opens.
if (typeof globalThis.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? "mouse";
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}
for (const fn of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture"]) {
  if (!(fn in Element.prototype)) {
    Object.defineProperty(Element.prototype, fn, {
      value: () => false,
      writable: true,
      configurable: true,
    });
  }
}
// Radix scrolls the focused item into view when a menu opens.
if (!("scrollIntoView" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    value: () => {},
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
});
