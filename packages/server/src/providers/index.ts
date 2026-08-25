import { loadConfig, providerForModel, type AppConfig } from "../config.js";
import { fakeWorker, type Worker, type AgentChunk } from "../worker.js";
import { openAICompatibleWorker } from "./openai-compatible.js";
import type { AgentConfig, GraphNode, Usage } from "@agent-world/core";

export { ProviderError } from "./openai-compatible.js";

/**
 * A worker that routes each node to the provider owning its model. This is the
 * worker the engine talks to in production; individual provider workers are
 * cached so we don't re-read config on every node.
 */
export function routingWorker(config?: AppConfig): Worker {
  const cfg = config ?? loadConfig();
  const cache = new Map<string, Worker>();

  const workerFor = (model: string): Worker => {
    if (process.env.WORKER === "fake" || model === "fake" || model === "") {
      return fakeWorker();
    }
    const cached = cache.get(model);
    if (cached) return cached;
    const { provider } = providerForModel(cfg, model);
    let w: Worker;
    switch (provider.type) {
      case "openai-compatible":
        w = openAICompatibleWorker(provider);
        break;
      case "anthropic":
        console.warn(`[worker] anthropic provider not yet implemented; using fake for ${model}`);
        w = fakeWorker();
        break;
      case "fake":
      default:
        w = fakeWorker();
    }
    cache.set(model, w);
    return w;
  };

  return {
    async *runAgent(args): AsyncGenerator<AgentChunk, { output: string; usage: Usage }> {
      return yield* workerFor(args.config.model).runAgent(args);
    },
    async judge(args) {
      // Gates carry no agent config of their own, so judge with the default
      // model (not a hard-coded provider-specific name).
      const model = args.node.agent?.model ?? cfg.defaultModel;
      return workerFor(model).judge(args);
    },
  };
}

export { fakeWorker, openAICompatibleWorker };
export type { Worker };
