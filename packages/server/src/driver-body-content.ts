/** Content-domain half of the shared driver body (audit P2 follow-up split
 * out of driver-body.ts): product library, brand assets, batch jobs, content
 * calendar, performance metrics, content costs and publish targets. Keeping it
 * out of driver-body.ts lets the content feature set grow without pushing the
 * core driver past readability. Methods that call each other keep using
 * `this`, which resolves to the composed driver at call time. */
import { randomUUID } from "node:crypto";
import {
  batchFromRow, costFromRow, metricFromRow, planFromRow, productFromRow,
} from "./sqlite-mappers.js";
import type { Executor } from "./sqlite-driver.js";
import type { createStatements } from "./driver-statements.js";
import type {
  BatchItem,
  BatchJob,
  BrandAsset,
  ContentCost,
  ContentCostAggregate,
  ContentMetric,
  ContentPlan,
  PerformanceAggregate,
  Product,
  PublishTarget,
  PublishedContent,
} from "./db.js";

export function createContentMethods(
  exec: Executor,
  stmts: ReturnType<typeof createStatements>,
  dialect: "sqlite" | "postgres",
) {
  return {
    // --- Products (F4: reusable product library) ---
    async listProducts(
      userId: string,
      opts: { search?: string; category?: string; status?: string } = {},
    ): Promise<Product[]> {
      const where = ["user_id = ?"];
      const params: string[] = [userId];
      if (opts.category) {
        where.push("category = ?");
        params.push(opts.category);
      }
      if (opts.status) {
        where.push("status = ?");
        params.push(opts.status);
      }
      if (opts.search) {
        const like = `%${opts.search}%`;
        where.push(
          dialect === "postgres"
            ? "(name ILIKE ? OR brand ILIKE ? OR sku ILIKE ?)"
            : "(name LIKE ? OR brand LIKE ? OR sku LIKE ?)",
        );
        params.push(like, like, like);
      }
      const rows = await exec.all(`SELECT * FROM products WHERE ${where.join(" AND ")} ORDER BY created_at DESC`, [...params]) as Array<Record<string, unknown>>;
      return rows.map(productFromRow);
    },

    /** Active products by id, in the given order — feeds the `product` connector. */
    async getProductsByIds(userId: string, ids: string[]): Promise<Product[]> {
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => "?").join(",");
      const rows = await exec.all(`SELECT * FROM products WHERE user_id = ? AND id IN (${placeholders})`, [userId, ...ids]) as Array<Record<string, unknown>>;
      const byId = new Map(rows.map((r) => [r.id as string, productFromRow(r)]));
      return ids.map((id) => byId.get(id)).filter((p): p is Product => p != null);
    },

    async addProduct(
      userId: string,
      input: {
        sku?: string;
        name: string;
        brand?: string;
        category?: string;
        price?: number | null;
        attributes?: Record<string, unknown>;
        images?: string[];
      },
    ): Promise<Product> {
      const name = input.name.trim();
      if (!name) throw new Error("商品名不能为空");
      const id = randomUUID();
      const now = Date.now();
      await exec.run(`INSERT INTO products (id, user_id, sku, name, brand, category, price, attributes_json, images_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`, [id, userId, input.sku ?? "", name, input.brand ?? "", input.category ?? "", input.price ?? null, JSON.stringify(input.attributes ?? {}), JSON.stringify(input.images ?? []), now, now]);
      return (await this.getProductsByIds(userId, [id]))[0]!;
    },

    async updateProduct(
      id: string,
      userId: string,
      patch: {
        sku?: string;
        name?: string;
        brand?: string;
        category?: string;
        price?: number | null;
        attributes?: Record<string, unknown>;
        images?: string[];
        status?: "active" | "archived";
      },
    ): Promise<Product | undefined> {
      const cur = (await this.getProductsByIds(userId, [id]))[0];
      if (!cur) return undefined;
      const next = {
        sku: patch.sku ?? cur.sku,
        name: patch.name ?? cur.name,
        brand: patch.brand ?? cur.brand,
        category: patch.category ?? cur.category,
        price: patch.price !== undefined ? patch.price : cur.price,
        attributes: patch.attributes ?? cur.attributes,
        images: patch.images ?? cur.images,
        status: patch.status ?? cur.status,
      };
      await exec.run(`UPDATE products SET sku = ?, name = ?, brand = ?, category = ?, price = ?, attributes_json = ?, images_json = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [next.sku, next.name, next.brand, next.category, next.price, JSON.stringify(next.attributes), JSON.stringify(next.images), next.status, Date.now(), id, userId]);
      return (await this.getProductsByIds(userId, [id]))[0]!;
    },

    async deleteProduct(id: string, userId: string) {
      await exec.run(`DELETE FROM products WHERE id = ? AND user_id = ?`, [id, userId]);
    },

    // --- Brand assets (F4: reusable brand material) ---
    async listBrandAssets(userId: string): Promise<BrandAsset[]> {
      const rows = await exec.all(`SELECT * FROM brand_assets WHERE user_id = ? ORDER BY created_at DESC`, [userId]) as Array<Record<string, unknown>>;
      return rows.map((r) => {
        let tags: string[] = [];
        try {
          tags = JSON.parse(String(r.tags_json ?? "[]"));
        } catch {
          /* keep [] */
        }
        return {
          id: r.id as string,
          type: r.type as string,
          label: r.label as string,
          uri: (r.uri as string) ?? "",
          tags,
          createdAt: r.created_at as number,
        };
      });
    },

    async addBrandAsset(
      userId: string,
      input: { type: string; label: string; uri?: string; tags?: string[] },
    ): Promise<BrandAsset> {
      const label = input.label.trim();
      if (!label) throw new Error("素材名称不能为空");
      const id = randomUUID();
      const now = Date.now();
      await exec.run(`INSERT INTO brand_assets (id, user_id, type, label, uri, tags_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, userId, input.type, label, input.uri ?? "", JSON.stringify(input.tags ?? []), now]);
      return { id, type: input.type, label, uri: input.uri ?? "", tags: input.tags ?? [], createdAt: now };
    },

    async deleteBrandAsset(id: string, userId: string) {
      await exec.run(`DELETE FROM brand_assets WHERE id = ? AND user_id = ?`, [id, userId]);
    },

    // --- Batch jobs (F5: one run per input row, grouped for progress) ---
    async createBatch(input: {
      id: string;
      userId: string;
      graphId: string;
      sourceName?: string;
      rows: Record<string, unknown>[];
    }): Promise<BatchJob> {
      const now = Date.now();
      await exec.run(`INSERT INTO batch_jobs (id, user_id, graph_id, status, total, succeeded, failed, source_name, created_at)
         VALUES (?, ?, ?, 'pending', ?, 0, 0, ?, ?)`, [input.id, input.userId, input.graphId, input.rows.length, input.sourceName ?? null, now]);
      const insertItemSql = `INSERT INTO batch_items (id, batch_id, row_index, input_json, status) VALUES (?, ?, ?, ?, 'pending')`;
      for (let i = 0; i < input.rows.length; i++) {
        await exec.run(insertItemSql, [randomUUID(), input.id, i, JSON.stringify(input.rows[i])]);
      }
      return {
        id: input.id,
        graphId: input.graphId,
        status: "pending",
        total: input.rows.length,
        succeeded: 0,
        failed: 0,
        sourceName: input.sourceName ?? null,
        createdAt: now,
        finishedAt: null,
      };
    },

    async listBatches(userId: string, graphIds?: string[]): Promise<BatchJob[]> {
      // With graphIds (shared-graph visibility), scope by graph membership
      // instead of batch ownership.
      const rows = graphIds
        ? (await exec.all(`SELECT * FROM batch_jobs WHERE graph_id IN (${graphIds.map(() => "?").join(",")}) ORDER BY created_at DESC`, [...graphIds]) as Array<Record<string, unknown>>)
        : (await exec.all(`SELECT * FROM batch_jobs WHERE user_id = ? ORDER BY created_at DESC`, [userId]) as Array<Record<string, unknown>>);
      return rows.map(batchFromRow);
    },

    async getBatch(id: string, userId: string): Promise<BatchJob | null> {
      const row = await exec.get(`SELECT * FROM batch_jobs WHERE id = ? AND user_id = ?`, [id, userId]) as
        | Record<string, unknown>
        | undefined;
      return row ? batchFromRow(row) : null;
    },

    /** Unscoped batch lookup for shared-graph access (caller verified graph ACL). */
    async getBatchUnscoped(id: string): Promise<BatchJob | null> {
      const row = await exec.get(`SELECT * FROM batch_jobs WHERE id = ?`, [id]) as
        | Record<string, unknown>
        | undefined;
      return row ? batchFromRow(row) : null;
    },

    async listBatchItems(batchId: string): Promise<BatchItem[]> {
      const rows = await exec.all(`SELECT * FROM batch_items WHERE batch_id = ? ORDER BY row_index ASC`, [batchId]) as Array<Record<string, unknown>>;
      return rows.map((r) => {
        let input: Record<string, unknown> = {};
        let artifactIds: string[] = [];
        try {
          input = JSON.parse(String(r.input_json ?? "{}"));
        } catch {
          /* keep {} */
        }
        try {
          artifactIds = JSON.parse(String(r.artifact_ids_json ?? "[]"));
        } catch {
          /* keep [] */
        }
        return {
          id: String(r.id),
          batchId: String(r.batch_id),
          rowIndex: Number(r.row_index),
          input,
          runId: r.run_id ? String(r.run_id) : null,
          status: String(r.status) as BatchItem["status"],
          outputSummary: r.output_summary ? String(r.output_summary) : null,
          artifactIds,
          error: r.error ? String(r.error) : null,
        };
      });
    },

    async markBatchItemRunning(itemId: string, runId: string) {
      await exec.run(`UPDATE batch_items SET status = 'running', run_id = ? WHERE id = ?`, [runId, itemId]);
    },

    async markBatchItemDone(itemId: string, outputSummary: string | null, artifactIds: string[]) {
      await exec.run(`UPDATE batch_items SET status = 'done', output_summary = ?, artifact_ids_json = ?, error = NULL WHERE id = ?`, [outputSummary ?? "", JSON.stringify(artifactIds), itemId]);
    },

    async markBatchItemFailed(itemId: string, error: string) {
      await exec.run(`UPDATE batch_items SET status = 'failed', error = ? WHERE id = ?`, [error, itemId]);
    },

    async setBatchStatus(id: string, status: BatchJob["status"], finishedAt: number | null) {
      await exec.run(`UPDATE batch_jobs SET status = ?, finished_at = ? WHERE id = ?`, [status, finishedAt, id]);
    },

    async updateBatchCounts(id: string, succeeded: number, failed: number) {
      await exec.run(`UPDATE batch_jobs SET succeeded = ?, failed = ? WHERE id = ?`, [succeeded, failed, id]);
    },

    // --- Content calendar (F8: scheduled publishing plan) ---
    async createPlan(input: {
      id: string;
      userId: string;
      graphId?: string | null;
      runId?: string | null;
      artifactId?: string | null;
      platform?: string | null;
      title: string;
      scheduledAt: number;
      note?: string | null;
    }): Promise<ContentPlan> {
      const now = Date.now();
      await exec.run(`INSERT INTO content_plan (id, user_id, graph_id, run_id, artifact_id, platform, title, scheduled_at, status, published_url, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?, ?)`, [input.id, input.userId, input.graphId ?? null, input.runId ?? null, input.artifactId ?? null, input.platform ?? null, input.title, input.scheduledAt, input.note ?? null, now, now]);
      return {
        id: input.id,
        graphId: input.graphId ?? null,
        runId: input.runId ?? null,
        artifactId: input.artifactId ?? null,
        platform: input.platform ?? null,
        title: input.title,
        scheduledAt: input.scheduledAt,
        status: "draft",
        publishedUrl: null,
        note: input.note ?? null,
        createdAt: now,
        updatedAt: now,
      };
    },

    async listPlans(userId: string, from?: number, to?: number): Promise<ContentPlan[]> {
      const rows = (
        from != null && to != null
          ? await exec.all(`SELECT * FROM content_plan WHERE user_id = ? AND scheduled_at >= ? AND scheduled_at <= ? ORDER BY scheduled_at ASC`, [userId, from, to])
          : await exec.all(`SELECT * FROM content_plan WHERE user_id = ? ORDER BY scheduled_at ASC`, [userId])
      ) as Array<Record<string, unknown>>;
      return rows.map(planFromRow);
    },

    async getPlan(id: string, userId: string): Promise<ContentPlan | null> {
      const row = await exec.get(`SELECT * FROM content_plan WHERE id = ? AND user_id = ?`, [id, userId]) as
        | Record<string, unknown>
        | undefined;
      return row ? planFromRow(row) : null;
    },

    async updatePlan(
      id: string,
      userId: string,
      patch: Partial<{
        graphId: string | null;
        runId: string | null;
        artifactId: string | null;
        platform: string | null;
        title: string;
        scheduledAt: number;
        status: ContentPlan["status"];
        publishedUrl: string | null;
        note: string | null;
      }>,
    ): Promise<ContentPlan | null> {
      const existing = await this.getPlan(id, userId);
      if (!existing) return null;
      const next = { ...existing, ...patch, updatedAt: Date.now() };
      await exec.run(`UPDATE content_plan SET graph_id = ?, run_id = ?, artifact_id = ?, platform = ?, title = ?, scheduled_at = ?, status = ?, published_url = ?, note = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [next.graphId, next.runId, next.artifactId, next.platform, next.title, next.scheduledAt, next.status, next.publishedUrl, next.note, next.updatedAt, id, userId]);
      return next;
    },

    async deletePlan(id: string, userId: string) {
      await exec.run(`DELETE FROM content_plan WHERE id = ? AND user_id = ?`, [id, userId]);
    },

    // --- Performance metrics (F6: content effect feedback loop) ---
    async insertMetric(input: {
      id: string;
      userId: string;
      graphId?: string | null;
      runId?: string | null;
      nodeId?: string | null;
      variant?: string | null;
      artifactId?: string | null;
      productId?: string | null;
      platform?: string | null;
      externalContentId?: string | null;
      impressions?: number;
      clicks?: number;
      conversions?: number;
      gmv?: number;
      adSpend?: number;
      recordedAt: number;
    }): Promise<ContentMetric> {
      await exec.run(`INSERT INTO content_metrics (id, user_id, graph_id, run_id, node_id, variant, artifact_id, product_id, platform, external_content_id, impressions, clicks, conversions, gmv, ad_spend, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [input.id, input.userId, input.graphId ?? null, input.runId ?? null, input.nodeId ?? null, input.variant ?? null, input.artifactId ?? null, input.productId ?? null, input.platform ?? null, input.externalContentId ?? null, input.impressions ?? 0, input.clicks ?? 0, input.conversions ?? 0, input.gmv ?? 0, input.adSpend ?? 0, input.recordedAt]);
      return metricFromRow({
        id: input.id,
        graph_id: input.graphId,
        run_id: input.runId,
        node_id: input.nodeId,
        variant: input.variant,
        artifact_id: input.artifactId,
        product_id: input.productId,
        platform: input.platform,
        external_content_id: input.externalContentId,
        impressions: input.impressions ?? 0,
        clicks: input.clicks ?? 0,
        conversions: input.conversions ?? 0,
        gmv: input.gmv ?? 0,
        ad_spend: input.adSpend ?? 0,
        recorded_at: input.recordedAt,
      });
    },

    async listMetrics(userId: string): Promise<ContentMetric[]> {
      const rows = await exec.all(`SELECT * FROM content_metrics WHERE user_id = ? ORDER BY recorded_at DESC`, [userId]) as Array<Record<string, unknown>>;
      return rows.map(metricFromRow);
    },

    /** Aggregate metrics by one column (graph_id/run_id/platform/product_id/artifact_id). */
    async aggregatePerformance(userId: string, groupBy: string): Promise<PerformanceAggregate[]> {
      const allowed = new Set(["graph_id", "run_id", "node_id", "variant", "artifact_id", "product_id", "platform", "external_content_id"]);
      const col = allowed.has(groupBy) ? groupBy : "graph_id";
      const rows = await exec.all(`SELECT COALESCE(${col}, '') AS grp, SUM(impressions) AS impressions, SUM(clicks) AS clicks,
                  SUM(conversions) AS conversions, SUM(gmv) AS gmv, SUM(ad_spend) AS ad_spend
           FROM content_metrics WHERE user_id = ? GROUP BY ${col} ORDER BY impressions DESC`, [userId]) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        group: String(r.grp ?? ""),
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
        conversions: Number(r.conversions ?? 0),
        gmv: Number(r.gmv ?? 0),
        adSpend: Number(r.ad_spend ?? 0),
      }));
    },

    // --- Content costs (F9: content-level cost attribution) ---
    async insertContentCost(input: {
      id: string;
      userId: string;
      artifactId?: string | null;
      productId?: string | null;
      platform?: string | null;
      variant?: string | null;
      costUsd?: number;
      gmv?: number;
      capturedAt: number;
    }): Promise<ContentCost> {
      const costUsd = input.costUsd ?? 0;
      const gmv = input.gmv ?? 0;
      const roi = costUsd > 0 ? gmv / costUsd : 0;
      await exec.run(`INSERT INTO content_costs (id, user_id, artifact_id, product_id, platform, variant, cost_usd, gmv, roi, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [input.id, input.userId, input.artifactId ?? null, input.productId ?? null, input.platform ?? null, input.variant ?? null, costUsd, gmv, roi, input.capturedAt]);
      return {
        id: input.id,
        artifactId: input.artifactId ?? null,
        productId: input.productId ?? null,
        platform: input.platform ?? null,
        variant: input.variant ?? null,
        costUsd,
        gmv,
        roi,
        capturedAt: input.capturedAt,
      };
    },

    async listContentCosts(userId: string): Promise<ContentCost[]> {
      const rows = await exec.all(`SELECT * FROM content_costs WHERE user_id = ? ORDER BY captured_at DESC`, [userId]) as Array<Record<string, unknown>>;
      return rows.map(costFromRow);
    },

    /** Aggregate content costs by artifact_id/product_id/platform/variant. */
    async aggregateContentCosts(userId: string, groupBy: string): Promise<ContentCostAggregate[]> {
      const allowed = new Set(["artifact_id", "product_id", "platform", "variant"]);
      const col = allowed.has(groupBy) ? groupBy : "artifact_id";
      const rows = await exec.all(`SELECT COALESCE(${col}, '') AS grp, SUM(cost_usd) AS cost_usd, SUM(gmv) AS gmv
           FROM content_costs WHERE user_id = ? GROUP BY ${col} ORDER BY cost_usd DESC`, [userId]) as Array<Record<string, unknown>>;
      return rows.map((r) => {
        const costUsd = Number(r.cost_usd ?? 0);
        const gmv = Number(r.gmv ?? 0);
        return {
          group: String(r.grp ?? ""),
          costUsd,
          gmv,
          roi: costUsd > 0 ? gmv / costUsd : 0,
        };
      });
    },

    // --- Publish targets & published contents (F7-B) ---
    async createPublishTarget(input: {
      id: string;
      userId: string;
      platform: string;
      name?: string | null;
      provider: string;
      configEncrypted: string;
      createdAt: number;
    }): Promise<PublishTarget> {
      await exec.run(`INSERT INTO publish_targets (id, user_id, platform, name, provider, config_encrypted, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`, [input.id, input.userId, input.platform, input.name ?? null, input.provider, input.configEncrypted, input.createdAt]);
      return {
        id: input.id,
        platform: input.platform,
        name: input.name ?? null,
        provider: input.provider,
        configEncrypted: input.configEncrypted,
        createdAt: input.createdAt,
      };
    },

    async listPublishTargets(userId: string): Promise<PublishTarget[]> {
      return (await exec.all(`SELECT * FROM publish_targets WHERE user_id = ? ORDER BY created_at DESC`, [userId]))
        .map((r) => ({
          id: String(r.id),
          platform: String(r.platform),
          name: r.name ? String(r.name) : null,
          provider: String(r.provider),
          configEncrypted: String(r.config_encrypted),
          createdAt: Number(r.created_at),
        }));
    },

    async deletePublishTarget(id: string, userId: string): Promise<boolean> {
      const r = await exec.run(`DELETE FROM publish_targets WHERE id = ? AND user_id = ?`, [id, userId]);
      return r.changes > 0;
    },

    /** Cross-user lookup for the metrics webhook (no session user in an inbound webhook). */
    async getPublishTarget(id: string): Promise<(PublishTarget & { userId: string }) | null> {
      const r = await exec.get(`SELECT * FROM publish_targets WHERE id = ?`, [id]) as Record<string, unknown> | undefined;
      if (!r) return null;
      return {
        id: String(r.id),
        userId: String(r.user_id),
        platform: String(r.platform),
        name: r.name ? String(r.name) : null,
        provider: String(r.provider),
        configEncrypted: String(r.config_encrypted),
        createdAt: Number(r.created_at),
      };
    },

    async insertPublishedContent(input: {
      id: string;
      userId: string;
      graphId?: string | null;
      runId?: string | null;
      artifactId?: string | null;
      platform?: string | null;
      status: string;
      externalId?: string | null;
      externalUrl?: string | null;
      publishedAt?: number | null;
      detailJson?: string | null;
    }): Promise<PublishedContent> {
      await exec.run(`INSERT INTO published_contents (id, user_id, graph_id, run_id, artifact_id, platform, status, external_id, external_url, published_at, detail_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [input.id, input.userId, input.graphId ?? null, input.runId ?? null, input.artifactId ?? null, input.platform ?? null, input.status, input.externalId ?? null, input.externalUrl ?? null, input.publishedAt ?? null, input.detailJson ?? null]);
      return {
        id: input.id,
        graphId: input.graphId ?? null,
        runId: input.runId ?? null,
        artifactId: input.artifactId ?? null,
        platform: input.platform ?? null,
        status: input.status,
        externalId: input.externalId ?? null,
        externalUrl: input.externalUrl ?? null,
        publishedAt: input.publishedAt ?? null,
        detailJson: input.detailJson ?? null,
      };
    },

    async listPublishedContents(userId: string): Promise<PublishedContent[]> {
      return (await exec.all(`SELECT * FROM published_contents WHERE user_id = ? ORDER BY published_at DESC`, [userId]))
        .map((r) => ({
          id: String(r.id),
          graphId: r.graph_id ? String(r.graph_id) : null,
          runId: r.run_id ? String(r.run_id) : null,
          artifactId: r.artifact_id ? String(r.artifact_id) : null,
          platform: r.platform ? String(r.platform) : null,
          status: String(r.status),
          externalId: r.external_id ? String(r.external_id) : null,
          externalUrl: r.external_url ? String(r.external_url) : null,
          publishedAt: r.published_at != null ? Number(r.published_at) : null,
          detailJson: r.detail_json ? String(r.detail_json) : null,
        }));
    },

    /** Fetch one published-content row owned by the user (ops M2 drafts). */
    async getPublishedContent(id: string, userId: string): Promise<PublishedContent | null> {
      const r = await exec.get(`SELECT * FROM published_contents WHERE id = ? AND user_id = ?`, [id, userId]) as Record<string, unknown> | undefined;
      if (!r) return null;
      return {
        id: String(r.id),
        graphId: r.graph_id ? String(r.graph_id) : null,
        runId: r.run_id ? String(r.run_id) : null,
        artifactId: r.artifact_id ? String(r.artifact_id) : null,
        platform: r.platform ? String(r.platform) : null,
        status: String(r.status),
        externalId: r.external_id ? String(r.external_id) : null,
        externalUrl: r.external_url ? String(r.external_url) : null,
        publishedAt: r.published_at != null ? Number(r.published_at) : null,
        detailJson: r.detail_json ? String(r.detail_json) : null,
      };
    },

    /**
     * Advance a draft through its lifecycle. Returns changed rows (0 when the
     * draft is missing or owned by another user), so the caller fails loud.
     */
    async updatePublishedContent(id: string, userId: string, patch: {
      status: string;
      externalId?: string | null;
      externalUrl?: string | null;
      publishedAt?: number | null;
      detailJson?: string | null;
    }): Promise<number> {
      const sets = ["status = ?"];
      const args: unknown[] = [patch.status];
      if (patch.externalId !== undefined) { sets.push("external_id = ?"); args.push(patch.externalId); }
      if (patch.externalUrl !== undefined) { sets.push("external_url = ?"); args.push(patch.externalUrl); }
      if (patch.publishedAt !== undefined) { sets.push("published_at = ?"); args.push(patch.publishedAt); }
      if (patch.detailJson !== undefined) { sets.push("detail_json = ?"); args.push(patch.detailJson); }
      args.push(id, userId);
      const r = await exec.run(
        `UPDATE published_contents SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
        args,
      );
      return r.changes;
    },  };
}
