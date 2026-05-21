import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import * as path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirror the editor build's @/* alias so component imports resolve in tests.
    alias: { "@": path.join(__dirname, "editor") },
  },
  test: {
    environment: "jsdom",
    include: [
      "editor/agent-chat/__tests__/**/*.test.{ts,tsx}",
      "editor/__tests__/**/*.test.{ts,tsx}",
    ],
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
  },
});
