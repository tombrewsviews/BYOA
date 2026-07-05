import React from "react";
import { createRoot } from "react-dom/client";
import { RemitApp } from "./RemitApp";
import { isTauri } from "./runtime";
import { Button } from "@/components/ui/button";
import { LayoutGrid } from "lucide-react";
import "./index.css";

const isMac =
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

// macOS traffic lights end at ~70px; 84 gives a ~14px gap before our content.
const MAC_LEFT_PAD = 84;

// Slim draggable title bar. The window uses a hidden/overlay native title bar
// (traffic-light buttons float over the top-left), so an explicit drag region
// is required or the window can't be moved. The bar itself is the drag region;
// the centered label is `pointer-events-none` so it never eats the drag, and
// the interactive button opts out with `data-tauri-drag-region={false}`.
const TitleBar: React.FC = () => {
  const openStore = React.useCallback(async () => {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_dreamstore").catch(() => {});
  }, []);

  return (
    <div
      data-tauri-drag-region
      className="relative flex h-9 flex-none select-none items-center gap-2 border-b border-border bg-background pr-2 text-sm text-muted-foreground"
      style={{ paddingLeft: isMac ? MAC_LEFT_PAD : 12 }}
    >
      <Button
        data-tauri-drag-region={false}
        variant="ghost"
        size="sm"
        onClick={openStore}
        title="Open DreamStore"
      >
        <LayoutGrid />
        DreamStore
      </Button>
      {/* App name, centered and non-interactive so it never blocks the drag. */}
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 font-semibold text-foreground">
        Remit
      </span>
    </div>
  );
};

// Standalone: Remit is the whole app. There's no shell to exit back to, so
// onExit is a no-op (the app is closed by closing its window).
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      <TitleBar />
      <div className="min-h-0 flex-1">
        <RemitApp onExit={() => {}} />
      </div>
    </div>
  </React.StrictMode>,
);
