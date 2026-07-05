import React from "react";
import { createRoot } from "react-dom/client";
import { RemitApp } from "./RemitApp";
import "./index.css";

// A slim draggable title strip. The window uses a hidden/overlay native title
// bar (traffic-light buttons float over the top-left), so without an explicit
// drag region the window can't be moved. `data-tauri-drag-region` makes this
// strip grab-and-drag the window; the left padding clears the macOS traffic
// lights so they don't overlap the app content below.
const TitleBar: React.FC = () => (
  <div
    data-tauri-drag-region
    className="flex h-8 flex-none items-center border-b border-border bg-background pl-20 pr-3 select-none"
  >
    <span
      data-tauri-drag-region
      className="text-xs font-medium text-muted-foreground"
    >
      Remit
    </span>
  </div>
);

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
