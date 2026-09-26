import { closeSync, existsSync, openSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * `isolation.ts` resolves its subprocess entry points relative to the compiled
 * module (`new URL("./worker-proxy.mjs", import.meta.url)`), so in a deployed
 * build those files must sit next to `dist/*.js`. `tsc` only emits what it
 * compiles, so a build script of plain `tsc` ships a dist with zero `.mjs`:
 * every plugin declaring `isolation: "subprocess"` is then refused at load
 * (fail-closed, so it is safe — but silently unavailable), and no test that runs
 * from source can see it. Nothing else in the pipeline catches it either,
 * because CI builds and E2E starts the server with `tsx src/index.ts`.
 */

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcMjs = readdirSync(join(pkgRoot, "src")).filter((f) => f.endsWith(".mjs"));
const distExists = existsSync(join(pkgRoot, "dist", "index.js"));

describe("the build ships the .mjs files isolation.ts resolves", () => {
  it("there are .mjs files to ship (otherwise this guard is vacuous)", () => {
    expect(srcMjs.length).toBeGreaterThan(0);
  });

  it("the build script copies them instead of leaving it to tsc", () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
      scripts?: { build?: string };
    };
    const build = pkg.scripts?.build ?? "";
    expect(build, "build must copy src/*.mjs into dist; tsc never emits .mjs").toMatch(/src\/\*\.mjs/);
    expect(build).toMatch(/dist\/?/);
  });

  it("a built dist contains one copy per src .mjs", { skip: !distExists }, () => {
    const missing = srcMjs.filter((f) => !existsSync(join(pkgRoot, "dist", f)));
    expect(missing, `dist is missing ${missing.join(", ")} — run pnpm --filter @agent-world/server build`).toEqual([]);
  });

  /**
   * The reason the copy step exists at all is that nothing ever started the
   * built artifact. Booting `dist/index.js` once per suite run makes "it
   * compiles" and "it runs as deployed" two separate claims, and keeps a future
   * build-script edit from shipping something that cannot come up.
   */
  it(
    "the built dist boots and answers its health probe",
    { skip: !distExists, timeout: 60_000 },
    async () => {
      const port = 20_000 + (process.pid % 10_000);
      const dbFile = join(tmpdir(), `aw-dist-smoke-${process.pid}.sqlite`);
      const logFile = join(tmpdir(), `aw-dist-smoke-${process.pid}.log`);
      // The child's output goes to a file rather than /dev/null: a boot that
      // fails for an unrelated reason is otherwise indistinguishable from one
      // that is merely slow, and "it never came up" would be a misleading
      // failure message.
      const logFd = openSync(logFile, "a");
      const child = spawn(process.execPath, [join(pkgRoot, "dist", "index.js")], {
        env: {
          ...process.env,
          PORT: String(port),
          DB_FILE: dbFile,
          AGNES_API_KEY: "sk-dist-smoke",
          // `development`, not `test`: index.ts only calls serve() outside the
          // test environment, so NODE_ENV=test boots everything except the
          // listener this probe needs.
          NODE_ENV: "development",
          JWT_SECRET: "dist-smoke-jwt",
          AGENT_WORLD_ENCRYPTION_KEYS: "dist-smoke-enc",
        },
        stdio: ["ignore", logFd, logFd],
      });
      closeSync(logFd);
      child.unref();
      const readLog = () => {
        try {
          return readFileSync(logFile, "utf8").split("\n").slice(-12).join("\n");
        } catch {
          return "(no boot log)";
        }
      };
      try {
        let health: { ok?: boolean; schemaVersion?: number } | null = null;
        for (let attempt = 0; attempt < 120 && !health; attempt += 1) {
          await new Promise((res) => setTimeout(res, 250));
          if (child.exitCode !== null) break;
          try {
            const res = await fetch(`http://127.0.0.1:${port}/api/health`);
            if (res.ok) health = (await res.json()) as { ok?: boolean; schemaVersion?: number };
          } catch {
            /* not listening yet */
          }
        }
        expect(
          health,
          `dist/index.js never answered GET /api/health on :${port} (exit ${child.exitCode})\n${readLog()}`,
        ).not.toBeNull();
        expect(health!.ok).toBe(true);
      } finally {
        child.kill();
        for (const suffix of ["", "-wal", "-shm"]) {
          rmSync(dbFile + suffix, { force: true });
        }
        rmSync(logFile, { force: true });
      }
    },
  );
});
