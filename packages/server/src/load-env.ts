import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load a local `.env` (gitignored) before any module that reads `process.env`
 * is evaluated — index.ts imports this file first so values like
 * AGNES_API_KEY are available when config.ts builds the built-in provider.
 *
 * Searches the repo root first (where a project-wide `.env` naturally lives),
 * then the process cwd (e.g. packages/server when started via pnpm). Missing
 * file and invalid lines are non-fatal: the server still boots, and any
 * secret-dependent feature simply fails closed at call time.
 */
function tryLoadEnv(file: string): void {
  if (!existsSync(file)) return;
  try {
    process.loadEnvFile(file);
  } catch (err) {
    console.warn(`[env] failed to load ${file}:`, (err as Error).message);
  }
}

// packages/server/src -> repo root.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

tryLoadEnv(resolve(repoRoot, ".env"));
tryLoadEnv(resolve(process.cwd(), ".env"));
