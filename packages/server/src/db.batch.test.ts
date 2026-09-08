import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db.js";

describe("batch jobs db (F5)", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-batch-"));
    db = openDb(join(dir, "test.sqlite"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a batch with items and tracks their lifecycle", async () => {
    const batch = await db.createBatch({
      id: "b1",
      userId: "u1",
      graphId: "g1",
      sourceName: "清单.csv",
      rows: [{ name: "A" }, { name: "B" }],
    });
    expect(batch.total).toBe(2);
    expect(batch.status).toBe("pending");

    const items = await db.listBatchItems("b1");
    expect(items.length).toBe(2);
    expect(items[0]!.rowIndex).toBe(0);
    expect(items[0]!.input).toEqual({ name: "A" });
    expect(items[1]!.input).toEqual({ name: "B" });

    await db.markBatchItemRunning(items[0]!.id, "run-1");
    await db.markBatchItemDone(items[0]!.id, "ok", ["art-1"]);
    await db.markBatchItemFailed(items[1]!.id, "boom");
    await db.updateBatchCounts("b1", 1, 1);
    await db.setBatchStatus("b1", "partial", Date.now());

    const after = await db.getBatch("b1", "u1");
    expect(after?.succeeded).toBe(1);
    expect(after?.failed).toBe(1);
    expect(after?.status).toBe("partial");
    expect(after?.finishedAt).not.toBeNull();

    const itemsAfter = await db.listBatchItems("b1");
    expect(itemsAfter[0]!.status).toBe("done");
    expect(itemsAfter[0]!.artifactIds).toEqual(["art-1"]);
    expect(itemsAfter[0]!.runId).toBe("run-1");
    expect(itemsAfter[1]!.status).toBe("failed");
    expect(itemsAfter[1]!.error).toBe("boom");
  });

  it("lists batches newest first and scopes them by user", async () => {
    await db.createBatch({ id: "b1", userId: "u1", graphId: "g1", rows: [{ a: 1 }] });
    await db.createBatch({ id: "b2", userId: "u2", graphId: "g2", rows: [{ a: 2 }] });
    expect((await db.listBatches("u1")).map((b) => b.id)).toEqual(["b1"]);
    expect(await db.getBatch("b2", "u1")).toBeNull();
  });
});
