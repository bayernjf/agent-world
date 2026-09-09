# Skill 体系设计（技能卡）

> 状态：**已落地（2026-09-06 文档化）**。本文档把散落在三处的设计决策收拢为单一事实源：`packages/core/src/skill.ts` 头注释（设计声明）、[technical-design.md](technical-design.md) §11（权限模型演进）、[extending.md](extending.md) §3（面向使用者的操作指南）。此前 deferred-items「文档线」登记为「独立设计文档属锦上添花」，触发条件为「外部贡献者/多人协作需要设计论证文档」——现提前还清这笔文档债，让 Skill 体系有权威引用。
>
> 本文档只陈述**设计与实现现状**，不改动任何代码。面向两类读者：接 Skill 能力的新开发者（怎么接入）、以及未来做 Skill 生态（本地 skill / 节点市场）时核对契约的人。
>
> **2026-09-09 补**：§11 现状盘点（逐条核对代码的数量事实与缺口排序）、§12 作者指南（怎么加一张技能卡）。
>
> **2026-09-09 二次更新**：§11.4 排的前四条已全部落地——内置卡补齐到 11 张（四种 kind 各有样例）、`judge` kind 接进 gate 节点、权限强制改为声明驱动、三个模板预挂了卡。§11 已按落地后的代码重写。

## 1. 设计原则

- **Skill 是唯一的扩展点**：节点类型本身是固定的（source/textGen/gate/sink 等 29 种），而「一个节点能做什么」通过装备技能卡来变化。Skill 不是付费墙，是**能力开关 + 配置预设**，无解锁成本。
- **限制必须落在代码层，不靠模型自我约束**（technical-design §11.1 核心原则）：system prompt 里写「不要删文件」是建议，不是沙箱。所以危险操作走**确定性审批**（见 §4），权限走**声明 + 隔离**（§4）。
- **权限声明先于强制**：权限字段在 Phase 1 就声明（让技能卡带上稳定契约），Phase 2 展示记录，Phase 4/5 进程/容器隔离落地后才硬强制。

## 2. 数据模型（`packages/core/src/skill.ts`）

### 2.1 `SkillKind` — 四种 kind

```ts
SkillKind = "tool" | "prompt-module" | "output-contract" | "judge"
```

| kind | 语义 | 消费点 |
|---|---|---|
| `tool` | agent 可调用的工具，runtime 经工具注册表解析 | `resolveTools()` + `executeBuiltinTool()` |
| `prompt-module` | 往 system prompt 注入文本（含多级 `equips` 依赖） | `collectPromptModules()` |
| `output-contract` | 声明 JSON Schema 输出契约，产出后校验，不满足走 rework | `getOutputContract()` + `validateContract()` |
| `judge` | 质检（gate）可装备的技能卡 | gate 节点 judge 链 |

### 2.2 `SkillPermissions` — 权限声明

```ts
SkillPermissions = {
  network?: { domains: string[] }            // 出站域名白名单，缺省 = 无网络
  fs?: { paths: string[]; read; write }      // 文件访问，缺省 = 无 fs
  subprocess?: boolean                        // 能否起子进程
  env?: string[]                              // 能读哪些环境变量名
  danger?: boolean                            // 不可逆/对外变更操作，需人工审批（4D.7）
}
```

语义：「字段缺省 = 不授予」；`danger` 是另一维（见 §4），不并入权限矩阵。

### 2.3 `Skill` — 技能卡定义

```ts
Skill = {
  id: string
  name: string
  description: string
  kind: SkillKind
  permissions: SkillPermissions
  danger?: boolean                 // tool 类不可逆操作标记（4D.7）
  source: "builtin" | "local" | "mcp"   // 来源，控制信任与隔离级别
  config: Record<string, unknown>       // kind 相关的预设（prompt 文本 / schema 等）
}
```

### 2.4 `SkillMount` — 挂载引用

```ts
SkillMount = { id: string; config: Record<string, unknown>; enabled: boolean }
```

节点上的 `skills` 字段曾是 `string[]`（纯 id 列表）。`SkillMount` 让**每次挂载**能带独立 config 覆盖（如某次挂载改 prompt-module 的变量、改 tool 的参数），而不改动共享的 Skill 定义。`toMount()` 把旧的 id 字符串规范化为 `{ id, config: {}, enabled: true }`。

## 3. `source` 三态

| source | 来源 | 信任/隔离 |
|---|---|---|
| `builtin` | 内置目录（`skills/registry.ts` 的 `ALL` 数组） | 高信任，随版本发布 |
| `local` | 用户 `skills/` 目录放的自定义 skill | 待定，隔离落地后按 §4 处理 |
| `mcp` | MCP server 的工具自动注册（`registerMcpTools` → `registerSkill`） | 外部信任，受 MCP 协议 + Bearer 认证约束 |

## 4. 权限模型与演进

权限是分阶段收紧的（technical-design §11.2「分层方案」），当前落地位于第一层 + danger 审批：

1. **第一层：权限声明（已落地）**——skill 注册时声明 `permissions`，装备时展示授权提示（像手机 app 权限），运行时工具拿到的是**受约束代理**（网络走 `guardedFetch` 域名白名单、文件走路径校验的 fs 代理），不直接暴露裸能力。
2. **第二层：进程隔离（缓做，deferred 沙箱线）**——不信任的 worker/connector 进子进程，裁剪 env、文件/网络经主进程代理审计。触发条件：部署形态明确（多租户/云托管）。
3. **第三层：OS 级约束（缓做）**——macOS `sandbox-exec` / Linux seccomp+namespaces。

**例外：`danger` 工具审批已落地（4D.7 dangerous-action halt）**——标记 `danger: true` 的工具（内置 `fs_write`）每次调用前必须人工批准：引擎抛 `HaltRequested` → run 挂起 → 人工 approve 后 resume 重跑该节点。这条不依赖进程隔离，是对「不可逆操作」的**确定性把关**，而不是等沙箱。

## 5. 运行时消费链

### 5.1 工具注入（textGen 节点）

```ts
const tools = [...resolveTools(mounts), ...VARIABLE_TOOLS];
```

- `resolveTools()`：把挂载的 `tool` kind skill 转成模型可调用的 `ToolDefinition[]`（剥离 execute，只暴露 name/description/parameters）。
- `VARIABLE_TOOLS`：引擎内置的两个 graph 变量工具 `set_variable` / `get_variable`（跨 run 持久状态，永远随每次 agent 注入，安全无需审批）。

### 5.2 工具执行（executeTool 闭包）

调用顺序（`nodes/textgen.ts`）：
1. `set_variable` / `get_variable` → `handleVariableTool`（内置，走 graph variables map）；
2. `guardToolCall` 按 `PermissionConfig` 把关；
3. `isDangerousTool(name)` 且未被批准 → 抛 `HaltRequested`（挂起等人工）；
4. 其余 → `executeBuiltinTool`（查 registry 执行）。

### 5.3 prompt-module 注入

`collectPromptModules(mounts)` 把所有 `kind === "prompt-module"` 且 config 有 `prompt` 文本的技能按顺序收集，拼进 agent 的 system prompt（`=== 已挂载模块提示 (prompt-module) ===` 分隔）。支持 `equips` 多级依赖（见 §7）。

### 5.4 output-contract 输出契约

`getOutputContract(mounts)` 取第一个 `kind === "output-contract"` 且带 `schema` 的技能；agent 产出后 `validateContract(output, schema)` 校验（剥 ```json``` 围栏、要求 JSON 对象、检查 required 键与 property 类型）。不满足则走 rework 边打回重写，超出重试上限才 failed。

### 5.5 judge 判据注入（gate 节点）

`collectJudgeCriteria(mounts)` 收集 gate 节点上所有 `kind === "judge"` 且 config 有 `criterion` 文本的技能卡；`gateNode` 把它们拼在 `gate.criterion` 之后（`附加判据：` + 列表），再交给 `worker.judge()`。禁用词/品牌词覆盖率那两条确定性硬规则不受影响，仍在模型判定之后独立生效。

注意 gate 的技能卡只吃 `judge` 一种 kind：前端 SkillPicker 在 gate 节点上按 `kinds={["judge"]}` 过滤目录，`templates.skills.test.ts` 也把这条约束钉成了回归测试。

## 6. equips 依赖解析

prompt-module 的 `config.equips`（string[]）声明它依赖的其他模块，`collectPromptModules` 用 **BFS + 去重 + 环安全**递归收集（`engine.skills.test.ts` 有「多级 equips + 环」回归用例）。顺序：主模块 → equips 依赖，靠 seen 集合防重复展开。

## 7. 内置 skill 清单（`skills/registry.ts`）

共 **11 张**，四种 kind 都有样例。

| id | name | kind | 权限/danger | 说明 |
|---|---|---|---|---|
| `web_fetch` | 网页抓取 | tool | network `["*"]` | 抓 URL 文本（HTTPS only，`guardedFetch` + 15s 超时 + 8000 字符截断） |
| `json_extract` | JSON 提取 | tool | 无网络/fs | 按点/括号路径取 JSON 值 |
| `current_time` | 当前时间 | tool | 无 | 返回 ISO 时间戳 |
| `fs_write` | 写文件 | tool | fs write（`paths: []`）+ **danger: true** | 写 `TOOL_FS_ALLOW` 目录下文件，每次需人工批准 |
| `archive_search` | 档案检索 | tool | 无 | FTS5 检索知识库（`setMemoryBackend` 注入 backend） |
| `zh_style_guide` | 中文文案规范 | prompt-module | 无 | 短句、去营销黑话、数字用阿拉伯数字 |
| `cite_sources` | 引用来源 | prompt-module | 无 | 每条事实标来源，无依据的必须写「推测：」 |
| `report_json` | 报告 JSON 契约 | output-contract | 无 | 约束成 `{title, summary, points}` |
| `verdict_json` | 结论 JSON 契约 | output-contract | 无 | 约束成 `{verdict, score, issues}` |
| `judge_fact_check` | 事实一致性质检 | judge | 无 | 判据：不得出现上游资料里没有的事实/数字/日期 |
| `judge_readability` | 可读性质检 | judge | 无 | 判据：单句过长、无小标题、未解释缩写 |

## 8. 扩展点

- **`registerSkill(skill)`**：运行时注册新技能（MCP 工具经 `registerMcpTools` 调用它，id 形如 `mcp:<server>:<tool>`）。
- **`getSkill(id)` / `listBuiltinSkills()`**：查单个 / 列全部（`GET /api/skills` 返回清单，前端技能卡选择器消费）。
- **`setMemoryBackend(mb)`**：注入记忆后端，供 `archive_search` 使用（server 启动时接线）。
- **新 kind 接入**：加 kind 枚举值 → 在对应节点执行体（textGen/gate）写消费点 → 在 `collectPromptModules`/`getOutputContract`/`resolveTools` 之类纯函数里加分支。

## 9. 与 MCP 的关系

MCP 工具是 Skill 的**一个来源**（`source: "mcp"`），不是独立体系：`mcp.ts` 的 `registerMcpTools` 把 MCP server 暴露的 tools 逐个 `registerSkill` 进同一 registry，之后和内置 skill 走完全相同的消费链（`resolveTools` / `executeBuiltinTool` / 权限展示）。差异只在信任级别与协议层（Bearer 认证 + MCP 握手），执行侧无特殊分支。

## 10. 边界与后续

> §11 是逐条核对代码后的现状盘点（2026-09-09），本节只列判断；具体缺口与「为什么现在不做」见 §11。

- **本地 skill（`source: "local"`）已部分落地**：用户可在设置页自建三种数据卡（prompt-module / output-contract / judge），每次运行随 owner 注入；但「扫用户 `skills/` 目录」和用户自建 `tool` 卡仍未做——后者要跑用户代码，触发条件见 deferred-items 沙箱线。
- **硬权限强制依赖隔离**：§4 第二/三层未落地前，权限强制只能覆盖**出现在工具参数里**的意图（见 §11.3）。一张卡在 `execute()` 内部硬编码 `fetch()`，参数里留不下痕迹，声明就拦不住——这条只能靠进程/容器隔离补，deferred 沙箱线追踪。

## 11. 现状盘点（2026-09-09 核对代码）

写这一节的原因：§1–§9 描述的是**设计**，容易被读成已全部生效。以下每条都对着源码数过。

### 11.1 数量事实

| 项 | 数字 | 出处 |
|---|---|---|
| 内置技能卡 | **11** 张：5 tool + 2 prompt-module + 2 output-contract + 2 judge | `packages/server/src/skills/registry.ts` |
| 模板里预挂的技能卡 | **6 张卡，5 个挂载点**，覆盖 4 个模板（`tpl-research-brief` / `tpl-data-report` / `tpl-contract-review` / `tpl-xiaohongshu`） | `packages/core/src/templates.ts`（34 个模板 = 33 业务 + 1 空白） |
| 槽位总数 / 仍为空 | 51 个（49 `textGen.skills` + 2 `gate.skills`）；空 46 个，全是 textGen | 同上——留空是默认状态，不是缺陷；示范够用即可 |
| MCP 来源技能卡 | 运维的 server 走 `registerMcpTools` → `registerSkill`（进程全局）；用户在设置页接的 server 工具进 per-user 连接池，按运行注入（§13.1 / §13.3） | `mcp.ts` / `mcp-pool.ts` |

之前这一节记录的是「机制通了但没人在用：49 个槽位全空、三种 kind 零内置卡」。那笔债在 2026-09-09 还清了：四种 kind 各有可抄的内置卡，4 个模板带着装好的卡开箱即用，`templates.skills.test.ts` 把「模板挂的 id 必须能在 registry 里解析」钉成回归测试。

### 11.2 四种 kind 的实际消费状态

| kind | 消费点 | 内置卡 |
|---|---|---|
| `tool` | `resolveTools()` + `executeBuiltinTool()` + `guardToolCall` + danger halt | 5 张 |
| `prompt-module` | `collectPromptModules()`，含 `equips` BFS 与环安全 | 2 张 |
| `output-contract` | `getOutputContract()` + `validateContract()` + rework 回边 | 2 张 |
| `judge` | `collectJudgeCriteria()` → 拼进 `gate.criterion`（§5.5） | 2 张 |

四种 kind 都有消费点、都有内置卡、都有回归测试。`judge` 曾是「声明了但没接线」——`SkillKind` 里有它而 `nodes/gate.ts` 从不读 `skills` 字段；现在 `GateConfig` 有了 `skills`，gate 会把判据拼进 criterion。

### 11.3 权限强制的真实粒度

强制**已经是声明驱动的**：`permissions.ts` 的 `opForTool(skill, args, cfg)` 从技能卡自己声明的 `permissions` 推导这次调用意图，不再按工具名硬编码。

- 声明了 `network.domains` 的卡：参数里**任意嵌套深度**（上限 4 层）的字符串只要能解析成 URL，其 host 就要撞该卡自己的域名白名单；
- 声明了 `fs` 的卡：键名像路径的参数（`path` / `file` / `dir` / `dest` …）按写意图校验，并撞 `TOOL_FS_ALLOW`。`paths: []` 表示「根由运维配，卡自己不指定」；
- 声明了 `subprocess: true` 的卡：受 `TOOL_SUBPROCESS_ALLOW` 服务端开关约束。

`fs_write` 也顺势把它真正在用的 fs 授权声明出来了——此前它写文件却一条 fs 权限都没声明，在旧的硬编码路径下畅通无阻。

**仍然拦不住的**：一张卡在 `execute()` 内部硬编码 `fetch("https://evil.com")` 或自己拼路径，参数里留不下痕迹，推导就无从下手。这不是推导写得不够聪明，是这一层能力的天花板——补它需要进程/容器隔离（§4 第二/三层），deferred 沙箱线追踪。`permissions.test.ts` 里有一条用例专门把这个洞钉住，别让它被当成 bug 反复「修」。

除声明驱动之外，另有两处保障：内置工具实现自己调 `guardedFetch`（SSRF + 域名白名单）；`danger: true` 的确定性人工审批（这条是真的、可靠的）。

### 11.4 剩下的缺口

| 优先级 | 缺口 | 为什么还不做 |
|---|---|---|
| 低 | 自建 `tool` 卡 / 用户目录扫描 | 数据卡（§13.2）已落地；剩下的是跑用户代码的形态，等沙箱线（deferred 已登记） |
| 低 | 硬隔离（进程/容器） | §11.3 最后一段那个洞的唯一真解，但要等真实用量证明必要性——deferred 沙箱线 |
| 低 | 更多模板预挂卡 | 4 个模板的示范已足够让用户发现这个功能；再铺开属于内容工作，不是机制工作 |

## 12. 作者指南：怎么加一张技能卡

### 12.1 内置 `tool` 卡

在 `packages/server/src/skills/registry.ts` 里加一个 `BuiltinSkill` 并塞进 `ALL` 数组。注意**可执行体在 `tool` 子对象里**，不是顶层：

```ts
const myTool: BuiltinSkill = {
  id: "my_tool",                    // 卡 id，也是权限查表的键
  name: "我的工具",
  description: "给人看的说明（技能卡选择器里显示）",
  kind: "tool",
  source: "builtin",
  permissions: { network: { domains: ["api.example.com"] }, subprocess: false, env: [] },
  config: {},
  tool: {
    name: "my_tool",                // 模型看到的工具名，与 id 保持一致
    description: "一句话说清它干什么——这句进模型的工具列表，写不清模型就不会调",
    parameters: {                   // JSON Schema，模型据此填参
      type: "object",
      properties: { query: { type: "string", description: "…" } },
      required: ["query"],
    },
    async execute(args) { /* 返回值给模型 */ },
  },
};
```

三条要点：

- **`permissions` 缺省即不授予**，而且现在**真的会强制**：`opForTool` 从你的声明推导本次调用意图，参数里出现的 URL 要撞你自己写的 `network.domains`，路径要撞 `fs.paths` 与 `TOOL_FS_ALLOW`（§11.3）。所以声明写窄了会把自己拦住——这是预期行为。反过来，声明也**只能管到参数里的东西**：`execute` 内部硬编码的 `fetch` 无迹可寻，那部分仍要自己调 `guardedFetch` / fs-guard。
- **不可逆或对外产生变更的操作必须 `danger: true`**（写文件、发帖、调支付）。加了它，每次调用都会挂起 run 等人工 approve，这是唯一真正可靠的把关。
- `tool.description` 是给模型看的，`description` 是给人看的（技能卡选择器）——两者用途不同，别复制粘贴。
- **技能卡在主进程内执行**（`nodes/textgen.ts` → `executeBuiltinTool`），没有子进程沙箱。`isolation.ts` 的 `IsolatedWorker` 隔离的是 **Worker（模型 provider 插件）**，与技能卡无关，别混淆。

### 12.2 `prompt-module` 卡

`config.prompt` 放要注入 system prompt 的文本；`config.equips` 放它依赖的其他模块 id（BFS 递归收集，环安全）：

```ts
{ id: "brand-voice", kind: "prompt-module", source: "builtin",
  permissions: {}, config: { prompt: "写作时保持…", equips: ["tone-base"] } }
```

### 12.3 `output-contract` 卡

`config.schema` 放 JSON Schema。节点产出后校验 required 键与 property 类型，不满足走 rework 边打回重写（超重试上限才 failed）。**一个节点只生效第一张** output-contract 卡。

### 12.4 `judge` 卡

`config.criterion` 放要追加到 gate 判据的文本。挂在 **gate 节点**的 `gate.skills` 上（不是 `textGen.skills`），`gateNode` 会拼在 `gate.criterion` 之后再交给模型判定：

```ts
{ id: "judge-length", kind: "judge", source: "builtin",
  permissions: {}, config: { criterion: "正文必须在 300–800 字之间，超出即判不通过。" } }
```

判据只影响模型判定那一步；禁用词命中与品牌词覆盖率是确定性硬规则，独立于此、不受判据措辞影响。

### 12.5 挂到节点上

节点的 `skills` 字段是 `SkillMount[]`：

```ts
textGen: { ...,
  skills: [{ id: "json_extract", config: {}, enabled: true }] }
```

- `config` 是**本次挂载**的覆盖值，不动共享的 Skill 定义——同一张卡挂两个节点可以带不同参数。
- `enabled: false` 保留挂载但不生效（便于 A/B 与临时关闭）。
- 旧格式 `skills: ["json_extract"]`（纯 id 字符串）由 `toMount()` 自动规范化，向后兼容。

### 12.6 验证

- `GET /api/skills` 应能列出新卡（前端技能卡选择器消费同一份数据）；
- 加回归用例，四种 kind 各有可抄的 idiom：`engine.tools.test.ts`（tool 调用）、`engine.skills.test.ts`（prompt-module / contract / judge）、`engine.danger.test.ts`（danger 审批）、`permissions.test.ts`（声明驱动的权限推导）；
- 如果这张卡要预挂到模板上，`skills/templates.skills.test.ts` 会校验 id 能解析、gate 只挂 judge 卡——改名忘了同步会在这里炸。


---

## 13. 用户自带能力：两条路径的现状（2026-09-09 落地）

§12 讲的是**开发者**怎么加卡——改 `registry.ts`、发版。这一节讲**用户**能不能自带能力。
两条路现在都通了，且共用同一套 per-user 地基。

### 13.1 接第三方 MCP 服务 —— 用户可自助接入

[`mcp.ts`](../packages/server/src/mcp.ts) 是完整的 MCP **客户端**，三种传输都实现：

| transport | 形态 | 配置入口 |
|---|---|---|
| `stdio` | spawn 本地进程，按行框 JSON-RPC | **仅运维**：`MCP_SERVERS` 环境变量 |
| `http` | Streamable HTTP（2025-03-26），`headers` 可带 `Authorization` | 用户设置页 + env |
| `sse` | 长活 GET 流 + POST 回传 | 用户设置页 + env |

连上后 `registerMcpTools` 把远端每个 tool 注册成技能卡（id `mcp:<server>:<tool>`，
`source: "mcp"`），之后与内置卡走**完全相同**的消费链（§9）。远端默认**零权限授予**
（`{ subprocess: false, env: [] }`）；连不上不致命，那次运行少几张卡而已。

用户路径（[`mcp-pool.ts`](../packages/server/src/mcp-pool.ts)）与运维路径并存：

- **per-user 连接池。** 服务器定义存在用户的 `AppConfig.mcpServers`，连接按 userId 隔离；
  同一 userId 用相同 endpoint + headers 时复用连接，改了任一参数指纹变化则重连。
- **凭证随设置 blob 静态加密。** `AppConfig` 整体加密落盘，`headers` 天然受保护，没有单独建表。
  GET 时 header 名可见、值打码；表单把打码值回传即视为「不改动」，与搜索服务 Key 同一 idiom。
- **保存即试连 + 手动重连。** `POST /api/mcp/:id/connect` 同步做一次握手，
  把发现的工具数 / 工具名或失败原因返回给设置页；后台不做自动重试。
- **stdio 刻意不开放给用户。** spawn 命令等于任意代码执行框，只保留给 env 路径的运维。
- 每次试连写一条审计记录，只含 transport / 成败 / 工具数，**不含 header 值**。

### 13.2 自制技能卡（`source: "local"`）—— 三种数据卡已落地

schema 在 [`skill.ts`](../packages/core/src/skill.ts) 的 `UserSkillCard`：
用户只能写三种 **kind**，因为它们的 payload 就是数据——

| kind | payload | 消费点 |
|---|---|---|
| `prompt-module` | `prompt` 文本 | `collectPromptModules` → 系统提示 |
| `output-contract` | `fields[]`（字段名/类型/必填） | `getOutputContract` + `validateContract` |
| `judge` | `criterion` 一句判据 | gate 节点 `collectJudgeCriteria` |

卡片存在 `AppConfig.skillCards`，id 必须带 `local:` 前缀（zod 强制），
设置页的契约编辑器是字段表而不是 JSON schema 框——校验器只读字段名、类型和必填。

**`tool` kind 不开放**：那要跑用户代码，卡沙箱那条线（deferred 仍登记）。

### 13.3 隔离与优先级：全局优先，per-run 注入

用户的卡和 MCP 工具**不进进程级全局 registry**（那会串用户）。每次运行由
[`user-skills.ts`](../packages/server/src/skills/user-skills.ts) 组装一张该运行 owner
专属的 `Map`，经 engine options 注入；`resolveSkill(id, extra)` **先查全局 registry 再查
用户 map**——用户卡只能补充，永远盖不住内置或运维配置的同名 id（有专门测试钉住这条）。
`/api/skills` 给技能选择器的目录也是「内置 + 调用者自己的卡」，别人的卡不可见。
