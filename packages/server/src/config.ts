import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ProviderType = "openai-compatible" | "anthropic" | "fake";

/** Prices in USD per 1M tokens. Omitted fields are treated as 0 (unknown). */
export interface ModelPricing {
  input?: number;
  output?: number;
  cacheRead?: number;
}

export interface ProviderConfig {
  type: ProviderType;
  baseUrl?: string;
  apiKey?: string;
  models: string[];
  /** Per-model pricing; a model with no entry is metered as 0 cost. */
  pricing?: Record<string, ModelPricing>;
}

export interface AppConfig {
  providers: Record<string, ProviderConfig>;
  defaultModel: string;
  defaultProvider: string;
}

const FAKE_PROVIDER: ProviderConfig = { type: "fake", models: [] };
const DEFAULT_CONFIG: AppConfig = {
  providers: {
    fake: FAKE_PROVIDER,
  },
  defaultModel: "fake",
  defaultProvider: "fake",
};

function candidatePaths(): string[] {
  const paths: string[] = [];
  if (process.env.AGENT_WORLD_CONFIG) paths.push(process.env.AGENT_WORLD_CONFIG);
  paths.push(join(homedir(), ".agent-world", "config.json"));
  // Walk up from cwd so the config is found whether running from repo root or
  // from packages/server (tsx watch sets cwd to the package dir).
  let dir = process.cwd();
  while (true) {
    paths.push(join(dir, "agent-world.config.json"));
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return paths;
}

export function configPath(): string {
  return candidatePaths().find((p) => {
    try {
      readFileSync(p, "utf8");
      return true;
    } catch {
      return false;
    }
  }) ?? join(homedir(), ".agent-world", "config.json");
}

export function loadConfig(): AppConfig {
  for (const path of candidatePaths()) {
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        providers: { ...DEFAULT_CONFIG.providers, ...parsed.providers },
      };
    } catch {
      // try next
    }
  }
  return DEFAULT_CONFIG;
}

export function saveConfig(config: AppConfig): string {
  const path = configPath();
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 });
  return path;
}

/** Look up which provider config owns a given model name. */
export function providerForModel(
  config: AppConfig,
  model: string,
): { name: string; provider: ProviderConfig } {
  for (const [name, provider] of Object.entries(config.providers)) {
    if (provider.models.includes(model) || name === model) {
      return { name, provider };
    }
  }
  const def = config.providers[config.defaultProvider];
  if (def) return { name: config.defaultProvider, provider: def };
  return { name: "fake", provider: FAKE_PROVIDER };
}
