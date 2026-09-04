/**
 * F6/F7-C: RPA 只读数据回读适配器。
 *
 * 边界（合规，见 design-ecommerce-roadmap §F6 合规采集策略）：
 *   - 只「读」不「写」——回读创作者后台的曝光/点击/转化/GMV，绝不自动化发布。
 *   - 每个平台一个独立 adapter，DOM 选择器集中一处，平台改版只改适配器。
 *   - 登录态用 Playwright `storageState` 复用（扫码一次，过期再扫）。
 *
 * 真实平台选择器需要真实账号扫码 + 逆向后台 DOM，属「待真实环境填写」的
 * 配置化占位——框架/接口/登录态/限速/风险契约在此定义，选择器由各 adapter
 * 落地时补齐，不阻塞本模块的确定性部分。
 */

/** 一条从平台后台回读到的效果指标（按 external_content_id 关联）。 */
export interface FetchedMetric {
  external_content_id: string;
  impressions: number;
  clicks: number;
  conversions: number;
  gmv: number;
}

/** RPA 回读适配器接口。 */
export interface MetricsAdapter {
  /** 平台标识，如 "xiaohongshu" / "douyin"。 */
  readonly platform: string;

  /**
   * 登录并返回可复用的会话（扫码登录后持久化 storageState）。
   * 返回的 session 结构由 adapter 自定，原样传给 fetchMetrics。
   */
  login(stateFile: string, signal?: AbortSignal): Promise<unknown>;

  /**
   * 从创作者后台回读指标。选择器/页面结构由各 adapter 逆向真实平台后填写。
   * `since` 为起始时间戳（ms），只回读该时间之后的数据。
   */
  fetchMetrics(session: unknown, since: number, signal?: AbortSignal): Promise<FetchedMetric[]>;
}

/**
 * 风控/合规硬约束（所有 adapter 共用）：
 * - 限速：两次操作最小间隔，避免高频触发风控。
 * - 有头模式：生产回读建议 headful（非 headless），降低自动化特征。
 */
export const RPA_MIN_INTERVAL_MS = 3_000;
export const RPA_HEADLESS_DEFAULT = false;
