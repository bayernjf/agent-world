import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Graph } from "@agent-world/core";
import type { Db } from "./db.js";
import { dispatchGate, readEnforceMode } from "./dispatch-gate.js";

const textGraph = (model: string): Graph => ({
  id: "g",
  name: "G",
  nodes: [
    { id: "in", kind: "source", name: "IN", x: 0, y: 0 },
    {
      id: "a",
      kind: "textGen",
      name: "A",
      x: 1,
      y: 0,
      textGen: { model, prompt: "hi", skills: [], temperature: 0.7, timeoutMs: 60_000 },
    },
    { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
  ],
  edges: [
    { id: "e1", from: "in", to: "a", kind: "flow" },
    { id: "e2", from: "a", to: "out", kind: "flow" },
  ],
});

describe("readEnforceMode", () => {
  it("maps the accepted spellings, and treats an unrecognized value as off", () => {
    expect(readEnforceMode(undefined)).toBe("off");
    expect(readEnforceMode("")).toBe("off");
    expect(readEnforceMode("  ")).toBe("off");
    expect(readEnforceMode("1")).toBe("enforce");
    // The old `=== "1"` compare made these silently mean OFF, which is how a
    // deploy ends up believing the gate is on when it is not.
    expect(readEnforceMode("true")).toBe("enforce");
    expect(readEnforceMode("yes")).toBe("enforce");
    expect(readEnforceMode(" 1 ")).toBe("enforce");
    expect(readEnforceMode("observe")).toBe("observe");
    expect(readEnforceMode("log")).toBe("observe");
  });

  it("says so out loud when the value is neither on nor off", () => {
    // The logger writes straight to stdout, so that is what has to be captured.
    const written: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      });
    try {
      expect(readEnforceMode("ture")).toBe("off");
    } finally {
      spy.mockRestore();
    }
    const line = written.join("");
    expect(line).toContain("unrecognized value");
    // The bad value itself must appear, or the warning is unactionable.
    expect(line).toContain("ture");
  });
});

interface GateStub {
  db: Db;
  usageFor: ReturnType<typeof vi.fn>;
  sumArtifactBytes: ReturnType<typeof vi.fn>;
}

function stubDb(overrides: { isDemo?: number; plan?: string; status?: string } = {}): GateStub {
  const isDemo = overrides.isDemo ?? 0;
  const usageFor = vi.fn(async () => 0);
  const sumArtifactBytes = vi.fn(async () => 0);
  const db = {
    findUserById: async () => ({ id: "u1", is_demo: isDemo }),
    activeRuns: async () => 0,
    loadSubscription: async () =>
      isDemo ? undefined : { plan: overrides.plan ?? "free", status: overrides.status ?? "active" },
    saveSubscription: async () => undefined,
    usageFor,
    sumArtifactBytes,
  };
  return { db: db as unknown as Db, usageFor, sumArtifactBytes };
}

describe("dispatchGate", () => {
  it("reads neither the subscription nor the usage ledger when the mode is off", async () => {
    // 闸门现在挂在每一次派发上，所以「关着」这条最常见路径必须和搬过来之前一样便宜：
    // currentUsage 要扫 4 张用量表 + 一次存储求和。
    const { db, usageFor, sumArtifactBytes } = stubDb({ plan: "free" });
    const load = vi.spyOn(db, "loadSubscription");
    // A builtin model on free would throw if the gate ran at all.
    await expect(
      dispatchGate({ db, graph: textGraph("agnes-2.0-flash"), userId: "u1", trigger: "manual", mode: "off" }),
    ).resolves.toBeUndefined();
    expect(load).not.toHaveBeenCalled();
    expect(usageFor).not.toHaveBeenCalled();
    expect(sumArtifactBytes).not.toHaveBeenCalled();
  });

  it("throws on a free plan using builtin models when enforcing", async () => {
    const { db } = stubDb({ plan: "free" });
    await expect(
      dispatchGate({ db, graph: textGraph("agnes-2.0-flash"), userId: "u1", trigger: "rerun", mode: "enforce" }),
    ).rejects.toThrow(/内置模型/);
  });

  it("observe mode evaluates the same graph and does not throw", async () => {
    const { db } = stubDb({ plan: "free" });
    await expect(
      dispatchGate({ db, graph: textGraph("agnes-2.0-flash"), userId: "u1", trigger: "batch", mode: "observe" }),
    ).resolves.toBeUndefined();
  });

  it("lets a BYOK graph through on the free plan under enforce", async () => {
    const { db } = stubDb({ plan: "free" });
    await expect(
      dispatchGate({ db, graph: textGraph("fake"), userId: "u1", trigger: "manual", mode: "enforce" }),
    ).resolves.toBeUndefined();
  });

  it("applies demo limits regardless of the mode", async () => {
    // Hasee runs ENFORCE=1 with free tokens=0; demo draws on its own pool, so a
    // mode check in front of the demo branch would lock every demo account out.
    for (const mode of ["off", "enforce", "observe"] as const) {
      const { db } = stubDb({ isDemo: 1 });
      await expect(
        dispatchGate({ db, graph: textGraph("agnes-2.0-flash"), userId: "u1", trigger: "manual", mode }),
      ).resolves.toBeUndefined();
    }
  });
});

/**
 * The reason the gate moved into startRun is that routes minting runs directly
 * never passed it. That shape can come back the moment someone adds a third
 * dispatch path that calls `db.createRun` itself — so the shape is now asserted,
 * the same way the i18n guard asserts source-level rules.
 */
describe("no run may be minted without passing the gate", () => {
  it("every file that calls db.createRun also references dispatchGate", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
        const source = readFileSync(full, "utf8");
        if (source.includes("db.createRun(") && !source.includes("dispatchGate")) {
          offenders.push(relative(process.cwd(), full));
        }
      }
    };
    walk(process.cwd() + "/src");

    expect(
      offenders,
      `这些文件自己建 run 却没过闸门，等于新开一条绕过配额的路：${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
