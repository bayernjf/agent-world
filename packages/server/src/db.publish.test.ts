import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db.js";

describe("publish targets db (F7-B)", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-publish-"));
    db = openDb(join(dir, "test.sqlite"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates, lists and deletes publish targets", () => {
    const t = db.createPublishTarget({
      id: "t1",
      userId: "u1",
      platform: "wechat",
      name: "草稿箱",
      provider: "webhook",
      configEncrypted: "enc:v1:abc",
      createdAt: 1700000000000,
    });
    expect(t.platform).toBe("wechat");

    let rows = db.listPublishTargets("u1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.provider).toBe("webhook");

    expect(db.deletePublishTarget("t1", "u1")).toBe(true);
    rows = db.listPublishTargets("u1");
    expect(rows).toHaveLength(0);
  });

  it("records and lists published contents", () => {
    db.insertPublishedContent({
      id: "p1",
      userId: "u1",
      graphId: "g1",
      platform: "wechat",
      status: "published",
      externalId: "ext-1",
      publishedAt: 1700000000000,
    });
    const rows = db.listPublishedContents("u1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("published");
    expect(rows[0]!.externalId).toBe("ext-1");
  });

  it("scopes targets and contents by user", () => {
    db.createPublishTarget({ id: "t1", userId: "u1", platform: "x", provider: "webhook", configEncrypted: "e", createdAt: 1 });
    db.createPublishTarget({ id: "t2", userId: "u2", platform: "x", provider: "webhook", configEncrypted: "e", createdAt: 2 });
    db.insertPublishedContent({ id: "p1", userId: "u1", status: "published" });
    expect(db.listPublishTargets("u1")).toHaveLength(1);
    expect(db.listPublishedContents("u2")).toHaveLength(0);
    expect(db.deletePublishTarget("t2", "u1")).toBe(false); // wrong user
  });
});
