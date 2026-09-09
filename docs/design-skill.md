# Skill 体系设计（技能卡）

> 状态：**已落地（2026-09-06 文档化）**。本文档把散落在三处的设计决策收拢为单一事实源：`packages/core/src/skill.ts` 头注释（设计声明）、[technical-design.md](technical-design.md) §11（权限模型演进）、[extending.md](extending.md) §3（面向使用者的操作指南）。此前 deferred-items「文档线」登记为「独立设计文档属锦上添花」，触发条件为「外部贡献者/多人协作需要设计论证文档」——现提前还清这笔文档债，让 Skill 体系有权威引用。
>
> 本文档只陈述**设计与实现现状**，不改动任何代码。面向两类读者：接 Skill 能力的新开发者（怎么接入）、以及未来做 Skill 生态（本地 skill / 节点市场）时核对契约的人。
>
> **2026-09-09 补**：§11 现状盘点（逐条核对代码的数量事实与缺口排序）、§12 作者指南（怎么加一张技能卡）。先读 §11.1——**机制是通的，但 33 个业务模板一张卡都没装**，这是当前最该补的事。

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

## 6. equips 依赖解析

prompt-module 的 `config.equips`（string[]）声明它依赖的其他模块，`collectPromptModules` 用 **BFS + 去重 + 环安全**递归收集（`engine.skills.test.ts` 有「多级 equips + 环」回归用例）。顺序：主模块 → equips 依赖，靠 seen 集合防重复展开。

## 7. 内置 skill 清单（`skills/registry.ts`）

| id | name | kind | 权限/danger | 说明 |
|---|---|---|---|---|
| `web_fetch` | 网页抓取 | tool | network `["*"]` | 抓 URL 文本（HTTPS only，`guardedFetch` + 15s 超时 + 8000 字符截断） |
| `json_extract` | JSON 提取 | tool | 无网络/fs | 按点/括号路径取 JSON 值 |
| `current_time` | 当前时间 | tool | 无 | 返回 ISO 时间戳 |
| `fs_write` | 写文件 | tool | **danger: true** | 写工作区 `TOOL_FS_ALLOW` 目录下文件，每次需人工批准 |
| `archive_search` | 档案检索 | tool | 无 | FTS5 检索知识库（`setMemoryBackend` 注入 backend） |

## 8. 扩展点

- **`registerSkill(skill)`**：运行时注册新技能（MCP 工具经 `registerMcpTools` 调用它，id 形如 `mcp:<server>:<tool>`）。
- **`getSkill(id)` / `listBuiltinSkills()`**：查单个 / 列全部（`GET /api/skills` 返回清单，前端技能卡选择器消费）。
- **`setMemoryBackend(mb)`**：注入记忆后端，供 `archive_search` 使用（server 启动时接线）。
- **新 kind 接入**：加 kind 枚举值 → 在对应节点执行体（textGen/gate）写消费点 → 在 `collectPromptModules`/`getOutputContract`/`resolveTools` 之类纯函数里加分支。

## 9. 与 MCP 的关系

MCP 工具是 Skill 的**一个来源**（`source: "mcp"`），不是独立体系：`mcp.ts` 的 `registerMcpTools` 把 MCP server 暴露的 tools 逐个 `registerSkill` 进同一 registry，之后和内置 skill 走完全相同的消费链（`resolveTools` / `executeBuiltinTool` / 权限展示）。差异只在信任级别与协议层（Bearer 认证 + MCP 握手），执行侧无特殊分支。

## 10. 边界与后续

> §11 是逐条核对代码后的现状盘点（2026-09-09），本节只列判断；具体缺口与「为什么现在不做」见 §11。

- **本地 skill（`source: "local"`）未落地**：schema 已声明三态，但「用户 `skills/` 目录自定义」目前只有字段没有加载器——触发条件见 deferred-items「节点市场/自定义节点」（用户主动提出扩展诉求）。
- **`judge` kind 消费待完善**：gate 节点「质检也能装备技能卡」是 technical-design 声明的方向，当前 gate judge 走 `worker.judge()`，judge 类 skill 的完整挂载链是后续增量。
- **硬权限强制依赖隔离**：§4 第二/三层未落地前，权限声明是「诚实展示 + 受约束代理」，不是内核级隔离——deferred 沙箱线追踪。

## 11. 现状盘点（2026-09-09 核对代码）

写这一节的原因：§1–§9 描述的是**设计**，容易被读成已全部生效。以下每条都对着源码数过。

### 11.1 数量事实

| 项 | 数字 | 出处 |
|---|---|---|
| 内置技能卡 | **5** 张，全是 `kind: "tool"` | `packages/server/src/skills/registry.ts` |
| `prompt-module` / `output-contract` / `judge` 的内置实现 | **0** 张 | 同上（三种 kind 只有 runtime 消费点，没有内置卡；测试里有 fixture） |
| 模板里预挂的技能卡 | **0 处**：49 个 `skills: []` 槽位全为空 | `packages/core/src/templates.ts`（34 个模板 = 33 业务 + 1 空白） |
| MCP 来源技能卡 | 运行时动态注册，数量取决于用户接了几个 MCP server | `registerMcpTools` → `registerSkill` |

**结论：Skill 机制是通的，但没人在用。** 引擎侧的四条消费链（`resolveTools` / `collectPromptModules` / `getOutputContract` / danger 审批）都有回归测试，可是 33 个业务模板一张卡都没装。所以这不是「功能缺失」，是**默认值缺失**——用户新建产线时看不到任何示例，只能自己从技能卡选择器里摸索。

### 11.2 四种 kind 的实际消费状态

| kind | 消费点是否存在 | 状态 |
|---|---|---|
| `tool` | ✅ `resolveTools()` + `executeBuiltinTool()` + `guardToolCall` + danger halt | 完整可用，5 张内置卡 |
| `prompt-module` | ✅ `collectPromptModules()`，含 `equips` BFS 与环安全 | 机制可用，**无内置卡**——用户得自己造 |
| `output-contract` | ✅ `getOutputContract()` + `validateContract()` + rework 回边 | 机制可用，**无内置卡** |
| `judge` | ❌ **没有消费点** | `SkillKind` 枚举里有它，但 `nodes/gate.ts` 从不读节点的 `skills` 字段，judge 完全走 `worker.judge()` 的模型判定。这是个**声明了但没接线**的 kind |

### 11.3 权限强制的真实粒度

§4 说「第一层权限声明已落地」，准确的说法是：**强制是按工具硬编码的，不是从声明里推导的。**

`permissions.ts` 的 `opForTool(name, args)` 只认识两个网络工具（`web_fetch` / `web_search`，从 `url` 参数取 host 去撞白名单）和 fs 操作。对任何其他 skill，它返回空 op，于是 `evaluateToolCall` 无事可查——**一张声明了 `network: { domains: [...] }` 的新技能卡，如果它自己直接 `fetch()`，声明不会拦住它**。

所以当前的保障实际来自三处，都不是「读声明」：

1. 内置工具的实现自己调 `guardedFetch`（SSRF + 域名白名单）与 fs-guard 路径校验；
2. `TOOL_NETWORK_ALLOW` / `TOOL_FS_ALLOW` / `TOOL_SUBPROCESS_ALLOW` 三个**服务端级**环境变量（与技能卡声明取交集）；
3. `danger: true` 的确定性人工审批（这条是真的、可靠的）。

这不是 bug——§1 的原则就是「权限声明先于强制」，Phase 4/5 才硬强制。但文档必须写清楚，别让人以为写了 `permissions` 就等于沙箱。

### 11.4 需要补强的排序

| 优先级 | 缺口 | 为什么 |
|---|---|---|
| **高** | 模板里预挂技能卡（至少给 2–3 个模板做示范） | 唯一真正影响用户能否发现这个功能的事。49 个空槽位意味着 Skill 对用户是隐形的 |
| **高** | 补 1–2 张内置 `prompt-module` 与 `output-contract` 卡 | 机制有、样例无，用户没有可抄的东西 |
| 中 | `judge` kind 接线或从枚举里删掉 | 声明了不接线是最糟的状态：读者以为能用 |
| 中 | 把权限强制从「按工具硬编码」改为「按声明驱动」 | 不需要等沙箱，`opForTool` 改成读 skill 声明就能覆盖新卡 |
| 低 | `source: "local"` 加载器 | 等外部贡献者出现再说（deferred 已登记） |

## 12. 作者指南：怎么加一张技能卡

### 12.1 内置 `tool` 卡

在 `packages/server/src/skills/registry.ts` 里加一个对象并塞进 `ALL` 数组：

```ts
const myTool: BuiltinSkill = {
  id: "my_tool",                    // 同时是模型看到的工具名，必须全局唯一
  name: "我的工具",
  description: "一句话说清它干什么——这句会进模型的工具列表，写不清模型就不会调",
  kind: "tool",
  permissions: { network: { domains: ["api.example.com"] }, subprocess: false, env: [] },
  source: "builtin",
  config: {
    parameters: {                   // JSON Schema，模型据此填参
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  async execute(args) { /* 返回字符串给模型 */ },
};
```

三条要点：

- **`permissions` 缺省即不授予**，但**目前不会自动强制**（§11.3）——你的 `execute` 要自己调 `guardedFetch` / fs-guard，别指望声明拦住你。
- **不可逆或对外产生变更的操作必须 `danger: true`**（写文件、发帖、调支付）。加了它，每次调用都会挂起 run 等人工 approve，这是唯一真正可靠的把关。
- `description` 是给模型看的，不是给人看的。

### 12.2 `prompt-module` 卡

`config.prompt` 放要注入 system prompt 的文本；`config.equips` 放它依赖的其他模块 id（BFS 递归收集，环安全）：

```ts
{ id: "brand-voice", kind: "prompt-module", source: "builtin",
  permissions: {}, config: { prompt: "写作时保持…", equips: ["tone-base"] } }
```

### 12.3 `output-contract` 卡

`config.schema` 放 JSON Schema。节点产出后校验 required 键与 property 类型，不满足走 rework 边打回重写（超重试上限才 failed）。**一个节点只生效第一张** output-contract 卡。

### 12.4 挂到节点上

节点的 `skills` 字段是 `SkillMount[]`：

```ts
textGen: { ...,
  skills: [{ id: "json_extract", config: {}, enabled: true }] }
```

- `config` 是**本次挂载**的覆盖值，不动共享的 Skill 定义——同一张卡挂两个节点可以带不同参数。
- `enabled: false` 保留挂载但不生效（便于 A/B 与临时关闭）。
- 旧格式 `skills: ["json_extract"]`（纯 id 字符串）由 `toMount()` 自动规范化，向后兼容。

### 12.5 验证

- `GET /api/skills` 应能列出新卡（前端技能卡选择器消费同一份数据）；
- 加回归用例：`engine.tools.test.ts`（tool 调用）、`engine.skills.test.ts`（prompt-module / contract）、`engine.danger.test.ts`（danger 审批）三个文件里已有对应 idiom 可抄。

