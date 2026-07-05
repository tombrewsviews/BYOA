import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div className="p-8 text-foreground">Remit scaffold OK</div>
  </React.StrictMode>,
);
