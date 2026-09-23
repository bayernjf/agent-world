import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Default backend for local development. Playwright runs the server on an
// isolated port and points the dev server at it via VITE_API_PROXY_TARGET so
// E2E never shares a developer's already-running server (and its real DB).
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8791";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
});
