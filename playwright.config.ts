import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

// Every run gets a fresh throwaway data dir. The server derives the SQLite DB,
// JWT secret, at-rest encryption keys, artifact store and logs from DB_FILE's
// directory, so pointing DB_FILE at a unique temp dir keeps the E2E run fully
// isolated from any real local/production data. The dir is removed on exit.
const dataDir = mkdtempSync(join(tmpdir(), "agent-world-e2e-"));
const dbFile = join(dataDir, "agent-world.sqlite");
const cleanup = () => rmSync(dataDir, { recursive: true, force: true });
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    cleanup();
    process.exit(sig === "SIGINT" ? 130 : 143);
  });
}

// The smoke suite never runs a pipeline (it only opens the app and starts a
// demo), so no provider keys or paid-plan flags are required. ALLOW_DEMO=1
// turns on the one-click demo entry; demo seeding is text-only and cheap.
const SERVER_ENV = {
  ...process.env,
  ALLOW_DEMO: "1",
  DB_FILE: dbFile,
  PORT: "8791",
};

export default defineConfig({
  testDir: "./e2e",
  // Smoke tests share one seeded server; keep them serial to avoid demo
  // per-IP rate limiting and cross-test state races.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // tsx runs the server straight from TS (no build step). @agent-world/core
      // must already be built (run `pnpm -r build` once after a fresh install).
      command: "pnpm exec tsx src/index.ts",
      cwd: join(root, "packages/server"),
      env: SERVER_ENV,
      url: "http://localhost:8791/api/health",
      timeout: 60_000,
      // Reuse a server the developer already has running instead of failing on
      // the port; CI always starts its own isolated instance.
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "pnpm --filter @agent-world/web dev",
      cwd: root,
      url: "http://localhost:5173",
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
