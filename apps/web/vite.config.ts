import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Default backend for local development. Playwright runs the server on an
// isolated port and points the dev server at it via VITE_API_PROXY_TARGET so
// E2E never shares a developer's already-running server (and its real DB).
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8791";

// Keep the first-load bundle split by vendor family so the app code in
// `index-*.js` stays small and vendor chunks cache across releases. `three`
// must stay out of these groups: it is already reachable only through the
// lazy Canvas3D/iso3d chunks and must not become eager.
const vendorChunkPatterns: Array<[string, RegExp]> = [
  ["vendor-react", /node_modules\/(react|react-dom|scheduler)\//],
  ["vendor-router", /node_modules\/(react-router|react-router-dom)\//],
  ["vendor-i18n", /node_modules\/(i18next|react-i18next|i18next-[^/]+)\//],
  ["vendor-state", /node_modules\/(zustand|zundo)\//],
  ["vendor-dompurify", /node_modules\/dompurify\//],
];

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
          for (const [name, pattern] of vendorChunkPatterns) {
            if (pattern.test(id)) return name;
          }
          if (!id.includes("/node_modules/")) return undefined;
          // three is only reachable from the lazy canvas chunks; forcing it
          // into a vendor group would pull it back into the first load.
          if (/node_modules\/three\//.test(id)) return undefined;
          return "vendor-misc";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
});
