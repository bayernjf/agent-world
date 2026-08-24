import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5183,
    proxy: {
      "/api": { target: "http://localhost:8791", changeOrigin: true },
    },
  },
});
