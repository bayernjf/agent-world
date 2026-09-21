/**
 * Process-level error capture and aggregation.
 *
 * Before this module the server only had Prometheus counters (`metrics.ts`) and
 * per-request log lines: an exception that escaped every try/catch either
 * crashed the process with an unstructured stack trace (uncaughtException) or
 * vanished into Node's default unhandledRejection warning. Nothing retained the
 * error message/stack for post-mortem, and there was no hook for an external
 * tracker such as Sentry.
 *
 * Design mirrors `metrics.ts`: zero npm dependencies, a bounded in-memory ring
 * buffer (single-instance self-hosting), a module-level singleton and a
 * `clearErrors()` reset for tests. On top of the buffer sits a small, pluggable
 * `ErrorSink` interface — wiring Sentry later is one `addErrorSink()` call (see
 * `createWebhookErrorSink` for a dependency-free reference implementation), no
 * call-site changes required.
 *
 * Privacy: only what call sites explicitly pass in is retained. The request
 * handler passes method/path only — never headers, bodies, cookies or query
 * strings (which can carry tokens, see the request-log middleware).
 */
import { randomUUID } from "node:crypto";
import { log } from "./logger.js";

export type ErrorKind =
  | "uncaught_exception"
  | "unhandled_rejection"
  | "request"
  | "worker"
  | "manual";

export interface ErrorRecord {
  /** Stable id, also usable to de-duplicate when fanning out to sinks. */
  id: string;
  /** ISO-8601 capture time. */
  ts: string;
  /** Where the error originated. */
  kind: ErrorKind;
  /** Error constructor name (`TypeError`, `HTTPException`, ...). */
  name: string;
  message: string;
  /** Stack trace, truncated to {@link MAX_STACK_CHARS}; absent when unavailable. */
  stack?: string;
  /** Whitelisted context (method/path/runId/nodeId ...). Never secrets. */
  bindings?: Record<string, unknown>;
}

export interface ErrorSink {
  /**
   * Receives every captured record. May be async (fire-and-forget from the
   * recorder). A throwing sink is isolated so it can never break the process
   * or the request that produced the error.
   */
  capture(rec: ErrorRecord): void | Promise<void>;
}

export interface ProcessGuardsOptions {
  /**
   * Invoked after an `uncaughtException` is recorded. The process is in an
   * undefined state after an uncaught exception, so production wires this to a
   * graceful shutdown that lets in-flight runs drain before the supervisor
   * (systemd) restarts a clean process. When omitted, the exception is recorded
   * and logged but the process is not exited (used by tests).
   */
  onFatal?: (err: unknown) => void;
}

const DEFAULT_CAPACITY = 100;
const MAX_STACK_CHARS = 4000;

const buffer: ErrorRecord[] = [];
const sinks = new Set<ErrorSink>();
let capacity = DEFAULT_CAPACITY;
let guardsInstalled = false;
let uninstallGuards: (() => void) | null = null;

/** Coerce anything thrown/rejected (Error, string, plain object, null) into a stable shape. */
function normalize(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return {
      name: err.name || "Error",
      message: err.message || String(err),
      stack: err.stack ? truncate(err.stack, MAX_STACK_CHARS) : undefined,
    };
  }
  if (err === null || err === undefined) {
    return { name: "Error", message: String(err) };
  }
  if (typeof err === "string") {
    return { name: "Error", message: err };
  }
  // Non-Error throw (plain object / number / ...): best-effort, never throw here.
  let name = "Error";
  let message: string;
  try {
    const anyErr = err as { name?: unknown; message?: unknown };
    if (typeof anyErr.name === "string" && anyErr.name) name = anyErr.name;
    message = typeof anyErr.message === "string" && anyErr.message
      ? anyErr.message
      : safeStringify(err);
  } catch {
    try {
      message = String(err);
    } catch {
      message = "[unserializable thrown value]";
    }
  }
  return { name, message };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…[truncated]`;
}

function safeStringify(value: unknown): string {
  try {
    return truncate(JSON.stringify(value) ?? String(value), MAX_STACK_CHARS);
  } catch {
    return "[unserializable thrown value]";
  }
}

/**
 * Record an error: retain it in the ring buffer, write a structured error log
 * and fan out to every registered sink. Never throws — error capture must not
 * itself become a failure path.
 */
export function recordError(
  kind: ErrorKind,
  err: unknown,
  bindings?: Record<string, unknown>,
): ErrorRecord {
  const n = normalize(err);
  const rec: ErrorRecord = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    kind,
    name: n.name,
    message: n.message,
    ...(n.stack ? { stack: n.stack } : {}),
    ...(bindings && Object.keys(bindings).length ? { bindings } : {}),
  };

  buffer.push(rec);
  while (buffer.length > capacity) buffer.shift();

  log.error("captured error", {
    kind: rec.kind,
    name: rec.name,
    message: rec.message,
    errorId: rec.id,
    ...(rec.bindings ?? {}),
  });

  for (const sink of sinks) {
    try {
      const maybe = sink.capture(rec);
      if (maybe && typeof (maybe as Promise<void>).then === "function") {
        (maybe as Promise<void>).catch(() => {
          /* sink failure must never propagate */
        });
      }
    } catch {
      /* a throwing sink is isolated */
    }
  }

  return rec;
}

/** Register an error sink. Returns an unsubscribe function. Idempotent per sink. */
export function addErrorSink(sink: ErrorSink): () => void {
  sinks.add(sink);
  return () => {
    sinks.delete(sink);
  };
}

/** Most-recent-first snapshot of retained errors, optionally capped by `limit`. */
export function recentErrors(limit = capacity): ErrorRecord[] {
  const n = Math.max(0, Math.min(limit, buffer.length));
  return buffer.slice(buffer.length - n).reverse().map((r) => ({ ...r }));
}

/** Current retained count (buffer may be smaller than capacity pre-warmup). */
export function errorCount(): number {
  return buffer.length;
}

/** Clear the buffer and sinks — test only. */
export function clearErrors(): void {
  buffer.length = 0;
  sinks.clear();
  capacity = DEFAULT_CAPACITY;
}

/**
 * Override ring-buffer capacity — test only. Existing records beyond the new
 * capacity are dropped immediately.
 */
export function setErrorCapacity(n: number): void {
  capacity = Math.max(1, Math.floor(n));
  while (buffer.length > capacity) buffer.shift();
}

/**
 * Install process-level guards for `uncaughtException` and `unhandledRejection`.
 *
 * Idempotent: a second call without uninstalling first is a no-op and returns
 * the existing uninstaller. The returned function removes the listeners (used
 * by tests so process hooks never leak across files).
 */
export function installProcessGuards(opts: ProcessGuardsOptions = {}): () => void {
  if (guardsInstalled && uninstallGuards) return uninstallGuards;

  const onUncaught = (err: unknown) => {
    recordError("uncaught_exception", err);
    if (opts.onFatal) {
      try {
        opts.onFatal(err);
      } catch (hookErr) {
        log.error("fatal hook failed", { error: String(hookErr) });
      }
    }
  };
  const onRejected = (reason: unknown) => {
    recordError("unhandled_rejection", reason);
  };

  process.on("uncaughtException", onUncaught);
  process.on("unhandledRejection", onRejected);
  guardsInstalled = true;

  uninstallGuards = () => {
    process.off("uncaughtException", onUncaught);
    process.off("unhandledRejection", onRejected);
    guardsInstalled = false;
    uninstallGuards = null;
  };
  return uninstallGuards;
}

export interface WebhookSinkOptions {
  /** Destination receiving `POST application/json` with the ErrorRecord body. */
  url: string;
  /** Injection seam for tests; defaults to global fetch. */
  fetchImpl?: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<unknown>;
}

/**
 * Dependency-free reference sink: POSTs each record as JSON to a URL. This can
 * point at a self-hosted relay, a Grafana/Elastic intake, or an AWS Lambda that
 * forwards to Sentry — letting us adopt external error tracking without adding
 * the Sentry SDK to the self-hosted build. Fire-and-forget; network failures
 * are logged once and swallowed (never re-recorded, to avoid an error loop).
 */
export function createWebhookErrorSink(options: WebhookSinkOptions): ErrorSink {
  const post = options.fetchImpl ?? ((url, init) => fetch(url, init));
  return {
    capture(rec) {
      const body = JSON.stringify(rec);
      Promise.resolve()
        .then(() => post(options.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }))
        .catch((err) => {
          log.error("error webhook sink failed", { url: options.url, error: String(err) });
        });
    },
  };
}
