import { type MetricsAdapter } from "../adapter.js";

/**
 * 小红书创作者后台 RPA 只读回读适配器（骨架）。
 *
 * ⚠️ 选择器待真实环境逆向：需要真实账号扫码登录 + 逆向创作者后台 DOM。
 * 当前无真实平台环境，无法填写可用选择器，故 login/fetchMetrics 均以
 * 「尚未启用」的诚实错误兜底——框架/登录态/限速/风险契约已就绪，拿到
 * 真实环境后只需补全本文件两处（登录流程 + 数据抓取）即可启用。
 *
 * 硬约束（合规）：只读后台数据，绝不自动化发布；headful + 限速 + 常驻风险提示。
 */
export const xiaohongshuAdapter: MetricsAdapter = {
  platform: "xiaohongshu",

  async login(_stateFile, _signal) {
    // 待真实环境逆向：启动 headful 浏览器 → 打开创作者后台登录页 →
    // 等用户扫码 → saveSession 持久化 storageState。
    throw new Error("小红书 RPA 回读尚未启用（登录选择器待真实环境逆向）");
  },

  async fetchMetrics(_session, _since, _signal) {
    // 待真实环境逆向：打开数据后台 → 按 since 过滤 → 抓取每条笔记的
    // 曝光/点击/收藏/GMV → 映射为 FetchedMetric[]。
    throw new Error("小红书 RPA 回读尚未启用（数据抓取选择器待真实环境逆向）");
  },
};
