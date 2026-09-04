# 核心文件重构方案（engine.ts / Inspector.tsx）

> 状态：阶段 2.2 完成（28 节点迁至 nodes/，NodeRunContext 显式化，注册表分发） | 优先级：P1 | 创建日期：2026-09-04

## 0. 实施进度（2026-09-04 更新）

**已完成**：

- **阶段 1（拆 Inspector.tsx）**：`Inspector.tsx` 3848 → **611 行**（-84%）；新增 `apps/web/src/components/InspectorFields/`（`types.ts` + `shared.tsx` + `registry.tsx` + 27 个 `XxxFields.tsx`，共 3358 行）；主组件用 `FIELD_COMPONENTS[node.kind]` 注册表分发。web 测试 1500/1500 全绿。

- **阶段 2.1（runNode 闭包提取）**：29 个 `if (node.kind === "…")` 分支已提取 **28/29** 为 `runScheduler` 内部的 `runXxx` 闭包函数（`node`/`nodeId`/`attempt` 显式传参，共享状态闭包访问，行为不变）：human / compliance / publish / map / parallel / database / branch / ocr / convert / search / http / table / fileParse / translate / vcs / code / videoGen / audioGen / imageGen / source / sink / loop / subprocess / gate / generic / fanout / select。**唯一刻意保留内联的是** **`notify`**——提取为闭包后引入的异步边界会把 error 边派发推迟一个微任务，破坏「notify 失败→catch 节点接管」的语义（见 `regression/core-path.test.ts`）。`runNode` 从 \~3160 行降到 **\~380 行** 的分发器（-88%），每批 `typecheck` + 全量 server 测试全绿，原子 commit 共 10 个（`c31d659`→`847195a`）。

- **阶段 2.2（NodeRunContext + nodes/ 目录）**：`runScheduler` 构建单一 `NodeRunContext`（`nodes/types.ts`），把阶段 2.1 的全部闭包状态显式化——Maps/函数直接挂载，可变标量（status/running/aborted/finished/haltNodeId/haltReason/totalCostUsd/budgetWarned/monthlyWarned80/100）经 getter/setter 与调度器本地变量双向绑定，`runScheduler`/`runNode` 递归入口经 ctx 注入（无模块环依赖的运行时引用）。节点执行体全部迁至 `packages/server/src/nodes/`（28 个 `<kind>.ts` + `types.ts` + `shared.ts` 纯函数集），`runNode` 退化为 `NODE_HANDLERS` 注册表分发器（未知 kind 回落 textGen handler，与旧 if 链一致；notify 仍内联）。`engine.ts` 4954 → **1828 行**（-63%），每批迁移 `typecheck` + 全量 server 测试 **747/747** 全绿，原子 commit 9 个（`e89c30d`→`d379b93`）。

**收尾**：阶段 3（接口实现风格收敛约定）**已标记延后（低价值纯文档项，验收风险不在它，见 §7 实施顺序注记）**；真正关掉重构风险敞口的是回归实跑验证。

## 1. 摘要

本项目核心逻辑集中在两个巨型文件上：

| 文件                                      | 总行数  | 症结                                                                       | 风险 |
| --------------------------------------- | ---- | ------------------------------------------------------------------------ | -- |
| `packages/server/src/engine.ts`         | 4954 | `runNode` 一个函数约 3160 行（占 64%），29 种节点执行逻辑塞在一个 `if (node.kind === …)` 分支链里 | 高  |
| `apps/web/src/components/Inspector.tsx` | 3848 | `Inspector` 主组件约 3350 行（占 87%），25+ 种节点、约 250 个字段的内联 JSX 全堆在一个组件里         | 低  |

另有轻微问题：接口实现风格不统一（对象字面量 vs 工厂函数 vs class）。

本文档给出**分阶段、低风险优先、每步可验证**的重构方案。核心原则：**纯重构、行为不变、测试是唯一验收**。

## 2. 背景与现状

### 1.1 `engine.ts` 内部结构

| 区间              | 内容                                                           | 行数                |
| --------------- | ------------------------------------------------------------ | ----------------- |
| L84–L210        | 工具函数 + variant 系列（`buildVariantGraph` 等）                     | \~130             |
| L211–L290       | skill 处理（`collectPromptModules`、`validateContract`）          | \~80              |
| L291–L400       | 类型 + 常量（`ExecuteOptions`、`VARIABLE_TOOLS`、`NodeState`）       | \~110             |
| L406–L640       | artifact 工具（`setTextArtifact`、`collectUpstreamImages` 等）     | \~230             |
| L648–L755       | `EventQueue` + `SchedulerInit`/`SchedulerOptions`            | \~110             |
| L755–L1210      | `runScheduler`（`emit`/`finish`/`sendPackets`/`inputFor` 等辅助） | \~455             |
| **L1211–L4370** | **`runNode`（巨型函数）**                                          | **\~3160（占 64%）** |
| L4371–L4520     | `schedule`                                                   | \~150             |
| L4538–L4585     | `execute`                                                    | \~50              |
| L4587–L4750     | `ResumeState`/`reconstructState`/`ResumeOptions`             | \~160             |
| L4753–L4954     | `resume`                                                     | \~200             |

**症结**：`runNode` 把 29 种节点（source/textGen/imageGen/videoGen/audioGen/gate/http/code/branch/map/loop/parallel/table/database/fileParse/translate/ocr/convert/search/notify/vcs/human/subprocess/compliance/fanout/select/publish/generic）的执行逻辑塞在一条 `if (node.kind === "xxx")` 分支链里，每个分支重复同一套生命周期样板：

```
emit node.started → try → 执行 → emit artifact.produced / node.finished → sendPackets → catch → emit node.failed
```

这套样板被复制 29 次，且 `runNode` 闭包了十几个共享状态（`emit`/`states`/`artifacts`/`inputFor`/`sendPackets`/`nodeCtx` 等）。

> 注：节点执行体的「外部动作」已部分抽出（`vcs.ts`、`code-sandbox.ts`、`notify.ts`、`ocr.ts`、`search.ts`），`runNode` 里剩的是「编排 + emit 事件」层。

### 1.2 `Inspector.tsx` 内部结构

| 区间             | 内容                                                  | 行数                |
| -------------- | --------------------------------------------------- | ----------------- |
| L29–L100       | 工具函数（`formatUnits`/`formatDuration`/`parsePairs` 等） | \~70              |
| L113–L405      | `TableStepEditor`（表格步骤编辑器）                          | \~290             |
| L406–L470      | 辅助（`diffLines`/`ERROR_LABEL`/`renderNodeOutput`）    | \~65              |
| L471–L495      | `MainTab`                                           | \~25              |
| **L495–L3848** | **`Inspector`** **主组件**                             | **\~3350（占 87%）** |

**症结**：`Inspector` 主组件里每个节点类型一个配置面板、每个字段一段内联 JSX，全部堆在一个组件函数里。字段之间几乎没有共享闭包耦合，本质是 `读 node.xxx 配置 → 渲染 → updateNode 回写` 的 props 传递。

### 1.3 接口实现风格不统一

| 接口                   | 当前实现风格                                                                   |
| -------------------- | ------------------------------------------------------------------------ |
| `StorageBackend`     | class（`LocalStorageBackend implements StorageBackend` 等）                 |
| `MemoryBackend`      | class（`SQLiteMemoryBackend implements MemoryBackend`）                    |
| `McpTransport`       | class（`StdioMcpTransport implements McpTransport` 等）                     |
| `Worker`             | 工厂函数 `fakeWorker()`（测试替身）+ class（`IsolatedWorker`、真实 provider）           |
| `CodeSandboxBackend` | 对象字面量（`rlimitBackend`/`bwrapBackend`/`sandboxExecBackend`/`noopBackend`） |

这是历史演进留下的轻微不一致，非 bug，但应在重构中收敛约定。

## 3. 目标

1. `Inspector.tsx` 主组件从 \~3350 行降到 \~300 行，字段按 `NodeKind` 拆成独立组件。
2. `engine.ts` 的 `runNode` 从 \~3160 行退化成 \~50 行的 `switch (node.kind)` 分发器，节点执行体搬进 `nodes/` 目录。
3. 收敛接口实现风格约定，不强行大改已有代码。
4. **全程行为不变**：产线执行结果、事件流、产物、成本计量、失败语义均不得改变。

## 4. 总体原则（红线）

1. **纯重构，不改功能**：任何一步都不得改变执行结果、事件流、产物、错误码语义。
2. **小步原子提交**：每步一个 commit（沿用 `<type>(scope):` 英文规范），每步跑绿再进下一步。
3. **测试是唯一验收**：不靠「看起来对」，靠 server 671+ / web 1460 / core 164 / mcp 50 全绿 + 真实跑一条产线。

## 5. 阶段方案

### 阶段 0 —— 前置条件

1. CI 绿、相关 PR 合并（重构不得叠在红着的主线上）。
2. 锁定测试基线：`core 164` / `server 671+` / `web 1460` / `mcp 50`。

### 阶段 1 —— 拆 `Inspector.tsx`（低风险，先做）

**做法**：按 `NodeKind` 把字段抽成独立组件 + 注册表分发。

**目标目录结构**：

```
apps/web/src/components/Inspector/
├── Inspector.tsx          # 只剩外壳：tab 切换、运行时展示、保存态（~300 行）
├── registry.ts            # kind → 字段组件的注册表
└── fields/
    ├── TextGenFields.tsx
    ├── ImageGenFields.tsx
    ├── VideoGenFields.tsx
    ├── AudioGenFields.tsx
    ├── GateFields.tsx
    ├── ComplianceFields.tsx
    ├── HttpFields.tsx
    ├── CodeFields.tsx
    ├── BranchFields.tsx
    ├── MapFields.tsx
    ├── LoopFields.tsx
    ├── ParallelFields.tsx
    ├── TableFields.tsx       # 含 TableStepEditor 一起搬
    ├── DatabaseFields.tsx
    ├── FileParseFields.tsx
    ├── TranslateFields.tsx
    ├── OcrFields.tsx
    ├── ConvertFields.tsx
    ├── SearchFields.tsx
    ├── NotifyFields.tsx
    ├── VcsFields.tsx
    ├── HumanFields.tsx
    ├── SubprocessFields.tsx
    ├── FanoutFields.tsx
    ├── SelectFields.tsx
    ├── PublishFields.tsx
    ├── GenericFields.tsx
    ├── SourceFields.tsx
    └── shared.ts            # 共用的 Field/Select/Input 包装，消除内联重复
```

**字段组件契约**：

```ts
interface FieldProps {
  node: GraphNode;
  updateNode: (patch: Partial<GraphNode>) => void;
  t: TFunction;              // i18n
}
export function VcsFields({ node, updateNode, t }: FieldProps) { ... }
```

**为什么风险低**：字段组件之间几乎无共享闭包耦合，本质是 `配置 → 渲染 → 回写` 的 props 传递，每个文件 100–200 行、互不影响。

**验收**：web 1460 全绿（尤其 `Inspector.test.tsx`）+ 手动过一遍每种节点的 Inspector 面板。

### 阶段 2 —— 拆 `engine.ts` 的 `runNode`（高风险，两步走）

唯一动核心执行引擎的地方。**必须拆成两步，每步独立提交、独立回归。**

#### 2.1 收敛样板（机械提取，不改逻辑）

把 `runNode` 里每个 `if (node.kind === "xxx")` 分支**提取成独立的** **`async function runXxxNode(...)`** **私有函数**（先留在 `engine.ts`，或抽到同目录 `engine-nodes.ts`）。这一步是**纯机械搬移，零逻辑改动**，测试完全兜底。

#### 2.2 抽出共享上下文，搬到独立文件

上一步暴露的核心难点是 `runNode` 闭包了十几个共享状态。这一步定义显式的执行上下文接口，把闭包状态显式化：

```ts
// engine 内定义，节点执行体统一接收
export interface NodeRunContext {
  node: GraphNode;
  nodeId: string;
  attempt: number;
  graph: Graph;
  // 共享状态（原闭包变量）
  states: Map<string, NodeState>;
  artifacts: Map<string, Artifact[]>;
  // 共享操作（原闭包函数）
  emit: (ev: RunEvent) => void;
  inputFor: (node: GraphNode) => Promise<string>;
  sendPackets: (nodeId: string, summary: string, kind: string) => void;
  schedule: (nodeId: string) => void;
  // 依赖注入（从 ExecuteOptions 来）
  worker: Worker;
  readArtifact: (uri: string) => Promise<Buffer | null>;
  storeBinary: /* … */;
  loadProducts: /* … */;
  loadSubgraph: /* … */;
}
```

**目标目录结构**：

```
packages/server/src/nodes/
├── types.ts          # NodeRunContext 等共享类型
├── source.ts  ├── textgen.ts  ├── imagegen.ts  ├── videogen.ts  ├── audiogen.ts
├── gate.ts    ├── http.ts     ├── code.ts      ├── branch.ts    ├── map.ts
├── loop.ts    ├── parallel.ts ├── table.ts     ├── database.ts  ├── fileparse.ts
├── translate.ts ├── ocr.ts    ├── convert.ts   ├── search.ts    ├── notify.ts
├── vcs.ts     ├── human.ts    ├── subprocess.ts ├── compliance.ts
├── fanout.ts  ├── select.ts   ├── publish.ts   ├── generic.ts
```

之后 `runNode` 退化为：

```ts
for (const node of ready) {
  const handler = NODE_HANDLERS[node.kind];
  if (handler) await handler(ctx(node));
  // 否则 fallback 到 generic 或报错
}
```

**为什么风险高、为什么仍值得**：改的是核心执行引擎，但有 671 个 server 测试（含 9 波狗粮修出的静默失败、fan-in、error 边等回归）做安全网。两步走 + 每步全绿，风险可控。

**验收**：server 747/747 全绿 + `test:regression` **18/18 复跑通过**（2026-09-04 重构完成后）——rlimit code 沙箱端到端模板执行（evidence-brief / expense-review / reconciliation / recipe split→table→gate 均真实跑通）+ error 边 + resume + 静态加密。行为不变验收达成。

### 阶段 3 —— 统一接口实现风格（顺手，可延后）

收敛约定而非大改代码：

- **有状态、多实例的** → class（`implements`）。`StorageBackend`/`MemoryBackend`/`McpTransport` 已符合，保持。

- **无状态、单例的** → 对象字面量。`CodeSandboxBackend` 的 4 个 backend 符合，保持。

- **需要测试替身 + 真实实现的** → 工厂函数（替身）+ class（真实现）并存。`Worker` 符合，保持。

**结论**：现有风格其实各有其合理场景，本阶段主要产出是**把「何时用 class、何时用对象字面量」的约定写进** **`CONTRIBUTING.md`** **或** **`extending.md`**，不强行重构已有代码。

## 6. 风险与缓解

| 风险                                   | 缓解                                                     |
| ------------------------------------ | ------------------------------------------------------ |
| 阶段 2 改动核心引擎，可能引入静默行为变化               | 两步走 + 671 个测试兜底 + 真实跑产线；狗粮修过的静默失败/空补全/error 边语义在测试里有覆盖 |
| 巨型 diff 难以 review                    | 每步原子提交，单步只做「提取」或「搬移」一件事                                |
| `NodeRunContext` 字段漏传导致运行时 undefined | 用 TS 强类型 + 编译期检查；迁移时保持原函数签名，逐个搬                        |
| 与并行会话的改动冲突                           | 阶段 1（Inspector）与阶段 2（engine）文件不同，尽量不同时动同一文件            |

## 7. 实施顺序

```
阶段 0 收口（CI 绿 + 基线锁定）
  → 阶段 1 拆 Inspector（低风险，立范本）✅
  → 阶段 2.1 收敛 runNode 样板（机械提取）✅
  → 阶段 2.2 抽 NodeRunContext 搬节点文件 ✅
  → 回归实跑验证（重构后行为不变的验收，见 §验收）✅
  → 阶段 3 定风格约定（文档，可延后）——暂不推进
```

> **阶段 3 暂不推进**：纯文档「风格约定」项，不产功能、不可测、价值低；真正的重构风险在「静默行为变化」，已由回归实跑验证覆盖。何时值得回头：后续大量新增节点类型、多人协作风格失控时，再把约定落进 `AGENTS.md`（而非独立文档）。

## 8. 非目标（明确不做）

- 不重写引擎的调度算法、事件模型、成本计量。

- 不改任何节点类型的行为语义。

- 不引入新的依赖、框架或构建工具。

- 不做「拆分后立即合并超大重构」——严格按阶段原子提交。

<br />
