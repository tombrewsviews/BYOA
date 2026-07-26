import React from "react";
import { createRoot } from "react-dom/client";
import { BrainstormApp } from "./brainstorm/BrainstormApp";
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
// the interactive button opts out with `data-tauri-drag-region={false}`.
//
// The drag row holds ONLY the DreamStore button. The app name and board chrome
// live in `secondRow` below it: this window is the narrow agent panel (~380px),
// so anything sharing the drag row with the DreamStore button collides with it.
const TitleBar: React.FC<{ secondRow?: React.ReactNode }> = ({ secondRow }) => {
  const openStore = React.useCallback(async () => {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_dreamstore").catch(() => {});
  }, []);

  return (
    <div className="flex-none">
      <div
        data-tauri-drag-region
        className="flex h-9 select-none items-center border-b border-border bg-background pr-2 text-sm text-muted-foreground"
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
      </div>
      {secondRow}
    </div>
  );
};

// Standalone: Brainstorm is the whole app. There's no shell to exit back to,
// so onExit is a no-op (the app is closed by closing its window). The title
// bar lives only on this window (the agent panel); the tiled board window is
// the external Excalidraw URL and needs no bar.
// `BrainstormApp` owns the board state, so it decides what the title bar's
// second row shows (the Boards button + app name once a board is open, nothing
// on the boards list) and hands it back through `renderChrome`.
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrainstormApp
      onExit={() => {}}
      renderChrome={(secondRow, content) => (
        <div className="flex h-screen w-screen flex-col bg-background text-foreground">
          <TitleBar secondRow={secondRow} />
          <div className="min-h-0 flex-1">{content}</div>
        </div>
      )}
    />
  </React.StrictMode>,
);
