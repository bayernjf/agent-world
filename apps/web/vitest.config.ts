import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // Default is 5000ms; slow local machines (and CI runners under load) can
    // exceed that with real-timer async tests, producing false "Test timed out"
    // flakes. 10s is still far below anything a genuinely stuck test would hit.
    testTimeout: 10000,
  },
});
