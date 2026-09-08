/**
 * Feature flag registry + resolution.
 *
 * Add a flag to `FEATURE_FLAGS`, then gate code with
 * `isFeatureEnabled("flag", userId)`. Resolution: per-user settings
 * (`AppConfig.featureFlags`) override the registry default; an unknown flag
 * fails closed (false) so a typo never silently enables a gated feature.
 *
 * Purpose (engineering-blueprint §3): gradual rollout and emergency kill
 * switches without shipping new code.
 */

import { loadConfig } from "./config.js";

export interface FlagDef {
  name: string;
  description: string;
  /** Default when the user has no explicit override. */
  default: boolean;
}

export const FEATURE_FLAGS: FlagDef[] = [
  {
    name: "rpa-metrics",
    description: "RPA 回读后台采集效果数据（合规/封号风险，默认关闭）",
    default: false,
  },
];

export async function isFeatureEnabled(flagName: string, userId?: string): Promise<boolean> {
  const def = FEATURE_FLAGS.find((f) => f.name === flagName);
  if (!def) return false;
  const cfg = await loadConfig(userId);
  const override = cfg.featureFlags?.[flagName];
  return override ?? def.default;
}
