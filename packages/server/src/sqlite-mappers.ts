/** Row → domain mappers for the shared driver body (audit P2 split). */
import { createHash } from "node:crypto";
import type { StoredArtifact } from "./artifact-store.js";
import type { Product, BatchJob, ContentPlan, ContentMetric, ContentCost } from "./db.js";

export function contentHash(doc: string): string {
  return createHash("sha256").update(doc).digest("hex").slice(0, 16);
}

export type ArtifactRow = {
  id: string;
  run_id: string;
  node_id: string;
  attempt: number | null;
  graph_id: string | null;
  role: StoredArtifact["role"];
  graph_name?: string | null;
  kind: StoredArtifact["kind"];
  mime_type: string | null;
  label: string | null;
  size_bytes: number;
  storage: StoredArtifact["storage"];
  uri: string | null;
  created_at: number;
};

export function mapArtifact(r: ArtifactRow): StoredArtifact {
  return {
    id: r.id,
    runId: r.run_id,
    nodeId: r.node_id,
    attempt: r.attempt,
    graphId: r.graph_id,
    role: r.role,
    graphName: r.graph_name ?? null,
    kind: r.kind,
    mimeType: r.mime_type ?? "",
    label: r.label,
    sizeBytes: r.size_bytes,
    storage: r.storage,
    uri: r.uri,
    createdAt: r.created_at,
  };
}

export function mapArtifacts(rows: ArtifactRow[]): StoredArtifact[] {
  return rows.map(mapArtifact);
}

/** Parse a raw products row (snake_case JSON columns) into a Product. */
export function productFromRow(r: Record<string, unknown>): Product {
  let attributes: Record<string, unknown> = {};
  let images: string[] = [];
  try {
    attributes = JSON.parse(String(r.attributes_json ?? "{}"));
  } catch {
    /* keep {} */
  }
  try {
    images = JSON.parse(String(r.images_json ?? "[]"));
  } catch {
    /* keep [] */
  }
  return {
    id: r.id as string,
    sku: (r.sku as string) ?? "",
    name: r.name as string,
    brand: (r.brand as string) ?? "",
    category: (r.category as string) ?? "",
    price: (r.price as number | null) ?? null,
    attributes,
    images,
    status: ((r.status as string) ?? "active") as "active" | "archived",
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

/** Parse a raw batch_jobs row into a BatchJob. */
export function batchFromRow(r: Record<string, unknown>): BatchJob {
  return {
    id: String(r.id),
    graphId: String(r.graph_id),
    status: String(r.status) as BatchJob["status"],
    total: Number(r.total ?? 0),
    succeeded: Number(r.succeeded ?? 0),
    failed: Number(r.failed ?? 0),
    sourceName: r.source_name ? String(r.source_name) : null,
    createdAt: Number(r.created_at),
    finishedAt: r.finished_at ? Number(r.finished_at) : null,
  };
}

/** Parse a raw content_plan row into a ContentPlan. */
export function planFromRow(r: Record<string, unknown>): ContentPlan {
  return {
    id: String(r.id),
    graphId: r.graph_id ? String(r.graph_id) : null,
    runId: r.run_id ? String(r.run_id) : null,
    artifactId: r.artifact_id ? String(r.artifact_id) : null,
    platform: r.platform ? String(r.platform) : null,
    title: String(r.title ?? ""),
    scheduledAt: Number(r.scheduled_at),
    status: String(r.status ?? "draft") as ContentPlan["status"],
    publishedUrl: r.published_url ? String(r.published_url) : null,
    note: r.note ? String(r.note) : null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

/** Parse a raw content_metrics row into a ContentMetric. */
export function metricFromRow(r: Record<string, unknown>): ContentMetric {
  return {
    id: String(r.id),
    graphId: r.graph_id ? String(r.graph_id) : null,
    runId: r.run_id ? String(r.run_id) : null,
    nodeId: r.node_id ? String(r.node_id) : null,
    variant: r.variant ? String(r.variant) : null,
    artifactId: r.artifact_id ? String(r.artifact_id) : null,
    productId: r.product_id ? String(r.product_id) : null,
    platform: r.platform ? String(r.platform) : null,
    externalContentId: r.external_content_id ? String(r.external_content_id) : null,
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    conversions: Number(r.conversions ?? 0),
    gmv: Number(r.gmv ?? 0),
    adSpend: Number(r.ad_spend ?? 0),
    recordedAt: Number(r.recorded_at),
  };
}

/** Parse a raw content_costs row into a ContentCost. */
export function costFromRow(r: Record<string, unknown>): ContentCost {
  return {
    id: String(r.id),
    artifactId: r.artifact_id ? String(r.artifact_id) : null,
    productId: r.product_id ? String(r.product_id) : null,
    platform: r.platform ? String(r.platform) : null,
    variant: r.variant ? String(r.variant) : null,
    costUsd: Number(r.cost_usd ?? 0),
    gmv: Number(r.gmv ?? 0),
    roi: Number(r.roi ?? 0),
    capturedAt: Number(r.captured_at),
  };
}


