import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// E2E runs on isolated ports (not the 8791/5173 used by local dev) so it never
// reuses a developer's already-running server or its real database.
const SERVER_PORT = process.env.E2E_SERVER_PORT ?? "8792";
const WEB_PORT = process.env.E2E_WEB_PORT ?? "5174";

// Give every test run its own SQLite file; never touch a real agent-world.db.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aw-e2e-"));
const dbFile = path.join(tmpDir, "agent-world-e2e.db");

// The suites never run a pipeline (they only open the app, start a demo, and
// exercise auth/onboarding/settings), so no provider keys or paid-plan flags
// are required. ALLOW_DEMO=1 turns on the one-click demo entry; demo seeding
// is text-only and cheap. ALLOW_REGISTRATION=1 keeps self-registration open
// after the first account bootstraps the throwaway DB, so the authenticated
// specs can each provision a unique account.
const SERVER_ENV = {
  ...process.env,
  ALLOW_DEMO: "1",
  ALLOW_REGISTRATION: "1",
  DB_FILE: dbFile,
  PORT: SERVER_PORT,
} as const;

const apiTarget = `http://localhost:${SERVER_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "on-first-retry",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      // Backend on the isolated E2E port with a throwaway DB. Config loads as
      // ESM (package.json "type": "module"), so use process.cwd() (the repo
      // root, from which Playwright runs) instead of __dirname.
      cwd: path.join(process.cwd(), "packages/server"),
      command: "pnpm exec tsx src/index.ts",
      env: SERVER_ENV,
      url: `http://localhost:${SERVER_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // Frontend dev server, proxying /api to the isolated backend.
      command: `pnpm --filter @agent-world/web exec vite --port ${WEB_PORT} --strictPort`,
      env: { ...process.env, VITE_API_PROXY_TARGET: apiTarget },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
