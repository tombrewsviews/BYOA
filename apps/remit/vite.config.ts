import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import * as path from "path";

// Standalone Remit SPA. root is apps/remit/ (index.html at root), output to
// dist/ (the .app's frontendDist). No shell publicDir needed — Remit's PDF
// template + signature ship as bundled src/assets/ imports.
export default defineConfig({
  plugins: [tailwindcss(), react()],
  // Tauri dev server: fixed port, no auto-open, fail if the port is taken.
  clearScreen: false,
  server: { port: 5175, strictPort: true },
  resolve: {
    alias: { "@": path.join(__dirname, "src") },
  },
});
