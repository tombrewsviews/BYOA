import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite serves the INTERACTIVE player app (app/ + index.html).
// The Remotion Studio (`npm run dev`) is separate and does not use this.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
