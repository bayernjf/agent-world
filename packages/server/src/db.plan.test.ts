import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db.js";

describe("content calendar db (F8)", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-plan-"));
    db = openDb(join(dir, "test.sqlite"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates, lists, updates and deletes a plan", () => {
    const plan = db.createPlan({
      id: "p1",
      userId: "u1",
      title: "新品上架种草笔记",
      platform: "xiaohongshu",
      scheduledAt: 1700000000000,
    });
    expect(plan.status).toBe("draft");
    expect(plan.title).toBe("新品上架种草笔记");
    expect(plan.platform).toBe("xiaohongshu");

    const updated = db.updatePlan("p1", "u1", { status: "scheduled", title: "改后的标题" });
    expect(updated?.status).toBe("scheduled");
    expect(updated?.title).toBe("改后的标题");

    const fetched = db.getPlan("p1", "u1");
    expect(fetched?.status).toBe("scheduled");

    db.deletePlan("p1", "u1");
    expect(db.getPlan("p1", "u1")).toBeNull();
  });

  it("filters plans by time range and scopes them by user", () => {
    db.createPlan({ id: "p1", userId: "u1", title: "A", scheduledAt: 1000 });
    db.createPlan({ id: "p2", userId: "u1", title: "B", scheduledAt: 2000 });
    db.createPlan({ id: "p3", userId: "u2", title: "C", scheduledAt: 1500 });

    const inRange = db.listPlans("u1", 1000, 1500);
    expect(inRange.map((p) => p.id)).toEqual(["p1"]);

    const all = db.listPlans("u1");
    expect(all.map((p) => p.id)).toEqual(["p1", "p2"]);

    expect(db.getPlan("p3", "u1")).toBeNull();
  });
});
