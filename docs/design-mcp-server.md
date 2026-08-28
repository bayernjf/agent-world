# MCP Server 设计方案

> 让 agent-world 作为 MCP Server，把产线能力暴露给其他 AI 客户端（Claude Desktop、Cursor、豆包、ChatGPT 等）。
> 状态：方案待评审 | 优先级：P1 | 预估：P0 MVP 1-2天

---

## 1. 目标与背景

### 1.1 目标

用户可以在任意支持 MCP 的 AI 客户端中，通过自然语言直接调用 agent-world 的产线能力。例如：

- "帮我跑一下小红书种草笔记产线，输入是这个挂脖风扇"
- "列出所有产线，分析哪个跑得最快"
- "把刚才产线的产出下载下来"

### 1.2 与现有 MCP Client 的关系

| 功能 | 方向 | 状态 |
|------|------|------|
| MCP Client | agent-world 接入外部 MCP Server，调用外部工具 | ✅ 已实现 |
| MCP Server | 外部客户端接入 agent-world，调用产线能力 | 📋 本方案 |

两者完全独立，互不影响。MCP Server 复用现有 REST API，不需要改主服务核心逻辑。

---

## 2. 传输方式

| 传输 | 场景 | 优先级 |
|------|------|--------|
| **stdio** | 本地客户端（Claude Desktop、Cursor 等），最常用 | P0 |
| HTTP/SSE | 远程访问、多客户端共享 | P1 |
| WebSocket | 实时双向通信 | P2 |

**第一期只做 stdio**，最简单、生态最成熟。

---

## 3. 暴露的能力（Tools）

### 3.1 P0 — 核心读写（MVP）

| 工具名 | 能力 | 参数 | 返回 |
|--------|------|------|------|
| `list_graphs` | 列出所有产线 | 无 | 产线列表（id, name, updatedAt） |
| `get_graph` | 获取产线详情 | graphId | 节点/配置/连接完整 JSON |
| `run_graph` | 运行产线 | graphId, input(可选), images(可选) | runId（异步，立即返回） |
| `get_run_status` | 获取运行状态 | runId | status, progress, 当前节点 |
| `list_artifacts` | 列出运行产出 | runId | 产出列表（id, kind, label, uri） |
| `get_artifact` | 获取产出详情 | artifactId | 元数据 + 内容（文本直接返回） |

### 3.2 P1 — 管理增强

| 工具名 | 能力 |
|--------|------|
| `create_graph` | 从模板/空白创建产线 |
| `update_graph` | 更新节点配置（改提示词、换模型等） |
| `delete_graph` | 删除产线 |
| `cancel_run` | 取消运行中的产线 |
| `download_artifact` | 下载产出文件（base64 或 URL） |
| `search_knowledge` | 全文检索知识库 |

### 3.3 P2 — 高级

| 工具名 | 能力 |
|--------|------|
| `batch_run` | 批量运行产线（多组输入） |
| `get_run_events` | 获取运行事件流（实时展示用） |
| `compare_runs` | 对比两次运行的产出差异 |

---

## 4. 暴露的 Resources（只读资源）

MCP 支持 Resources，客户端可以像读文件一样读取：

| URI | 内容 |
|-----|------|
| `graph://{id}` | 产线完整配置（JSON） |
| `run://{id}` | 运行状态 + 产出摘要 |
| `artifact://{id}` | 产出内容（文本直接返回，图片返回 base64） |
| `template://{id}` | 产线模板 |

---

## 5. 暴露的 Prompts（提示词模板）

| 提示词 | 用途 |
|--------|------|
| `run_pipeline` | "帮我运行指定产线并总结结果" 的引导提示词 |
| `analyze_pipeline` | "分析产线性能瓶颈和优化建议" 的引导提示词 |
| `create_from_template` | "从模板创建产线并配置" 的引导提示词 |

---

## 6. 架构设计

### 6.1 进程模型：独立进程

```
┌─────────────────┐     stdio      ┌──────────────────┐     HTTP     ┌──────────────┐
│  Claude Desktop │ ◄─────────────► │  MCP Server 进程 │ ◄──────────► │  主 Server    │
│  Cursor / 豆包   │   JSON-RPC     │  (Node 独立进程) │   REST API   │  (现有 :8791) │
└─────────────────┘                └──────────────────┘              └──────────────┘
```

- MCP Server 是**独立 Node 进程**，由客户端（如 Claude Desktop）启动
- 通过 stdio 与客户端通信（JSON-RPC 2.0）
- 通过 HTTP API 调用主服务（复用现有 REST API）
- 不侵入主服务代码，独立部署、独立升级

### 6.2 目录结构

```
packages/
  mcp-server/                    # 新增包
    src/
      index.ts                    # stdio 入口
      server.ts                   # MCP Server 初始化
      client.ts                   # 主服务 HTTP API 客户端
      config.ts                   # 配置（URL/API Key）
      tools/
        graphs.ts                 # 产线管理工具
        runs.ts                   # 运行管理工具
        artifacts.ts              # 产出管理工具
        knowledge.ts              # 知识库工具
      resources/
        graph.ts                  # graph:// 资源
        run.ts                    # run:// 资源
        artifact.ts               # artifact:// 资源
    package.json
    tsconfig.json
```

### 6.3 技术选型

- **MCP SDK**：`@modelcontextprotocol/sdk`（官方 TypeScript SDK，不用手写协议）
- **HTTP 客户端**：Node 内置 fetch
- **配置**：环境变量（`AGENT_WORLD_URL`、`AGENT_WORLD_API_KEY`）

---

## 7. 客户端配置示例

Claude Desktop 的 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "agent-world": {
      "command": "node",
      "args": ["/path/to/agent-world/packages/mcp-server/dist/index.js"],
      "env": {
        "AGENT_WORLD_URL": "http://localhost:8791",
        "AGENT_WORLD_API_KEY": "your-key-if-needed"
      }
    }
  }
}
```

Cursor / 豆包等客户端配置类似。

---

## 8. 关键设计决策

### 8.1 长运行任务处理

产线运行可能需要几十秒到几分钟，MCP `tools/call` 是同步的。方案：

- **异步模式**：`run_graph` 立即返回 `runId`，不等待完成
- 客户端通过 `get_run_status` 轮询，或通过 MCP notifications 接收进度推送
- 避免单次 MCP 调用超时

### 8.2 大文件处理

- 图片/文件类 artifact 不直接在 MCP 响应中返回二进制
- `get_artifact` 返回元数据 + 下载 URL
- `download_artifact` 返回 base64（小文件）或临时下载链接（大文件）

### 8.3 错误处理

- 主服务不可用时返回清晰的 MCP 错误（code + message）
- 产线运行失败返回失败原因 + 日志摘要
- 工具参数校验失败返回 400 类错误

### 8.4 认证

- 主服务如果需要 API Key，MCP Server 从环境变量读取
- 不硬编码密钥，支持通过客户端 env 注入

---

## 9. 分期计划

| 阶段 | 内容 | 预估工作量 |
|------|------|-----------|
| **P0 MVP** | stdio 传输 + 6个核心工具 + 独立进程 + 基本错误处理 | 1-2天 |
| **P1 增强** | 管理类工具 + Resources + Prompts + HTTP/SSE 传输 | 2-3天 |
| **P2 高级** | 实时 notifications + 批量运行 + 对比分析 + 认证权限 | 3-5天 |

### P0 MVP 验收标准

- [ ] Claude Desktop 能连接 agent-world MCP Server
- [ ] `list_graphs` 能列出所有产线
- [ ] `get_graph` 能获取产线详情
- [ ] `run_graph` 能触发产线运行并返回 runId
- [ ] `get_run_status` 能查询运行状态
- [ ] `list_artifacts` / `get_artifact` 能获取产出
- [ ] 主服务不可用时返回清晰错误
- [ ] 基本的单元测试覆盖

---

## 10. 风险与注意事项

1. **长运行任务超时**：MCP 客户端可能有默认超时（如 30s），异步模式 + 轮询是必须的
2. **大文件传输**：artifact 可能很大（视频、长图），需要流式或分块处理
3. **认证安全**：API Key 通过环境变量传递，避免硬编码或日志泄露
4. **并发负载**：多客户端同时调用可能给主服务带来压力，需要考虑限流
5. **协议兼容性**：MCP 协议仍在演进，需要关注官方 SDK 版本更新
6. **Windows 兼容性**：stdio 传输在 Windows 上可能有编码问题，需要测试

---

## 11. 参考资料

- [MCP 官方规范](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [现有 MCP Client 实现](../packages/server/src/mcp.ts)
- [主服务 REST API](../packages/server/src/index.ts)
