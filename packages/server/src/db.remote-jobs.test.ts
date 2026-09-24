import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type NewRemoteJob } from "./db.js";

function job(
  over: Partial<NewRemoteJob> & Pick<NewRemoteJob, "id" | "remoteJobId">,
): NewRemoteJob {
  return {
    userId: "u1",
    runId: "r1",
    graphId: "g1",
    nodeId: "v1",
    attempt: 1,
    kind: "video",
    provider: "siliconflow",
    ...over,
  };
}

describe("remote_jobs CRUD (G4, design-step-trace-and-robustness §3.5)", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;
  const file = () => join(dir, "test.sqlite");

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-rj-"));
    db = openDb(file());
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Read a row straight from SQLite to assert terminal columns the
   *  getOpenRemoteJob projection intentionally hides. */
  function rawJob(id: string): Record<string, unknown> | undefined {
    const raw = new DatabaseSync(file());
    try {
      return raw
        .prepare("SELECT * FROM remote_jobs WHERE id = ?")
        .get(id) as Record<string, unknown> | undefined;
    } finally {
      raw.close();
    }
  }
  function rawCount(where = "1=1"): number {
    const raw = new DatabaseSync(file());
    try {
      return (raw.prepare(`SELECT COUNT(*) AS n FROM remote_jobs WHERE ${where}`).get() as { n: number }).n;
    } finally {
      raw.close();
    }
  }

  it("inserts a submitted job and reads it back with camelCase mapping + meta round-trip", async () => {
    await db.insertRemoteJob(job({ id: "j1", remoteJobId: "rem-1", meta: { pollMs: 2000 } }));
    const got = await db.getOpenRemoteJob("r1", "v1", 1);
    expect(got).toMatchObject({
      id: "j1",
      userId: "u1",
      runId: "r1",
      graphId: "g1",
      nodeId: "v1",
      attempt: 1,
      kind: "video",
      provider: "siliconflow",
      remoteJobId: "rem-1",
      state: "submitted",
      lastPolledAt: null,
      finishedAt: null,
      errorCode: null,
    });
    expect(got?.meta).toEqual({ pollMs: 2000 });
    expect(got?.submittedAt).toEqual(expect.any(Number));
  });

  it("returns null when no open job exists for the node attempt", async () => {
    expect(await db.getOpenRemoteJob("r1", "v1", 1)).toBeNull();
  });

  it("scopes the open lookup to (runId, nodeId, attempt)", async () => {
    await db.insertRemoteJob(job({ id: "j1", remoteJobId: "rem-1", attempt: 1 }));
    expect(await db.getOpenRemoteJob("r1", "v1", 2)).toBeNull();
    expect(await db.getOpenRemoteJob("r1", "other", 1)).toBeNull();
    expect(await db.getOpenRemoteJob("other", "v1", 1)).toBeNull();
    expect(await db.getOpenRemoteJob("r1", "v1", 1)).not.toBeNull();
  });

  it("transitions submitted -> running on touch and stamps last_polled_at", async () => {
    await db.insertRemoteJob(job({ id: "j1", remoteJobId: "rem-1" }));
    await db.touchRemoteJob("j1", "running", 5555);
    const open = await db.getOpenRemoteJob("r1", "v1", 1);
    expect(open?.state).toBe("running");
    expect(open?.lastPolledAt).toBe(5555);
  });

  it("hides a job after it succeeds and stamps finished_at", async () => {
    await db.insertRemoteJob(job({ id: "j1", remoteJobId: "rem-1" }));
    await db.finishRemoteJob("j1", "succeeded");
    expect(await db.getOpenRemoteJob("r1", "v1", 1)).toBeNull();
    const row = rawJob("j1")!;
    expect(row.state).toBe("succeeded");
    expect(row.finished_at).toEqual(expect.any(Number));
    expect(row.error_code).toBeNull();
  });

  it("records a lost job with REMOTE_JOB_LOST and stamps finished_at", async () => {
    await db.insertRemoteJob(job({ id: "j1", remoteJobId: "rem-1" }));
    await db.finishRemoteJob("j1", "lost", "REMOTE_JOB_LOST");
    expect(await db.getOpenRemoteJob("r1", "v1", 1)).toBeNull();
    const row = rawJob("j1")!;
    expect(row.state).toBe("lost");
    expect(row.error_code).toBe("REMOTE_JOB_LOST");
    expect(row.finished_at).toEqual(expect.any(Number));
  });

  it("dedupes on (provider, remote_job_id): a redelivered submit is ignored", async () => {
    await db.insertRemoteJob(job({ id: "j1", remoteJobId: "rem-1" }));
    // Same provider + remote id, different local id — the UNIQUE constraint plus
    // ON CONFLICT DO NOTHING must swallow it rather than throwing or duplicating.
    await expect(
      db.insertRemoteJob(job({ id: "j2", remoteJobId: "rem-1" })),
    ).resolves.toBeUndefined();
    expect(rawCount("remote_job_id = 'rem-1'")).toBe(1);
  });

  it("does not dedupe when provider is NULL (NULLs are distinct), newest open job wins", async () => {
    await db.insertRemoteJob(
      job({ id: "j1", remoteJobId: "rem-a", provider: null, submittedAt: 1000 }),
    );
    await db.insertRemoteJob(
      job({ id: "j2", remoteJobId: "rem-b", provider: null, submittedAt: 2000 }),
    );
    expect(rawCount()).toBe(2);
    const open = await db.getOpenRemoteJob("r1", "v1", 1);
    expect(open?.id).toBe("j2");
    expect(open?.submittedAt).toBe(2000);
  });

  it("lists open jobs oldest-first and hides terminal ones by default", async () => {
    await db.insertRemoteJob(job({ id: "j1", remoteJobId: "rem-1", submittedAt: 3000 }));
    await db.insertRemoteJob(job({ id: "j2", remoteJobId: "rem-2", submittedAt: 1000 }));
    await db.insertRemoteJob(job({ id: "j3", remoteJobId: "rem-3", submittedAt: 2000 }));
    await db.finishRemoteJob("j3", "succeeded");

    const open = await db.listRemoteJobs(10);
    expect(open.map((j) => j.id)).toEqual(["j2", "j1"]);
    expect(open.every((j) => j.state === "submitted" || j.state === "running")).toBe(true);
  });

  it("lists every job newest-first when openOnly is false, including terminal jobs", async () => {
    await db.insertRemoteJob(job({ id: "j1", remoteJobId: "rem-1", submittedAt: 3000 }));
    await db.insertRemoteJob(job({ id: "j2", remoteJobId: "rem-2", submittedAt: 1000 }));
    await db.insertRemoteJob(job({ id: "j3", remoteJobId: "rem-3", submittedAt: 2000 }));
    await db.finishRemoteJob("j3", "lost", "REMOTE_JOB_LOST");

    const all = await db.listRemoteJobs(10, { openOnly: false });
    expect(all.map((j) => j.id)).toEqual(["j1", "j3", "j2"]);
    expect(all.find((j) => j.id === "j3")?.state).toBe("lost");
    expect(all.find((j) => j.id === "j3")?.errorCode).toBe("REMOTE_JOB_LOST");
  });

  it("honors limit and clamps non-positive limits to at least one row", async () => {
    await db.insertRemoteJob(job({ id: "j1", remoteJobId: "rem-1", submittedAt: 3000 }));
    await db.insertRemoteJob(job({ id: "j2", remoteJobId: "rem-2", submittedAt: 1000 }));

    expect((await db.listRemoteJobs(1)).map((j) => j.id)).toEqual(["j2"]);
    // A bogus limit (0 / NaN) still returns the oldest open job rather than erroring.
    expect((await db.listRemoteJobs(0)).map((j) => j.id)).toEqual(["j2"]);
  });
});
