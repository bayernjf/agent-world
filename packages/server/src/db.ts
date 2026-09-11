/**
 * Database layer public types + driver factory (design-postgres-migration.md §5.2).
 *
 * This module owns the *shape* of the database layer: the `Db` type (derived
 * from the SQLite driver), the async `DatabaseDriver` interface, the
 * `SqliteDriver` alias, and the row shapes (`Product`, `BatchJob`, …).
 * The SQLite implementation lives in `sqlite-driver.ts`; the PostgreSQL
 * implementation in `pg-driver.ts` — both behind `openDatabase()`.
 */
import type { ClientConfig } from "pg";
import { createSqliteDriver } from "./sqlite-driver.js";
import { createPgDriver } from "./pg-driver.js";

export type Db = ReturnType<typeof createSqliteDriver>;

/**
 * 异步版 driver 接口（PostgreSQL 是网络库，方法必须异步）。由 `Db` 自动
 * 推导——每个方法的返回值包成 `Promise`（`Awaited` 拍平嵌套 Promise），
 * 零手写成本。将来 `PgDriver` 实现此类型即可替换 SqliteDriver。
 * （design-postgres-migration.md §5.2）
 */
export type DatabaseDriver = {
  [K in keyof Db]: Db[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : Db[K];
};

/**
 * The SQLite driver implementation. `openDb` is the factory for this driver;
 * the returned object is its only implementation today (a future `PgDriver`
 * will be a second implementation of `DatabaseDriver`).
 * （design-postgres-migration.md §5.2 / §10.2 步骤 1）
 */
export type SqliteDriver = DatabaseDriver;

/**
 * Resolve PostgreSQL connection config from the environment. `DATABASE_URL`
 * wins; otherwise `PG_HOST` + `PG_DATABASE` (+ optional `PG_PORT` / `PG_USER`
 * / `PG_PASSWORD` / `PG_SSL=true`). Fail-closed with an actionable message
 * when neither form is present. Shared by the DB_DRIVER switch and the
 * migrate-to-postgres script. （design-postgres-migration.md §5.3 阶段 3 / §6.1）
 */
export function pgConfigFromEnv(): ClientConfig {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  const { PG_HOST, PG_DATABASE, PG_PORT, PG_USER, PG_PASSWORD, PG_SSL } = process.env;
  if (!PG_HOST || !PG_DATABASE) {
    throw new Error(
      'DB_DRIVER=postgres requires DATABASE_URL, or PG_HOST + PG_DATABASE (+ optional PG_PORT/PG_USER/PG_PASSWORD/PG_SSL)',
    );
  }
  return {
    host: PG_HOST,
    database: PG_DATABASE,
    port: PG_PORT ? Number(PG_PORT) : 5432,
    user: PG_USER,
    password: PG_PASSWORD,
    // Managed PG (Neon/RDS) requires TLS; PG_SSL=true opts in without
    // pinning a CA (SaaS deployments front this with private networking).
    ssl: PG_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  };
}

/**
 * The DB_DRIVER switch (design-postgres-migration.md §5.3 阶段 3).
 * `sqlite` (default) opens the local SQLite file; `postgres` connects to PG
 * and derives its schema from the shared DDL. Unknown values fail closed at
 * startup rather than silently falling back to SQLite.
 */
export async function openDatabase(): Promise<Db> {
  // Empty/whitespace DB_DRIVER counts as unset (a commented-out .env line
  // that leaves DB_DRIVER="" behind must not brick the default path).
  const driver = process.env.DB_DRIVER?.trim() || "sqlite";
  if (driver === "sqlite") {
    return createSqliteDriver(process.env.DB_FILE ?? "agent-world.sqlite");
  }
  if (driver === "postgres") {
    return await createPgDriver(pgConfigFromEnv());
  }
  throw new Error(`Unknown DB_DRIVER "${driver}" — expected "sqlite" or "postgres"`);
}

export interface ABArmReport {
  arm: string;
  target: string | null;
  prompt: string | null;
  runs: number;
  done: number;
  passed: number;
  passRate: number;
  avgRework: number;
  avgDurationMs: number;
  avgScore: number;
  avgCost: number;
}

export interface ABReport {
  groupId: string;
  arms: ABArmReport[];
  recommendedArm: string | null;
}

/** A reusable product row from the F4 product library. */
export interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  price: number | null;
  attributes: Record<string, unknown>;
  images: string[];
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
}

/** A reusable brand material (logo/image/snippet/guideline). */
export interface BrandAsset {
  id: string;
  type: string;
  label: string;
  uri: string;
  tags: string[];
  createdAt: number;
}

/** A batch run job (F5): one graph run per input row, grouped for progress tracking. */
export interface BatchJob {
  id: string;
  graphId: string;
  status: "pending" | "running" | "done" | "partial" | "failed" | "cancelled";
  total: number;
  succeeded: number;
  failed: number;
  sourceName: string | null;
  createdAt: number;
  finishedAt: number | null;
}

/** One row of a batch job (F5). */
export interface BatchItem {
  id: string;
  batchId: string;
  rowIndex: number;
  input: Record<string, unknown>;
  runId: string | null;
  status: "pending" | "running" | "done" | "failed";
  outputSummary: string | null;
  artifactIds: string[];
  error: string | null;
}

/** A scheduled content item on the F8 calendar. */
export interface ContentPlan {
  id: string;
  graphId: string | null;
  runId: string | null;
  artifactId: string | null;
  platform: string | null;
  title: string;
  scheduledAt: number;
  status: "draft" | "pending_review" | "scheduled" | "published" | "failed";
  publishedUrl: string | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

/** One performance metric row (F6). */
export interface ContentMetric {
  id: string;
  graphId: string | null;
  runId: string | null;
  nodeId: string | null;
  variant: string | null;
  artifactId: string | null;
  productId: string | null;
  platform: string | null;
  externalContentId: string | null;
  impressions: number;
  clicks: number;
  conversions: number;
  gmv: number;
  adSpend: number;
  recordedAt: number;
}

/** Aggregated performance buckets returned by /api/performance. */
export interface PerformanceAggregate {
  group: string;
  impressions: number;
  clicks: number;
  conversions: number;
  gmv: number;
  adSpend: number;
}

/** A content-level cost snapshot (F9). */
export interface ContentCost {
  id: string;
  artifactId: string | null;
  productId: string | null;
  platform: string | null;
  variant: string | null;
  costUsd: number;
  gmv: number;
  roi: number;
  capturedAt: number;
}

/** Content-level cost/GMV/ROI aggregate bucket. */
export interface ContentCostAggregate {
  group: string;
  costUsd: number;
  gmv: number;
  roi: number;
}

/**
 * Per-graph run rollup for the operations dashboard (RTS phase A1).
 * Counters cover the requested time window (all time when `since` is unset);
 * `last*` always reflects the most recent run regardless of the window;
 * `costUsd` reuses the node-level accounting (SUM(node_runs.cost_usd), runs
 * still running excluded — same口径 as `costForMonth`).
 */
export interface GraphRunSummary {
  graphId: string;
  graphName: string | null;
  /** Origin template id, used by the overview to resolve the display category. */
  originTemplateId?: string | null;
  /** Resolved template category (RTS stage-B B3); "自定义" for non-template graphs. */
  category?: string;
  /** Awaiting-human-review count (RTS stage-B B3); equals halted runs. */
  pendingReview?: number;
  totalRuns: number;
  running: number;
  halted: number;
  done: number;
  failed: number;
  tripped: number;
  cancelled: number;
  lastRunId: string | null;
  lastStatus: string | null;
  lastStartedAt: number | null;
  lastEndedAt: number | null;
  costUsd: number;
  /** RTS stage-B manual macro-park override (migration 37); null = auto-layout. */
  parkX?: number | null;
  parkZ?: number | null;
}

/** An open-channel publish target (F7-B). */
export interface PublishTarget {
  id: string;
  platform: string;
  name: string | null;
  provider: string;
  configEncrypted: string;
  createdAt: number;
}

/** A published-content record (F7-B). */
export interface PublishedContent {
  id: string;
  graphId: string | null;
  runId: string | null;
  artifactId: string | null;
  platform: string | null;
  status: string;
  externalId: string | null;
  externalUrl: string | null;
  publishedAt: number | null;
  detailJson: string | null;
}

// Re-export the SQLite driver factory under its historical name, plus the
// small set of public implementation symbols callers still import from `db.ts`.
export { createSqliteDriver as openDb };
export {
  contentHash,
  SCHEMA_VERSION,
  BACKUP_RETENTION,
  rollbackLatestMigration,
  backfillExistingData,
} from "./sqlite-driver.js";
