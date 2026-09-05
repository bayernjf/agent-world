import { appendFileSync, existsSync, renameSync, statSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_KEEP = 3;

export interface LoggerOptions {
  level?: LogLevel;
  file?: string;
  maxBytes?: number;
  keep?: number;
}

/**
 * Default on-disk log location: `<DB dir>/logs/server.log`. Falling back to the
 * DB's directory (same pattern as `.encryption-key`) makes logs durable even
 * when `LOG_FILE` is not set, so post-mortems survive a process restart.
 */
function defaultLogFile(): string | undefined {
  // A test/instrumented process sets this to the empty string to opt out of
  // disk logging entirely (logs go to stdout only).
  if (process.env.LOG_FILE !== undefined) {
    return process.env.LOG_FILE === "" ? undefined : process.env.LOG_FILE;
  }
  const dbFile = process.env.DB_FILE ?? "agent-world.sqlite";
  return join(dirname(dbFile), "logs", "server.log");
}

/**
 * Minimal structured JSON-line logger. Every line carries an ISO timestamp, a
 * level, a message and arbitrary bindings (runId, nodeId, ...). When a log file
 * is configured it additionally appends to disk with size-based rotation, so
 * long-running engines (and post-mortems) have durable, greppable logs without
 * an external dependency.
 */
export class Logger {
  private readonly level: number;
  private readonly file: string | undefined;
  private readonly maxBytes: number;
  private readonly keep: number;
  private bytesWritten = 0;

  constructor(
    private readonly bindings: Record<string, unknown> = {},
    opts: LoggerOptions = {},
  ) {
    this.level = LEVEL_WEIGHT[opts.level ?? parseLevel(process.env.LOG_LEVEL)];
    this.file = opts.file ?? defaultLogFile();
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.keep = opts.keep ?? DEFAULT_KEEP;
    if (this.file && existsSync(this.file)) {
      try {
        this.bytesWritten = statSync(this.file).size;
      } catch {
        this.bytesWritten = 0;
      }
    }
  }

  child(bindings: Record<string, unknown>): Logger {
    return new Logger({ ...this.bindings, ...bindings }, {
      level: this.currentLevel(),
      file: this.file,
      maxBytes: this.maxBytes,
      keep: this.keep,
    });
  }

  debug(msg: string, extra?: Record<string, unknown>): void {
    this.write("debug", msg, extra);
  }
  info(msg: string, extra?: Record<string, unknown>): void {
    this.write("info", msg, extra);
  }
  warn(msg: string, extra?: Record<string, unknown>): void {
    this.write("warn", msg, extra);
  }
  error(msg: string, extra?: Record<string, unknown>): void {
    this.write("error", msg, extra);
  }

  private currentLevel(): LogLevel {
    return (Object.keys(LEVEL_WEIGHT) as LogLevel[]).find(
      (l) => LEVEL_WEIGHT[l] === this.level,
    )!;
  }

  private write(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[level] < this.level) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...this.bindings,
      ...(extra ?? {}),
    });
    process.stdout.write(line + "\n");
    if (this.file) this.appendToFile(line);
  }

  private appendToFile(line: string): void {
    if (!this.file) return;
    try {
      if (this.bytesWritten >= this.maxBytes) this.rotate();
      const payload = line + "\n";
      // Ensure the parent directory exists (e.g. the default <DB dir>/logs/)
      // before the very first write; appendFileSync won't create it.
      try {
        mkdirSync(dirname(this.file), { recursive: true });
      } catch {
        // dir may already exist or be unwritable; the append below will surface
        // that as the real error.
      }
      appendFileSync(this.file, payload, { encoding: "utf8" });
      this.bytesWritten += Buffer.byteLength(payload);
    } catch (err) {
      // Never let logging break the run; surface on stderr once.
      process.stderr.write(`[logger] failed to write ${this.file}: ${String(err)}\n`);
    }
  }

  private rotate(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
    } catch {
      // dir may already exist
    }
    for (let i = this.keep - 1; i >= 1; i--) {
      const from = `${this.file}.${i}`;
      const to = `${this.file}.${i + 1}`;
      if (existsSync(from)) {
        try {
          renameSync(from, to);
        } catch {
          // best effort
        }
      }
    }
    if (existsSync(this.file)) {
      try {
        renameSync(this.file, `${this.file}.1`);
      } catch {
        // best effort
      }
    }
    this.bytesWritten = 0;
  }
}

function parseLevel(raw?: string): LogLevel {
  if (raw && raw in LEVEL_WEIGHT) return raw as LogLevel;
  return "info";
}

export const log = new Logger();
