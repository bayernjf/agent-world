import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { launchRpaBrowser, saveSession } from "./browser.js";
import { registerMetricsAdapter, getMetricsAdapter } from "./index.js";
import { type MetricsAdapter } from "./adapter.js";
import { xiaohongshuAdapter } from "./adapters/xiaohongshu.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aw-rpa-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("RPA browser lifecycle (F7-C)", () => {
  it("launches chromium and evaluates page content", async () => {
    const rpa = await launchRpaBrowser({ headless: true });
    try {
      const page = await rpa.context.newPage();
      await page.setContent("<h1>效果数据回读</h1>");
      expect(await page.textContent("h1")).toBe("效果数据回读");
    } finally {
      await rpa.close();
    }
  });

  it("persists and restores a storageState session", async () => {
    const stateFile = join(dir, "session.json");
    const first = await launchRpaBrowser({ headless: true });
    await first.context.addCookies([
      { name: "web_session", value: "abc123", domain: "example.com", path: "/" },
    ]);
    await saveSession(first.context, stateFile);
    await first.close();
    expect(existsSync(stateFile)).toBe(true);

    const second = await launchRpaBrowser({ headless: true, stateFile });
    try {
      const cookies = await second.context.cookies();
      expect(cookies.some((c) => c.name === "web_session")).toBe(true);
    } finally {
      await second.close();
    }
  });
});

describe("RPA adapter registry (F7-C)", () => {
  it("registers and resolves adapters by platform", () => {
    const fake: MetricsAdapter = {
      platform: "test",
      login: async () => ({}),
      fetchMetrics: async () => [],
    };
    registerMetricsAdapter(fake);
    expect(getMetricsAdapter("test")).toBe(fake);
    expect(getMetricsAdapter("nope")).toBeUndefined();
  });

  it("fails honestly until real selectors are reversed", async () => {
    await expect(xiaohongshuAdapter.login("x", undefined)).rejects.toThrow(/尚未启用/);
  });
});
