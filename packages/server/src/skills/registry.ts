import type { Skill } from "@agent-world/core";
import type { ToolDefinition } from "../worker.js";

/**
 * Built-in skill catalog. Skills are capability cards mounted on agent nodes.
 * Tool-kind skills contribute a callable tool to the model; prompt-module and
 * output-contract skills will be wired in later iterations.
 *
 * Permissions are declared honestly and shown to the user at mount time.
 * Phase 2 displays and records them; hard enforcement (fs/network isolation)
 * lands with process/container sandboxing in Phase 4/5.
 */

interface BuiltinSkill extends Skill {
  tool?: ToolDefinition & {
    execute: (args: unknown) => Promise<unknown>;
  };
}

const webFetch: BuiltinSkill = {
  id: "web_fetch",
  name: "网页抓取",
  description: "抓取一个 URL 的文本内容（去掉 HTML 标签），用于读取在线资料。",
  kind: "tool",
  source: "builtin",
  permissions: {
    network: { domains: ["*"] },
    subprocess: false,
    env: [],
  },
  config: {},
  tool: {
    name: "web_fetch",
    description: "Fetch the text content of a URL. Returns plain text (HTML stripped).",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The full URL to fetch (https only)." },
      },
      required: ["url"],
    },
    async execute(args: unknown) {
      const { url } = (args ?? {}) as { url?: string };
      if (!url || typeof url !== "string") throw new Error("url is required");
      if (!url.startsWith("https://")) throw new Error("only https URLs are allowed");
      const res = await fetch(url, {
        headers: { "User-Agent": "AgentWorld/1.0" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 8000);
    },
  },
};

const jsonExtract: BuiltinSkill = {
  id: "json_extract",
  name: "JSON 提取",
  description: "解析 JSON 字符串并按点路径取值（如 data.items[0].name）。",
  kind: "tool",
  source: "builtin",
  permissions: { subprocess: false, env: [] },
  config: {},
  tool: {
    name: "json_extract",
    description:
      "Parse a JSON string and extract a value at a dot/bracket path. " +
      'Example: path "data.items[0].name" on {"data":{"items":[{"name":"x"}]}} returns "x".',
    parameters: {
      type: "object",
      properties: {
        json: { type: "string", description: "The JSON string to parse." },
        path: {
          type: "string",
          description:
            'Dot/bracket path, e.g. "data.items[0].name". Empty returns the whole object.',
        },
      },
      required: ["json"],
    },
    async execute(args: unknown) {
      const { json, path } = (args ?? {}) as { json?: string; path?: string };
      if (!json || typeof json !== "string") throw new Error("json string is required");
      let value: unknown = JSON.parse(json);
      if (!path) return value;
      const keys = path.split(/[.[\]]/).filter(Boolean);
      for (const key of keys) {
        if (value == null) return null;
        value = (value as Record<string, unknown>)[key];
      }
      return value ?? null;
    },
  },
};

const nowTime: BuiltinSkill = {
  id: "current_time",
  name: "当前时间",
  description: "返回当前 ISO 时间戳，用于需要时效性的任务。",
  kind: "tool",
  source: "builtin",
  permissions: { subprocess: false, env: [] },
  config: {},
  tool: {
    name: "current_time",
    description: "Return the current date and time as an ISO 8601 string.",
    parameters: { type: "object", properties: {} },
    async execute() {
      return new Date().toISOString();
    },
  },
};

const ALL: BuiltinSkill[] = [webFetch, jsonExtract, nowTime];
const byId = new Map(ALL.map((s) => [s.id, s]));

export function listBuiltinSkills(): Skill[] {
  return ALL.map(({ tool: _tool, ...rest }) => rest);
}

export function getSkill(id: string): BuiltinSkill | undefined {
  return byId.get(id);
}

/** Resolve mounted skill ids to tool definitions the model can call. */
export function resolveTools(
  mounted: { id: string; enabled: boolean }[],
): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (const m of mounted) {
    if (!m.enabled) continue;
    const skill = byId.get(m.id);
    if (skill?.tool) {
      const { execute: _exec, ...def } = skill.tool;
      tools.push(def);
    }
  }
  return tools;
}

/** Execute a built-in tool by name. Throws if the tool is not mounted/known. */
export async function executeBuiltinTool(name: string, args: unknown): Promise<unknown> {
  const skill = ALL.find((s) => s.tool?.name === name);
  if (!skill?.tool) throw new Error(`unknown tool: ${name}`);
  return skill.tool.execute(args);
}
