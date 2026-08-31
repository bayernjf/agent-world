import { loadConfig, providerForModel, type AppConfig } from "../config.js";
import { log } from "../logger.js";
import { fakeWorker, type Worker, type AgentChunk } from "../worker.js";
import { openAICompatibleWorker } from "./openai-compatible.js";
import { currentUserId } from "../user-context.js";
import type { TextGenConfig, GraphNode, Usage } from "@agent-world/core";

export { ProviderError } from "./openai-compatible.js";

/**
 * A worker that routes each node to the provider owning its model. This is the
 * worker the engine talks to in production; individual provider workers are
 * cached so we don't re-read config on every node.
 */
export function routingWorker(config?: AppConfig): Worker {
  // Read config fresh on every call so saved settings (keys, default model,
  // enabled state) take effect without a server restart. An optional injected
  // config keeps tests deterministic. Without an injected config the current
  // async-context user (set by runAsUser around each run) owns the settings.
  const getConfig = (): AppConfig => config ?? loadConfig(currentUserId());
  // Cache key incorporates connection details so editing a key/URL rebuilds
  // the provider worker instead of reusing a stale one.
  const cache = new Map<string, Worker>();

  const workerFor = (model: string): Worker => {
    if (process.env.WORKER === "fake" || model === "fake" || model === "") {
      return fakeWorker();
    }
    const cfg = getConfig();
    const { name: provName, provider } = providerForModel(cfg, model);
    if (provider.enabled === false && provider.type !== "fake") {
      log.warn("provider disabled; falling back to fake worker", { provider: provName });
      return fakeWorker();
    }
    const cacheKey = `${provName}::${model}::${provider.baseUrl ?? ""}::${provider.apiKey ?? ""}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    let w: Worker;
    switch (provider.type) {
      case "openai-compatible":
        w = openAICompatibleWorker(provider);
        break;
      case "anthropic":
        log.warn("anthropic provider not yet implemented; using fake worker", { model });
        w = fakeWorker();
        break;
      case "fake":
      default:
        w = fakeWorker();
    }
    cache.set(cacheKey, w);
    return w;
  };

  return {
    async *runTextGen(args): AsyncGenerator<AgentChunk, { output: string; usage: Usage }> {
      return yield* workerFor(args.config.model).runTextGen(args);
    },
    async judge(args) {
      // Gates carry no agent config of their own, so judge with the live
      // default model (not a hard-coded provider-specific name).
      const model = args.node.textGen?.model || getConfig().defaultModel;
      return workerFor(model).judge(args);
    },
    async generateImage(args) {
      return workerFor(args.config.model).generateImage(args);
    },
  };
}

export { fakeWorker, openAICompatibleWorker };
export type { Worker };
