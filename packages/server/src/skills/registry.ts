import * as fs from "node:fs/promises";
import path from "node:path";
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

export interface BuiltinSkill extends Skill {
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

const fsWrite: BuiltinSkill = {
  id: "fs_write",
  name: "写文件",
  description: "将文本写入工作区内允许目录下的文件。危险操作，每次调用需人工批准。",
  kind: "tool",
  source: "builtin",
  danger: true,
  permissions: { subprocess: false, env: [] },
  config: {},
  tool: {
    name: "fs_write",
    description:
      "Write text to a file under the allowed directory (TOOL_FS_ALLOW, defaults to cwd). " +
      "A dangerous tool: requires human approval before each execution.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path within the allowed root (relative or absolute under TOOL_FS_ALLOW)." },
        content: { type: "string", description: "Text content to write." },
      },
      required: ["path", "content"],
    },
    async execute(args: unknown) {
      const a = (args ?? {}) as { path?: unknown; content?: unknown };
      const p = a.path;
      const content = a.content;
      if (typeof p !== "string" || !p) throw new Error("path is required");
      if (typeof content !== "string") throw new Error("content is required");
      const root = process.env.TOOL_FS_ALLOW ?? process.cwd();
      const absRoot = path.resolve(root);
      const absTarget = path.resolve(absRoot, p);
      if (absTarget !== absRoot && !absTarget.startsWith(absRoot + path.sep)) {
        throw new Error(`path must be within allowed root: ${absRoot}`);
      }
      await fs.mkdir(path.dirname(absTarget), { recursive: true });
      await fs.writeFile(absTarget, content, "utf8");
      return `wrote ${absTarget} (${content.length} bytes)`;
    },
  },
};

const ALL: BuiltinSkill[] = [webFetch, jsonExtract, nowTime, fsWrite];
const byId = new Map(ALL.map((s) => [s.id, s]));

export function listBuiltinSkills(): Skill[] {
  return [...byId.values()].map(({ tool: _tool, ...rest }) => rest);
}

export function getSkill(id: string): BuiltinSkill | undefined {
  return byId.get(id);
}

/** Register a skill at runtime (e.g. tools discovered from an MCP server). */
export function registerSkill(skill: BuiltinSkill): void {
  byId.set(skill.id, skill);
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
  const skill = [...byId.values()].find((s) => s.tool?.name === name);
  if (!skill?.tool) throw new Error(`unknown tool: ${name}`);
  return skill.tool.execute(args);
}
