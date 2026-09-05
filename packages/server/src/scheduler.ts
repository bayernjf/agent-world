import { TriggerConfig } from "@agent-world/core";
import { nextRunAfter } from "./cron.js";
import { log } from "./logger.js";
import type { TriggerService } from "./triggers.js";

/**
 * Schedules cron triggers: on start it scans all persisted cron triggers and
 * arms a timer for each next fire time. After firing it recomputes the next
 * run from "now", so a server restart simply re-derives the schedule from the
 * persisted `cron` expression (`restore()` already reloads triggers). Disabled
 * triggers (`enabled === false`) are skipped.
 */
export class TriggerScheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private nextRun = new Map<string, number>();

  constructor(
    private service: TriggerService,
    private onError?: (err: unknown) => void,
  ) {}

  /** Arm timers for all persisted cron triggers. Call once after restore(). */
  start(): void {
    for (const t of this.service.list()) {
      if (t.type === "cron" && t.enabled !== false) this.schedule(t);
    }
  }

  /** Re-arm a single trigger (after create/update). */
  sync(trigger: TriggerConfig): void {
    this.clear(trigger.id);
    if (trigger.type === "cron" && trigger.enabled !== false) this.schedule(trigger);
  }

  /** Stop tracking a trigger (after delete). */
  unsync(triggerId: string): void {
    this.clear(triggerId);
  }

  /** Next scheduled fire time (epoch ms), for the UI / diagnostics. */
  nextRunAt(triggerId: string): number | undefined {
    return this.nextRun.get(triggerId);
  }

  /** Cancel all timers (used in tests / shutdown). */
  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.nextRun.clear();
  }

  private schedule(t: TriggerConfig): void {
    if (t.type !== "cron" || !t.cron) return;
    const next = nextRunAfter(t.cron, new Date());
    if (!next) {
      this.onError?.(new Error(`cron: invalid or never-matching expression "${t.cron}"`));
      return;
    }
    this.nextRun.set(t.id, next.getTime());
    const delay = Math.max(0, next.getTime() - Date.now());
    const timer = setTimeout(() => void this.fireAndReschedule(t.id), delay);
    this.timers.set(t.id, timer);
  }

  private async fireAndReschedule(id: string): Promise<void> {
    this.timers.delete(id);
    const trigger = this.service.get(id);
    log.info("cron tick fired", { triggerId: id, cron: trigger?.cron, enabled: trigger?.enabled });
    try {
      await this.service.fire(id);
    } catch (err) {
      this.onError?.(err);
    }
    const after = this.service.get(id);
    if (after && after.type === "cron" && after.enabled !== false) {
      this.schedule(after);
    } else {
      this.nextRun.delete(id);
    }
  }

  private clear(id: string): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.nextRun.delete(id);
  }
}
