import { log } from "./logger.js";
import type { Db } from "./db.js";

const DAY_MS = 86_400_000;

/**
 * events 保留窗口。安全前提：`runs.snapshot` 保每条 run 的完整状态
 * （design-scaling §2.1），被清掉的事件历史可从快照重建。
 */
export const EVENT_RETENTION_DAYS = 90;

/** audit_log 保留窗口（design-audit-log §5）。 */
export const AUDIT_RETENTION_DAYS = 180;

/**
 * 6h：远小于最短保留窗口，所以漏跑一轮不会显著延长数据存活；
 * 又足够长，让每天几百次重启的 dev 环境不会每次启动都扫全表。
 */
export const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface RetentionReport {
  events: number;
  audit: number;
}

/**
 * 一轮保留清理。两张表都是只追加，超过窗口即无消费者（run 详情走
 * `runs.snapshot`，审计走窗口内的合规查询），故成对处理。
 * 不 catch：调用方决定失败如何上报。
 */
export async function pruneRetention(db: Db, now = Date.now()): Promise<RetentionReport> {
  return {
    events: await db.pruneOldEvents(now - EVENT_RETENTION_DAYS * DAY_MS),
    audit: await db.pruneAuditOlder(now - AUDIT_RETENTION_DAYS * DAY_MS),
  };
}

/**
 * events + audit_log 的统一维护循环（design-audit-log §5 结论：合并成一个
 * 循环，而不是各挂各的 setInterval）。启动即清一次，之后按间隔续清——
 * 只为启动时清理会让长期不重启的进程不再回收任何东西。
 *
 * 单轮失败只 warn：表继续长是可恢复的运维问题，让 run 服务因此中断不是。
 */
export class MaintenanceLoop {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly db: Db,
    private readonly intervalMs = MAINTENANCE_INTERVAL_MS,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    // 不该成为进程不退出的原因：优雅关闭走 stop()，unref 是兜底。
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    try {
      const { events, audit } = await pruneRetention(this.db);
      if (events > 0 || audit > 0) {
        log.info("retention pruned", {
          events,
          audit,
          eventRetentionDays: EVENT_RETENTION_DAYS,
          auditRetentionDays: AUDIT_RETENTION_DAYS,
        });
      }
    } catch (err) {
      log.warn("retention prune failed", { error: (err as Error)?.message ?? String(err) });
    }
  }
}
