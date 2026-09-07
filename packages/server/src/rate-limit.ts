/**
 * 全局限流（engineering-blueprint 域 2 / production-ops §6.2）：堵登录爆破、
 * 注册滥用、API 滥用三个入口。单机（SQLite 单体）部署，用进程内滑动窗口即可；
 * 重启会清空配额——这里目标是「打断短时间暴力」，不是长期计量（长期计量已由
 * feedback 的 DB-backed 限流覆盖）。
 *
 * 滑动窗口：每个 key 维护一个时间戳队列，`allow` 时先剪掉窗口外的时间戳，
 * 再判断是否超限。空窗口的 key 会被删除，避免 Map 无限增长。
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** 记录一次尝试；窗口已满时返回 false（应拒绝并回 429）。 */
  allow(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const prev = this.hits.get(key) ?? [];
    const fresh = prev.filter((t) => t > cutoff);
    if (fresh.length >= this.limit) {
      if (fresh.length > 0) this.hits.set(key, fresh);
      else this.hits.delete(key);
      return false;
    }
    fresh.push(now);
    this.hits.set(key, fresh);
    return true;
  }

  /** 当前窗口内剩余可用次数（供测试/诊断）。 */
  remaining(key: string): number {
    const cutoff = Date.now() - this.windowMs;
    const fresh = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    return Math.max(0, this.limit - fresh.length);
  }
}
