import React from "react";
import { createRoot } from "react-dom/client";
import { RemitApp } from "./RemitApp";
import "./index.css";

// Standalone: Remit is the whole app. There's no shell to exit back to, so
// onExit is a no-op (the app is closed by closing its window).
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div className="h-screen w-screen bg-background text-foreground">
      <RemitApp onExit={() => {}} />
    </div>
  </React.StrictMode>,
);
