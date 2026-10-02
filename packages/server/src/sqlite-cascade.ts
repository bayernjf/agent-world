/** Demo-cascade table lists (audit P2 split). */
export const DEMO_CASCADE_INDIRECT_TABLES: ReadonlyArray<readonly [string, "run_id" | "graph_id"]> = [
  ["node_runs", "run_id"],
  ["events", "run_id"],
  ["batch_items", "run_id"],
  ["graph_variables", "graph_id"],
  ["graph_versions", "graph_id"],
];
export const DEMO_CASCADE_DIRECT_TABLES: readonly string[] = [
  "artifacts", "audit_log", "announcement_reads", "banned_terms", "batch_jobs",
  "brand_assets", "brand_terms", "content_costs", "content_metrics", "content_plan",
  "feedback", "idempotency_keys", "invoices", "products", "publish_targets",
  "published_contents", "remote_jobs", "resource_access", "runs", "settings", "subscriptions",
  "usage_ledger", "graphs",
];
/** Tables with no per-user ownership — never touched by a demo cascade.
 *  (schema_migrations is runtime bookkeeping and is not part of the DDL constant.) */
export const DEMO_CASCADE_GLOBAL_TABLES: readonly string[] = [
  "users", "announcements",
];
