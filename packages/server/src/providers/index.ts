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
  // Cache key incorporates connection details so editing a key/URL rebuilds
  // the provider worker instead of reusing a stale one.
  const cache = new Map<string, Worker>();
  const MAX_WORKER_CACHE = 64;

  const workerForProvider = (name: string, provider: AppConfig["providers"][string]): Worker => {
    if (provider.enabled === false && provider.type !== "fake") {
      log.warn("provider disabled; falling back to fake worker", { provider: name });
      return fakeWorker();
    }
    const cacheKey = `${name}::${provider.baseUrl ?? ""}::${provider.apiKey ?? ""}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    let w: Worker;
    switch (provider.type) {
      case "openai-compatible":
        w = openAICompatibleWorker(provider);
        break;
      case "anthropic":
        log.warn("anthropic provider not yet implemented; using fake worker", { provider: name });
        w = fakeWorker();
        break;
      case "fake":
      default:
        w = fakeWorker();
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
    if (process.env.WORKER === "fake" || model === "fake" || model === "") {
      return fakeWorker();
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
