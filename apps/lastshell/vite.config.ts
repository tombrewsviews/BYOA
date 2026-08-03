import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone LAST SHELL SPA. Tauri dev server on a fixed port so
// tauri.conf.json's devUrl matches; 5178 avoids brainstorm (5175).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5178, strictPort: true },
});
