import type { AgentWorldClient } from "./client.js";

/**
 * MCP Resources — read-only views over the agent-world data model.
 *
 * URI schemes (also declared as URI templates so clients can discover them):
 *   - `graph://{id}`     full pipeline config (JSON)
 *   - `run://{id}`       run state + artifact summary (JSON)
 *   - `artifact://{id}`  artifact content (text inline, binary → download URL)
 */

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface McpResourceTemplate {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}

export const RESOURCE_TEMPLATES: McpResourceTemplate[] = [
  {
    uriTemplate: "graph://{id}",
    name: "graph",
    description: "产线完整配置（节点、连接、参数），{id} 为产线 id",
    mimeType: "application/json",
  },
  {
    uriTemplate: "run://{id}",
    name: "run",
    description: "运行状态与产出摘要，{id} 为 runId",
    mimeType: "application/json",
  },
  {
    uriTemplate: "artifact://{id}",
    name: "artifact",
    description: "产物内容（文本直接返回，图片/音视频返回下载地址），{id} 为产物 id",
    mimeType: "application/octet-stream",
  },
];

/** Concrete resources list: every graph the token's user can see. */
export async function listResources(client: AgentWorldClient): Promise<McpResource[]> {
  const graphs = await client.listGraphs();
  return graphs.map((g) => {
    const id = String(g.id);
    const name = String(g.name ?? id);
    return {
      uri: `graph://${id}`,
      name: `graph://${id}`,
      description: `产线「${name}」的完整配置`,
      mimeType: "application/json",
    };
  });
}

/** Parse a resource URI into its scheme + id. */
function parseUri(uri: string): { scheme: "graph" | "run" | "artifact"; id: string } | null {
  const m = /^(graph|run|artifact):\/\/([^/]+)$/.exec(uri);
  if (!m) return null;
  const scheme = m[1] as "graph" | "run" | "artifact";
  if (!m[2]) return null;
  return { scheme, id: decodeURIComponent(m[2]) };
}

export interface McpReadResult {
  contents: Array<{
    uri: string;
    mimeType: string;
    text?: string;
  }>;
}

/** Read one resource. Throws an Error with a clear message for bad URIs. */
export async function readResource(uri: string, client: AgentWorldClient): Promise<McpReadResult> {
  const parsed = parseUri(uri);
  if (!parsed) {
    throw new Error(`不支持的资源 URI "${uri}"。支持: ${RESOURCE_TEMPLATES.map((t) => t.uriTemplate).join(", ")}`);
  }

  switch (parsed.scheme) {
    case "graph": {
      const graph = await client.getGraph(parsed.id);
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(graph, null, 2),
          },
        ],
      };
    }
    case "run": {
      const state = await client.runState(parsed.id);
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(state, null, 2),
          },
        ],
      };
    }
    case "artifact": {
      const art = await client.getArtifact(parsed.id);
      if (art.content !== undefined) {
        return {
          contents: [
            {
              uri,
              mimeType: art.mimeType,
              text: art.content,
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                note: "二进制产物（图片/音视频），内容不内联，请通过 downloadUrl 获取",
                downloadUrl: art.downloadUrl,
                mimeType: art.mimeType,
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }
}
