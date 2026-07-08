import { defineConfig } from "vitest/config";

// Standalone config so vitest does NOT walk up and inherit the Tauri app's
// vite.config.ts (jsdom environment + React setup files).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
