import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Logger } from "./logger.js";

describe("structured logger", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-log-"));
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("emits JSON lines with level, timestamp and bindings", () => {
    const file = join(dir, "engine.log");
    const log = new Logger({ runId: "r1" }, { file });
    log.info("hello", { nodeId: "n1" });

    const line = JSON.parse(readFileSync(file, "utf8").trim()) as Record<string, unknown>;
    expect(line.msg).toBe("hello");
    expect(line.level).toBe("info");
    expect(line.runId).toBe("r1");
    expect(line.nodeId).toBe("n1");
    expect(typeof line.ts).toBe("string");
  });

  it("filters messages below the configured level", () => {
    const file = join(dir, "engine.log");
    const log = new Logger({}, { file, level: "warn" });
    log.debug("skip-debug");
    log.info("skip-info");
    log.warn("keep-warn");
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).msg).toBe("keep-warn");
  });

  it("rotates the file when it exceeds maxBytes", () => {
    const file = join(dir, "engine.log");
    const log = new Logger({}, { file, maxBytes: 100, keep: 2 });
    for (let i = 0; i < 20; i++) log.info("x".repeat(40));
    const rotated = readdirSync(dir).filter((n) => n.startsWith("engine.log"));
    // The active file plus at least one rotated slice.
    expect(rotated).toContain("engine.log");
    expect(rotated.length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to <DB dir>/logs/server.log when LOG_FILE is unset", () => {
    const savedLogFile = process.env.LOG_FILE;
    const savedDbFile = process.env.DB_FILE;
    delete process.env.LOG_FILE;
    process.env.DB_FILE = join(dir, "data.sqlite");
    try {
      const log = new Logger();
      expect(log).toBeInstanceOf(Logger);
      log.info("default path");
      // The module-level singleton reads these envs at construction; here we
      // construct fresh, so the resolved default file must exist after a write.
      expect(existsSync(join(dir, "logs", "server.log"))).toBe(true);
    } finally {
      if (savedLogFile === undefined) delete process.env.LOG_FILE;
      else process.env.LOG_FILE = savedLogFile;
      if (savedDbFile === undefined) delete process.env.DB_FILE;
      else process.env.DB_FILE = savedDbFile;
    }
  });

  it("disables disk logging when LOG_FILE is explicitly empty", () => {
    const savedLogFile = process.env.LOG_FILE;
    const savedDbFile = process.env.DB_FILE;
    process.env.LOG_FILE = "";
    process.env.DB_FILE = join(dir, "data.sqlite");
    try {
      const log = new Logger();
      log.info("stdout only");
      // stdout is spied in beforeEach; no file may be created under the DB dir.
      expect(existsSync(join(dir, "logs", "server.log"))).toBe(false);
    } finally {
      if (savedLogFile === undefined) delete process.env.LOG_FILE;
      else process.env.LOG_FILE = savedLogFile;
      if (savedDbFile === undefined) delete process.env.DB_FILE;
      else process.env.DB_FILE = savedDbFile;
    }
  });
});
