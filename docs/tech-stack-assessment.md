# 技术栈评估

> 本文档记录对当前技术栈的诚实评估：哪些是正确的长期选择，哪些有明确的边界，
> 以及在产品演进到什么阶段需要引入什么。结论是：当前栈适合现在和未来 2-3 个阶段，
> 不需要换，但要清楚边界在哪。
>
> 相关：[technical-design.md](technical-design.md)、[roadmap-tasks.md](roadmap-tasks.md)。

## 当前技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 语言 | TypeScript（ESM，Node ≥24） | 前后端同语言，共享类型 |
| Monorepo | pnpm workspaces | `core` / `server` / `web` 三包 |
| 核心包 | 纯函数 + zod | `compile()` / 事件流 / `replay()` / `reduce()` 无框架依赖 |
| Web 服务 | Hono + `@hono/node-server` | 轻量，SSE 友好，可跑边缘 |
| 前端 | React 19 + Vite 6 | zustand 状态、zundo 撤销 |
| 画布 | SVG（节点/管道）+ Canvas（卡车动画） | 分层渲染 |
| 数据库 | `node:sqlite`（内置） | 零外部依赖，WAL 模式 |
| 实时通信 | SSE | 单向事件流，断线可续传 |
| 测试 | Vitest | fake worker 保持确定性、毫秒级 |

## 正确的长期选择

### 1. `core` 是纯函数包，不依赖任何框架

`compile()` 产出 Plan，`execute()` 产出事件流，`replay()` / `reduce()` 从事件重建状态——
全是数据进数据出。这是整个项目最有价值的架构决策：

- 引擎可以跑在 Node、Bun、Cloudflare Workers、浏览器里；
- 测试不用起服务、不用 mock 网络；
- 换 DB、换队列、换部署环境都不动核心；
- 未来要给 worker 加一个 Python 实现（特殊模型/ML 能力），core 完全不用改。

### 2. TypeScript 端到端 + zod 契约

`Graph`、`RunEvent`、`AgentConfig`、`Usage` 在 core 定义一次，server 和 web 共享类型。
SSE 事件前后端不会对不上，重构时编译器帮你找到所有消费者。对一个需要快速迭代的产品，
这个收益远大于"Python AI 生态更丰富"的诱惑。

### 3. Hono 轻量

比 Express/Fastify 小，原生支持边缘部署，对以 SSE 流为主的 API 完全够用。
路由层薄，业务逻辑全在 engine 里，换框架成本低。

### 4. 事件溯源 + SQLite

事件是唯一真相，回放/审计/时间旅行天然支持。这跟"工厂流水线可观察"的产品隐喻高度契合。
本地单用户阶段零运维，WAL 模式并发读写够用。

### 5. 画布分层渲染

植物和管道用 SVG（可交互、可访问、易调试），卡车动画用 Canvas + ref
（几百个飞行物也不会触发 React re-render）。这是正确的性能分层。

## 要警惕的边界

### 1. 引擎跑在 HTTP 同进程，live run 在内存 Map

并发调度器、`live` Map、AbortController 全在 server 进程内。服务器重启，正在跑的产线
变 zombie（已有 `markZombiesInterrupted` 兜底标记为 interrupted）。

- **本地单用户**：没问题。
- **SaaS / 企业长任务**：一条产线跑 20 分钟，中途部署或崩溃就断了。
- **何时处理**：阶段 4/5。需要独立 worker 进程 + 持久队列（BullMQ、或直接上 Temporal/Inngest
  这类 durable execution）。roadmap 5.4 已规划 K8s，方向正确。
- **现在要做的准备**：保持 `engine.ts` 不依赖 Hono/HTTP，让 `runScheduler` 可以被独立
  worker 进程直接 import。当前已经是这个形态，守住边界即可。

### 2. SQLite 不适合多租户 SaaS

多租户并发写、向量检索、水平扩展都需要 Postgres（+ pgvector）。但 `db.ts` 是一个清晰的
薄层（prepared statements 集中在一个对象里），迁移到 Postgres 是替换实现，不是重写。
Milvus 等专用向量库等知识库阶段（5.2）再接，现在不碰。

### 3. 大图的画布性能

20 个节点以内 SVG 没问题。50+ 节点 + 实时状态频繁更新时，节点/管道的 React+SVG 渲染
可能掉帧。PacketLayer 已经用 Canvas 规避了最重的部分。如果图变密：

- 优先做鸟瞰/车间双视图、节点折叠；
- 再考虑把静态节点层也 canvas 化，或引入 LeaferJS / React Flow 这类专用渲染层。
- 这是阶段 4"20+ 节点"时要实测验证的点，不用现在做。

### 4. 沙箱是真隔离还是"承诺"

当前 worker 通过 `executeTool` 回调执行工具，不直接拿 `fetch`/`fs`，这是正确的能力注入方向。
但内置工具（如 `web_fetch`）目前跑在主进程里。等有写文件/执行代码的技能卡时：

- 必须上容器 / gVisor / Firecracker，或接 E2B/Daytona；
- 网络出方向用代理做域名 allowlist；
- 文件系统给临时目录、只读根。

roadmap 5.4 和 §11（安全与沙箱）已经写了，意识是对的。现在的 `ToolContext` 注入
就是在为那天留口子。

### 5. Python AI 生态

向量库客户端、某些 ML 模型、数据科学工具 Python 支持最好。但本产品明确**不做** LangGraph
竞品，是通过 HTTP 调模型 API——这跟语言无关。未来真要接 Python 能力：

- 给 Worker 接口加一个 gRPC/HTTP 的 Python 实现；
- 或者把某些技能卡实现为独立 sidecar 服务；
- core 完全不用动。

所以这不是换栈理由。

## 分阶段的基础设施演进

| 阶段 | 规模假设 | 需要加的东西 | 不需要动的东西 |
|---|---|---|---|
| 现在（阶段 1-3） | 本地单用户、几十节点 | — | — |
| 阶段 4 | 团队内部、多产线、触发器 | 独立 worker 进程、artifact 存储抽象（S3/本地） | core、事件模型、前端 |
| 阶段 5（托管） | 多租户 SaaS | Postgres+pgvector、Redis 队列、K8s、容器沙箱、KMS、SSO/RBAC | core 编译/执行/回放、画布、事件协议 |
| 企业私有化 | 客户内网部署 | Docker Compose / Helm、外发代理、客户自有模型 endpoint | 同托管 |

## 结论

**当前栈对当前阶段和未来 2-3 个阶段都是合适的，不需要换。**

核心依据：

1. `core` 的纯函数 + 事件溯源架构留了所有迁移路径（换 DB、换 worker、换部署、甚至换语言做 worker）；
2. 全栈 TypeScript 的迭代速度，在"快速把产品基调定下来"的阶段，价值远大于其他语言的生态优势；
3. 路线图阶段 4/5 那些"重活"（Postgres、队列、容器沙箱、K8s）是产品成熟的自然结果，
   不是"选错了栈"的证据。

**唯一要提前守的边界**：阶段 3 做运行历史/成本报表时，保持"引擎执行"和"HTTP 服务"
在代码上分层，让 `runScheduler` 可以被独立 worker 进程直接 import。目前 `engine.ts`
已经不依赖 Hono，继续守住这个边界。
