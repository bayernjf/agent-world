/**
 * MCP Prompts — message templates that guide an AI client through common
 * agent-world workflows. Arguments are optional; when a graphId is supplied it
 * is interpolated into the prompt so the client can act immediately.
 */

export interface McpPrompt {
  name: string;
  description: string;
  arguments?: Array<{ name: string; description: string; required?: boolean }>;
}

export interface McpPromptMessage {
  role: "user";
  content: { type: "text"; text: string };
}

export const PROMPTS: McpPrompt[] = [
  {
    name: "run_pipeline",
    description: "引导运行一条产线并总结结果：先 list_graphs 选产线，再 run_graph + get_run_status 轮询",
    arguments: [
      { name: "graphId", description: "产线 id（可选；不填则先列出产线让用户选）" },
      { name: "input", description: "传给产线 Source 节点的初始输入（可选）" },
    ],
  },
  {
    name: "analyze_pipeline",
    description: "引导分析一条产线的结构与潜在优化点",
    arguments: [{ name: "graphId", description: "产线 id（可选）" }],
  },
  {
    name: "create_from_template",
    description: "引导从模板/空白创建一条新产线（当前无模板市场，推荐用代码执行节点 + HTTP 节点从零搭）",
  },
];

export function getPrompt(name: string, args: Record<string, unknown> = {}): McpPromptMessage[] {
  switch (name) {
    case "run_pipeline": {
      const graphId = typeof args.graphId === "string" ? args.graphId : "";
      const input = typeof args.input === "string" ? args.input : "";
      const lines = [
        "请帮我运行 agent-world 中的一条产线并总结结果。",
        "",
        graphId
          ? `目标产线：${graphId}`
          : "步骤：先用 tools/list_graphs 查看可用产线，确定要运行哪条，然后告诉用户并等待确认。",
        input ? `初始输入：${input}` : "",
        "",
        "运行步骤：",
        "1. 调用 tools/run_graph 启动产线，拿到 runId",
        "2. 用 tools/get_run_status 轮询直到 status 为 done / failed",
        "3. 完成后用 tools/list_artifacts + tools/get_artifact（或 resources/read artifact://{id}）取产物",
        "4. 向用户总结运行结果与关键产出",
      ].filter((l) => l !== "");
      return [{ role: "user", content: { type: "text", text: lines.join("\n") } }];
    }

    case "analyze_pipeline": {
      const graphId = typeof args.graphId === "string" ? args.graphId : "";
      const lines = [
        "请帮我分析 agent-world 中的一条产线，并给出优化建议。",
        "",
        graphId ? `目标产线：${graphId}` : "步骤：先用 tools/list_graphs 查看可用产线，确定要分析哪条。",
        "",
        "分析维度：",
        "- 用 tools/get_graph 获取完整配置，梳理节点拓扑与数据流向",
        "- 检查是否有不必要的串行等待（可用 parallel 聚合提速）",
        "- 检查 prompt/参数是否有可优化空间",
        "- 给出 2-3 条最值得做的优化建议，按收益排序",
      ].filter((l) => l !== "");
      return [{ role: "user", content: { type: "text", text: lines.join("\n") } }];
    }

    case "create_from_template":
      return [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "请帮我在 agent-world 中创建一条新产线。",
              "",
              "当前没有模板市场，请按以下思路从零搭建：",
              "- 用 HTTP 请求节点对接外部 API 拉取/推送数据",
              "- 用代码执行节点做数据处理与格式转换",
              "- 用条件分支 / 映射 / 循环 / 并行聚合做流程编排",
              "- 内容生成类需求用 agent / imageGen / videoGen / audioGen 节点",
              "",
              "先向用户确认产线的目标与输入输出，再给出节点拓扑建议。",
            ].join("\n"),
          },
        },
      ];

    default:
      throw new Error(`未知提示词 "${name}"。可用: ${PROMPTS.map((p) => p.name).join(", ")}`);
  }
}
