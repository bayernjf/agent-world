import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeWorker } from "./worker.js";
import { WorkerRegistry, loadWorkerPlugins } from "./worker-plugins.js";

const PLUGIN_SOURCE = `
export const plugin = {
  id: "test-worker",
  name: "Test Worker",
  models: ["m1", "m2"],
  createWorker: () => ({
    async *runTextGen() {
      yield { type: "text-delta", text: "x" };
      return { output: "out", usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
    },
    async judge() { return { passed: true, reason: "ok" }; },
    async generateImage() { return []; },
  }),
};
`;

describe("loadWorkerPlugins", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-wp-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns [] when the directory is missing", async () => {
    expect(await loadWorkerPlugins(join(dir, "nope"))).toEqual([]);
  });

  it("discovers and loads *.worker.ts modules", async () => {
    writeFileSync(join(dir, "test.worker.ts"), PLUGIN_SOURCE);
    const plugins = await loadWorkerPlugins(dir);
    expect(plugins.map((p) => p.id)).toEqual(["test-worker"]);
    expect(plugins[0]!.models).toEqual(["m1", "m2"]);
    expect(typeof plugins[0]!.createWorker().runTextGen).toBe("function");
  });

  it("ignores non-plugin files", async () => {
    writeFileSync(join(dir, "notes.txt"), "not a plugin");
    writeFileSync(join(dir, "broken.worker.ts"), "export const plugin = 42;");
    const plugins = await loadWorkerPlugins(dir);
    expect(plugins).toEqual([]);
  });
});

describe("WorkerRegistry", () => {
  it("exposes the built-in worker and falls back to it for unknown ids", async () => {
    const reg = new WorkerRegistry(fakeWorker());
    expect(reg.list().map((w) => w.id)).toEqual(["agnes"]);
    expect(reg.get()).toBe(reg.get("agnes"));
    expect(reg.get("does-not-exist")).toBe(reg.get("agnes"));
  });

  it("registers discovered plugins and selects them by id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-wp2-"));
    writeFileSync(join(dir, "test.worker.ts"), PLUGIN_SOURCE);
    const reg = new WorkerRegistry(fakeWorker());
    const loaded = await reg.loadFrom(dir);
    expect(loaded.map((p) => p.id)).toEqual(["test-worker"]);
    expect(reg.list().map((w) => w.id).sort()).toEqual(["agnes", "test-worker"]);
    const w = reg.get("test-worker");
    expect(typeof w.runTextGen).toBe("function");
    rmSync(dir, { recursive: true, force: true });
  });
});
