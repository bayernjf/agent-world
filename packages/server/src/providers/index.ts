import { failoverCandidates, loadConfig, providerForModel, type AppConfig } from "../config.js";
import { log } from "../logger.js";
import { fakeWorker, type Worker, type AgentChunk } from "../worker.js";
import { openAICompatibleWorker, ProviderError } from "./openai-compatible.js";
import { currentUserId } from "../user-context.js";
import type { GraphNode, Usage } from "@agent-world/core";

export { ProviderError } from "./openai-compatible.js";

/** Only a dead upstream or a timeout is worth switching providers for. Rate
 * limits are handled inside the worker (LONG_RETRY); auth failures surface so a
 * misconfigured key isn't silently masked by backup traffic. */
function isFailoverError(err: unknown): boolean {
  return err instanceof ProviderError && (err.code === "PROVIDER_ERROR" || err.code === "TIMEOUT");
}

/**
 * Cache key for a provider worker. The whole provider object is the key — not a
 * hand-picked field list — because `openAICompatibleWorker` closes over the
 * entire provider: pricing (`pricingFor`), `modalityOf`, `endpointFor` and
 * `videoAdapter` are all read off the captured object, and a worker is cached
 * for the process lifetime (index.ts builds one routingWorker). A key of
 * `baseUrl + apiKey` therefore meant "edit a unit price without touching the
 * connection and the running server keeps metering the old one" — a silent
 * accounting error, invisible in every report. Field lists are also how this
 * class of bug keeps recurring: whoever adds a field doesn't think to add a line
 * here. Two semantically identical providers that differ only in key insertion
 * order now build an extra worker; a stale one is never reused, which is the
 * only asymmetry worth paying for.
 */
export function providerCacheKey(name: string, provider: AppConfig["providers"][string]): string {
  return `${name}::${JSON.stringify(provider)}`;
}

/**
 * A worker that routes each node to the provider owning its model, and fails
 * over to backup providers when the primary upstream is dead. This is the
 * worker the engine talks to in production; provider workers are cached.
 */
export function routingWorker(config?: AppConfig): Worker {
  // Read config fresh on every call so saved settings (keys, default model,
  // enabled state) take effect without a server restart. An optional injected
  // config keeps tests deterministic. Without an injected config the current
  // async-context user (set by runAsUser around each run) owns the settings.
  const getConfig = async (): Promise<AppConfig> => config ?? (await loadConfig(currentUserId()));
  const cache = new Map<string, Worker>();
  const MAX_WORKER_CACHE = 64;

  const workerForProvider = (name: string, provider: AppConfig["providers"][string]): Worker => {
    // 停用的 provider 不再降级成 fake worker：那会让一条本该失败的 run 一路
    // `done`、产出假文本（2026-09-25 复盘出的「静默成功」缺陷类）。抛
    // UNSUPPORTED 是刻意的选择——它不在 nodes/shared.ts 的 RETRYABLE 集合里，
    // 所以不重试、不成串刷上游，直接以具名错误码失败。
    if (provider.enabled === false && provider.type !== "fake") {
      throw new ProviderError(
        "UNSUPPORTED",
        `Provider「${name}」已停用，模型请求未发出。请在「模型设置」中启用它，或为节点改选模型。`,
      );
    }
    // 整个 provider 对象就是缓存 key，见 providerCacheKey。
    const cacheKey = providerCacheKey(name, provider);
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    let w: Worker;
    switch (provider.type) {
      case "openai-compatible":
        w = openAICompatibleWorker(provider);
        break;
      case "anthropic":
        throw new ProviderError(
          "UNSUPPORTED",
          `Provider「${name}」的类型 anthropic 尚未实现，模型请求未发出。请改用 OpenAI 兼容源，或在 Inspector 中为该节点改选模型。`,
        );
      case "fake":
        w = fakeWorker();
        break;
      default:
        throw new ProviderError(
          "UNSUPPORTED",
          `Provider「${name}」的类型 ${String(provider.type)} 无法路由，模型请求未发出。`,
        );
    }
    cache.set(cacheKey, w);
    while (cache.size > MAX_WORKER_CACHE) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return w;
  };

  // Resolve the provider owning a model; used by the non-failover modalities.
  const workerFor = async (model: string): Promise<Worker> => {
    if (process.env.WORKER === "fake" || model === "fake") {
      return fakeWorker();
    }
    // 空模型名以前也走 fake，于是"没配模型"变成一条产出假文本的成功 run。
    // 派发前 validateModels 已经拦住的这里不会再见到，剩下的是运行中改配置的
    // 兜底：宁可失败，不可假成功。
    if (model === "") {
      throw new ProviderError("UNSUPPORTED", "节点没有可用的模型名（模型为空），请求未发出。请在 Inspector 中为该节点选择模型。");
    }
    const cfg = await getConfig();
    const { name, provider } = providerForModel(cfg, model);
    return workerForProvider(name, provider);
  };

  return {
    async *runTextGen(args): AsyncGenerator<AgentChunk, { output: string; usage: Usage }> {
      const cfg = await getConfig();
      const candidates = failoverCandidates(cfg, args.config.model);
      let lastErr: unknown;
      for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i]!;
        const inner = workerForProvider(cand.name, cand.provider).runTextGen({
          ...args,
          config: { ...args.config, model: cand.model },
        });
        // A dead upstream throws before the first byte, so probe once: a throw
        // here means nothing has been emitted and the request is still replayable.
        let first: IteratorResult<AgentChunk, { output: string; usage: Usage }>;
        try {
          first = await inner.next();
        } catch (err) {
          lastErr = err;
          const next = candidates[i + 1];
          if (next && isFailoverError(err)) {
            log.warn("failing over text model to backup provider", {
              model: args.config.model,
              to: next.model,
              provider: next.name,
            });
            continue;
          }
          throw err;
        }
        // First chunk arrived — committed to this provider; stream the rest and
        // propagate any later error (partial output can't be restarted).
        if (!first.done) yield first.value;
        let next = await inner.next();
        while (!next.done) {
          yield next.value;
          next = await inner.next();
        }
        return next.value;
      }
      throw lastErr;
    },
    async judge(args) {
      const cfg = await getConfig();
      // Gates carry no agent config of their own, so judge with the live default
      // model (not a hard-coded provider-specific name).
      const logical = args.node.textGen?.model || cfg.defaultModel;
      const candidates = failoverCandidates(cfg, logical);
      let lastErr: unknown;
      for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i]!;
        try {
          const node: GraphNode = {
            ...args.node,
            textGen: { ...args.node.textGen, model: cand.model },
          } as GraphNode;
          return await workerForProvider(cand.name, cand.provider).judge({ ...args, node });
        } catch (err) {
          lastErr = err;
          const next = candidates[i + 1];
          if (next && isFailoverError(err)) {
            log.warn("failing over judge to backup provider", {
              model: logical,
              to: next.model,
              provider: next.name,
            });
            continue;
          }
          throw err;
        }
      }
      throw lastErr;
    },
    async generateImage(args) {
      return (await workerFor(args.config.model)).generateImage(args);
    },
    // Video and audio generation route to the owning provider but do not fail
    // over (text-only v1). Both are optional on Worker: a provider without the
    // modality yields no results, which the engine treats as empty (not failed).
    async generateVideo(args) {
      const w = await workerFor(args.config.model);
      return w.generateVideo ? w.generateVideo(args) : [];
    },
    async generateAudio(args) {
      const w = await workerFor(args.config.model);
      return w.generateAudio ? w.generateAudio(args) : [];
    },
  };
}

export { fakeWorker, openAICompatibleWorker };
export type { Worker };
