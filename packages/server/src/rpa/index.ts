import { launchRpaBrowser, saveSession } from "./browser.js";
import { type FetchedMetric, type MetricsAdapter } from "./adapter.js";

/**
 * RPA 只读回读注册表 + 统一入口。
 *
 * 每个平台一个 adapter（见 adapters/），在此注册后由 `/api/...` 调用
 * `collectMetrics` 回读数据并回写 content_metrics（复用 F6 的 insertMetric）。
 */

const adapters = new Map<string, MetricsAdapter>();

export function registerMetricsAdapter(adapter: MetricsAdapter): void {
  adapters.set(adapter.platform, adapter);
}

export function getMetricsAdapter(platform: string): MetricsAdapter | undefined {
  return adapters.get(platform);
}

/**
 * 用指定 adapter 回读指标。登录态在 `stateDir` 下按平台持久化；
 * 扫码登录由 adapter 的 login 负责（生产环境弹出浏览器让用户扫码）。
 */
export async function collectMetrics(opts: {
  adapter: MetricsAdapter;
  stateDir: string;
  since: number;
  signal?: AbortSignal;
}): Promise<FetchedMetric[]> {
  const { adapter, stateDir, since, signal } = opts;
  const stateFile = `${stateDir}/${adapter.platform}-state.json`;

  const session = await adapter.login(stateFile, signal);
  return adapter.fetchMetrics(session, since, signal);
}

export { launchRpaBrowser, saveSession };
export type { FetchedMetric, MetricsAdapter } from "./adapter.js";
