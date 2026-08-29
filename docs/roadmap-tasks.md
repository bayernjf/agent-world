# Agent World 任务路线图

> ⚠️ **历史文档**：阶段 1-5 的旧任务清单，已被 [PRD.md](../PRD.md)（产品阶段）与 [roadmap-generalization.md](roadmap-generalization.md)（当前主线，通用化）取代。保留供追溯，新任务一律挂在现行路线图下。

> 本文档把 PRD 中每个阶段拆解为可执行的具体任务。
> 产品愿景见 [product-vision-discussion.md](product-vision-discussion.md)。
> 技术方案见 [technical-design.md](technical-design.md)。

每个任务标注：优先级（P0 必须 / P1 应该 / P2 可以）、预估、依赖、退出条件。
阶段 1 的任务是当前焦点，后续阶段保持粗粒度，会随阶段 1 的结果调整。

---

## 阶段 1：真能干活

**目标：** 从沙盘变成工具。用真实模型跑通一条对自己有用的产线，失败时能看懂为什么。

### 1.1 真实 Provider Worker

**P0 — 这是把沙盘变成产品的那一刀**

- [x] **1.1.1 定义 provider 配置模型**
  - 新建 `packages/server/src/config.ts`
  - 定义 `ProviderConfig` 类型：`{ providers: Record<string, { apiKey: string; baseUrl?: string }>; defaultModel: string }`
  - 配置文件路径：`~/.agent-world/config.json`
  - 读写函数：`loadConfig()` / `saveConfig()`
  - 文件权限确保 600
  - 退出条件：能从配置文件读写 provider key，不进仓库

- [x] **1.1.2 扩展 Worker 接口支持工具调用**
  - 修改 `packages/server/src/worker.ts`
  - `runAgent` 的 yield 类型从 `string` 变为 `AgentStreamChunk`（discriminated union: text-delta | tool-call | tool-result）
  - 返回类型从 `{ output: string; usage }` 变为 `{ output: string; artifacts?; usage }`
  - `Usage` 加可选 `cachedTokens?: number`
  - 假 worker 同步更新，保持离线确定性（不产生 tool-call，只 yield text-delta）
  - 退出条件：`pnpm -r test` 全绿，假 worker 行为不变，引擎消费新 chunk 类型

- [x] **1.1.3 引擎适配新 Worker 接口**
  - 修改 `packages/server/src/engine.ts` 的 agent 执行循环
  - 消费 `AgentStreamChunk`：text-delta 转 `node.delta`，tool-call 执行工具并回传
  - 阶段 1 工具执行：先做内置工具注册表，无工具时 tool-call 循环不会触发
  - `node.finished` 事件的 output 从 result.output 取
  - 退出条件：假 worker 下完整循环仍跑通，真实 worker 下流式文本正常显示

- [ ] **1.1.4 实现 Anthropic provider worker**
  - 新建 `packages/server/src/providers/anthropic.ts`
  - 实现 `Worker` 接口，调 Anthropic Messages API
  - 流式解析 SSE 响应为 `AgentStreamChunk`
  - 从 response usage 填充 token 计数和成本
  - 成本计算：按 model 的 input/output 单价，区分 cached tokens
  - 模型列表：至少支持 claude-sonnet 和 claude-opus
  - 退出条件：用真实 key 跑通"输入文本→模型输出→显示"，成本正确

- [x] **1.1.5 实现 OpenAI 兼容 provider worker（可选但推荐）**
  - 新建 `packages/server/src/providers/openai-compatible.ts`
  - 支持 OpenAI、火山方舟、任何 OpenAI 兼容端点
  - baseUrl 和 model 可配置
  - 退出条件：至少能接一个非 Anthropic 的模型

- [x] **1.1.6 Worker 注册与选择**
  - 新建 `packages/server/src/providers/index.ts`
  - 根据 agent config 的 model 字段路由到对应 provider
  - model 名前缀判断：`claude-*` → anthropic，`gpt-*` → openai，其他用配置的 default provider
  - fake worker 保留，通过环境变量 `WORKER=fake` 或设置项切换
  - 退出条件：graph 里 agent 的 model 字段决定用哪个 worker

**依赖：** 1.1.1 → 1.1.2 → 1.1.3 → 1.1.4 → 1.1.6，1.1.5 可并行

### 1.2 失败处理与重试

**P0 — 跑真实模型必然遇到失败**

- [x] **1.2.1 错误分类**
  - 定义 `ErrorCode` 类型：`TIMEOUT | RATE_LIMIT | PROVIDER_ERROR | AUTH | VALIDATION | UNKNOWN`
  - Worker 实现把 provider 错误映射到这些码
  - `node.failed` 事件加可选 `errorCode?: ErrorCode`
  - 退出条件：不同错误类型在事件里可区分

- [x] **1.2.2 节点级重试策略**
  - `AgentConfig` 加 `retryPolicy?: { maxRetries: number; baseDelayMs: number; retryOn: ErrorCode[] }`
  - 默认：maxRetries=2，baseDelayMs=1000，retryOn=[TIMEOUT, RATE_LIMIT, PROVIDER_ERROR]
  - 引擎在 agent 执行失败后按策略重试（指数退避）
  - 重试不增加 attempt 计数——attempt 是质检驳回，重试是技术故障
  - 退出条件：模拟 429 时自动重试，第三次才真正 failed

- [x] **1.2.3 超时控制**
  - `AgentConfig` 加 `timeoutMs?: number`（默认 120000）
  - 用 `AbortController` 实现超时
  - 超时产生 TIMEOUT 错误码
  - 退出条件：一个挂起的请求在超时后被正确取消

- [x] **1.2.4 结构化失败面板（前端）**
  - 失败时不只是顶部红横幅
  - Inspector 选中失败节点时显示：错误码、错误信息、是否可重试、重试按钮
  - 退出条件：失败节点上能看到原因并手动重试

**依赖：** 1.2.1 → 1.2.2 → 1.2.3，1.2.4 可并行

### 1.3 质检标准生效

**P0**

- [x] **1.3.1 Inspector 加 criterion 字段**
  - `apps/web/src/components/Inspector.tsx`
  - Gate 选中时显示 criterion 文本框（多行）
  - 绑定到 `gate.criterion`，编辑进 graph store
  - 退出条件：能在 UI 里编辑质检标准

- [x] **1.3.2 真实 judge 读 criterion**
  - 修改真实 provider worker 的 `judge()` 方法
  - 把 `gate.criterion` 注入 judge prompt
  - 返回 `{ passed, reason }`，reason 说明为什么过/不过
  - 假 worker 的 judge 也改为读 criterion（确定性逻辑：criterion 非空且 attempt 够数就过）
  - 退出条件：改 criterion 能影响真实模型的判定结果

**依赖：** 1.1.4（真实 worker 存在）

### 1.4 Prompt 编辑持久化

**P0**

- [x] **1.4.1 自动保存 prompt**
  - 修改 `apps/web/src/components/Inspector.tsx` 和 `stores/graph.ts`
  - prompt 编辑 debounce 500ms 后自动 `PUT /api/graphs/:id`
  - 不依赖 dispatch 触发
  - 保存状态指示："已保存" / "保存中…"
  - 退出条件：编辑 prompt 后直接刷新页面，内容不丢

**依赖：** 无

### 1.5 Halt 恢复

**P0**

- [x] **1.5.1 后端 resume 命令**
  - 新建 `POST /api/runs/:id/resume`
  - 参数：`{ action: "continue" | "scrap", nodeId?: string }`
  - 引擎支持从 halted 状态恢复：continue 从 halt 节点继续，scrap 终止运行
  - 实现方式：恢复时加载已有事件，从 halt 点之后继续 emit 新事件（seq 续接）
  - 退出条件：halted 运行能通过 API 恢复并跑完

- [x] **1.5.2 前端恢复 UI**
  - 运行 halted 时控制面板显示"继续"和"报废"按钮
  - Inspector 选中 halt 节点时显示 halt 原因（gate.exhausted 的 reason）
  - 退出条件：halt 后点继续，产线接着跑

**依赖：** 无（可以用假 worker 先测）

### 1.6 API Key 配置界面

**P1**

- [x] **1.6.1 设置面板**
  - 新建设置组件（模态框或侧边面板）
  - 列出已配置 provider，key 显示为 `sk-...****`
  - 添加/编辑/删除 key
  - 模型选择下拉（从已配置 provider 拉取可用模型列表）
  - 退出条件：不手编辑配置文件就能在 UI 配 key

**依赖：** 1.1.1

### 1.7 加固收尾（几行的小修补）

**P0**

- [x] **SSE 心跳。** `/api/runs/:id/stream` 循环里每秒写一行 `: ping` 注释帧，防止 nginx/Cloudflare 在长节点执行期间掐断空闲连接
- [x] **错误脱敏。** `node.failed` 的 error 文本落库前截断（≤500 字符）并过滤 `authorization`/`api_key`/`sk-...` 模式，防止 provider 报错回显泄漏密钥
- [x] **取消成本提示。** UI 上取消运行时提示"已产生的 token 仍会计费"，取消只停止后续工作

### 1.8 阶段 1 退出验证

**P0**

- [ ] **1.7.1 跑通真实产线**
  - 搭一条"写草稿 → 批评 → 改写 → 输出"产线
  - 用真实模型跑，质检标准设为有意义的内容要求
  - 验证：草稿不合格被打回、改写后通过、成本正确、回放正常
  - 退出条件：自己愿意每天用它跑真实任务

- [x] **1.7.2 测试与类型检查**
  - `pnpm -r test` 全绿（根据接口变化更新现有测试）
  - `pnpm -r typecheck` 全绿
  - 新增测试：重试逻辑、错误分类、halt 恢复
  - 退出条件：测试覆盖新增的关键路径

- [x] **1.7.3 更新文档**

**阶段 1 额外完成（验证中发现并补齐）：**
- [x] **返工原因回喂。** 质检驳回时把 `verdict.reason` 记到返工入口节点，下次执行时拼到输入末尾 `[质检站退回原因] ...`，读完即清。已验证：缺关键信息被驳回后，二稿补全并通过。
- [x] **派发时输入真实原料。** `POST /api/runs` 接受 `input`，source 节点作为产出；控制面板加「原料」文本域；空则回退占位符。
- [x] **token/电费双模式电表。** 未配置单价时强制显示 token（入/出/缓存），配置后可切电费与预算；设置面板可填每模型单价。

> Anthropic 专属 worker（1.1.4）未单独实现——Agnes/豆包/OpenAI 等全部走一个 OpenAI 兼容 worker，等有 Anthropic 直连 key 时再补。

### 1.9 画布工作区打磨（已完成）

目标：让画布本身好用到愿意每天打开，而不是只够演示。全部 2026-08-25 完成。

- [x] **视口导航。** 滚轮以光标为锚点缩放（0.3×–3×）；选择模式/中键/空格拖拽平移；方向键平移（Shift 加速）；运行开始自动复位。
- [x] **缩略图。** 左下角鸟瞰图，可拖拽定位视口；+/−/百分比控件左下角，"适应"按钮右下角（统一 20px 按钮高度）；`F` 键缩放居中到选中厂房。
- [x] **撤销重做。** zundo 驱动，左上角按钮；按 graph 引用比较跳过自动保存产生的空历史条目（修掉"拆管道要点两次撤销"）。
- [x] **删除与撤回 toast。** 拆除厂房/管道后弹 toast 带撤销动作；Delete/Backspace 删除选中管道；自定义确认弹窗替代原生 confirm。
- [x] **侧栏收起。** 左控制面板、右检查器可独立收起，也可一键全收；CSS grid 显式指定 track 防止 stage 挤进 0px。
- [x] **管道几何。** `edgeAnchors()` 在厂房左右面上按出入度垂直分散锚点（`PIN_GAP=14`），并行管道不再叠在同一引脚；正向管走正交圆角折线，返工管从顶部弧回。
- [x] **跨线桥。** `pipeCrossings()` 检测竖管与横管交叉，竖管画弧形桥跨过横管（电路图风格），无需完整自动路由器即可消除交叉歧义。
- [x] **方向箭头。** 正向管末段加流向三角；返工管不加（弧线本身即回退语义）。
- [x] **流向高亮。** hover 或点击管道高亮整条上下游流向（传递追踪），其余管道降透明度；点击锁定，点空白解除。
- [x] **厂房名牌。** hover 厂房弹出固定屏幕尺寸的名牌（反缩放 `1/(zoom*fit.scale)`），显示名称、类型、模型、状态、返工、Token、电费；移除浏览器原生 title 避免重复弹窗。
- [x] **网格吸附。** 节点移动/新增吸附 20px 网格，同行厂房自动对齐、水平管道笔直。
- [x] **复制粘贴。** ⌘/Ctrl+C 复制选中厂房，⌘/Ctrl+V 粘贴副本（偏移 30px、网格吸附、"原名 副本"、连续粘贴阶梯错位）；输入框内不受影响。
- [x] **连接校验。** 自环和重复连线弹 toast 提示，不再静默失败。
- [x] **快捷键说明。** HUD 右上角"快捷键 ?"按钮，hover 弹出画布/编辑/工具/其他四组快捷键。
- [x] **管道拖拽。** 评估结论：管道是节点间的几何派生，拖拽管道本身没有明确语义（改路由应靠移动节点），暂不做。

**延后（独立大模块）：** 完整正交自动路由器（障碍物避让、环路、端口分配、卡车路径稳定性）。当前的锚点分散 + 跨线桥已解决重叠和交叉歧义，等图变密再做。

---

## 阶段 2：产线表达力

**目标：** 能表达真实工作流，而不只是一条直线。

### 2.1 并行分支

- [x] 编译器输出 `levels[][]`（最长路径分层，同层节点互不依赖）；`order[]` 保留兼容
- [x] 引擎改为数据流 ready-set 并发调度（所有上游完成即启动），信号量限流（`MAX_CONCURRENCY=6`），execute/resume 共用同一调度器
- [x] 多入边汇合：节点等齐所有 flow 上游 done 后才启动（barrier）
- [x] `inputFor()` 多输入合并（按边拼接，时序由 barrier 保证）
- [x] **事件串行化：** 单一 `EventQueue` + 同步 `emit()` 分配 seq，并发节点的事件经队列有序输出，seq 单调无乱序
- [x] **预算竞态：** 成本累加与 total/节点预算检查在节点完成的同步块内完成
- [x] **节点失败隔离：** 单节点失败（如节点预算超限）只阻断其下游，不影响无关分支继续执行；整线状态为 failed
- [x] Canvas 多辆卡车同时跑（PacketLayer 以 `edgeId:seq` 为 key，天然支持并发）
- [x] **上下文窗口策略：** `AgentConfig.inputPolicy` 支持 `all`（默认全拼接）/`last`（只取最近上游）/`truncate`（按 maxChars 截断保留尾部），Inspector 可选；长产线/并行汇合不再无限拼接
- [ ] 滚动摘要（truncate 是硬截断；后续可加 LLM 摘要节点或"只取最近产出"的语义优化）
- [x] 退出条件：互不依赖的厂房同时焊接（测试断言 maxConcurrent≥2）、barrier 汇合、事件 seq 无乱序、节点预算不拖垮其他分支；整线预算/abort 仍全局跳闸

### 2.2 技能卡 UI

- [x] 定义 Skill 类型：`{ id, name, description, kind, permissions }`，其中 `permissions` 字段现在就定下来（网络域名/文件路径/子进程/env），即使阶段 2 不强制执行，避免技能卡格式返工
- [x] 内置工具注册表（`web_fetch` HTTPS 抓取、`json_extract` 路径提取、`current_time`）
- [x] Inspector 里 agent 节点显示"装备技能卡"区域（`SkillPicker` 组件）
- [x] 技能卡勾选装备（点击切换 on/off）
- [x] 装备技能卡时展示权限提示（网络/文件/子进程/环境变量徽章）
- [x] `agent.skills` 从 `string[]` 升级为 `SkillMount[]`（zod transform 向后兼容旧 string 数组）
- [x] Prompt 模块卡：装备后自动拼接到 system prompt（E.2 已实现）
- [x] 输出契约卡：装备后要求模型输出符合 schema，不合格触发返工（E.3 已实现）
- [x] 工具调用全审计：`tool.called`/`tool.result` 进事件流，Inspector 可见调了什么、传了什么、返回了什么；runtime reducer 跟踪 toolCalls
- [x] `ToolContext` 注入：worker 通过 `executeTool` 回调执行工具，不直接拿 `fetch`；引擎解析已装备技能并传入工具定义
- [x] 危险操作（写文件、发网络、删除）首次调用 halt 等人工确认，复用阶段 1 的 halt/resume（E.4 已实现）
- [x] 退出条件：给 agent 装备一张工具卡，运行时模型能调用它，且每次调用在事件流里可查

### 2.3 多产线管理

- [x] 产线列表：HUD 产线切换器显示所有 graphs（`GET /api/graphs`）
- [x] 新建产线：空白创建（`POST /api/graphs`）
- [x] 复制产线：服务端深拷贝 nodes/edges，新 id
- [x] 重命名、删除：切换器内双击重命名、删除走自定义二次确认弹窗
- [x] 产线切换不丢失编辑状态：切换前 `flushSave()` 落盘，并清空 undo 历史
- [ ] 从模板创建（归入 2.4）
- [x] 退出条件：workspace 里能管理多条产线

### 2.4 产线模板

- [x] 定义模板格式：`GraphTemplate`（core/templates.ts），预置 graph + 名称/描述/分类
- [x] `instantiateTemplate()` 生成全新 id 的 graph，模板可反复实例化不冲突
- [x] 新建产线时从模板选择（`GET /api/templates` + 新建产线弹窗）
- [x] 第一个重点模板：商品详情页（原料台→卖点提炼→文案撰写→排版整理→质检站→成品库，含返工环）
- [x] 原料台支持参考图片 URL，视觉模型可看图（source.images → 引擎透传 → OpenAI image_url content part）
- [x] 内置更多模板（写草稿、翻译流水线、文档审查；共 4 个实用模板 + 空白）
- [ ] 模板预览图
- [x] 退出条件：选模板后一键生成可运行的产线

### 2.5 节点级预算

- [x] `AgentConfig` 加 `budgetUsd?: number`（nullable）
- [x] 引擎在节点跨 attempt 累计成本超限时停该节点（`node.failed` + `BUDGET`），整条线标记 failed
- [x] 前端节点上显示该节点预算（左下角 chip，超限时变红），Inspector 可编辑，hover 名牌显示 已花/预算
- [x] resume 路径从历史事件重建每节点成本，预算检查同样生效
- [x] Delete/Backspace 删除选中厂房（之前只删管道）
- [x] 退出条件：单个厂房超预算不影响其他厂房（2.1 并发调度后，失败节点只阻断其下游，无关分支继续运行）

---

## 阶段 3：可信运行

**目标：** 跑长任务不心慌。出问题能定位，花了多少钱能对账。

### 3.1 运行历史

- [x] 运行历史列表页（按时间倒序；分页/筛选待补）
- [x] 运行详情：回放任何历史运行（双击行或点"回放"，加载图+事件流）
- [ ] 运行对比：选两次运行对比结果和成本
- [x] 删除运行记录（进行中的运行禁止删除，409）
- [x] 回放态「退出回放」按钮（Timeline，view=replay 时显示，reset 回当前产线）
- [x] 退出条件：能找到上周跑的任何一次运行并回放

### 3.2 成本报表

- [x] 按产线聚合成本：总花费、运行次数、每日趋势图
- [x] 按节点聚合：哪个厂房最费钱（Top 50，含返工次数）
- [x] 按 attempt 聚合：返工花了多少冤枉钱（attempt>1 汇总）
- [x] 按时间聚合：每日成本（近 7 天/30 天/全部范围切换）
- [x] token 用量细分：input/output/cached
- [x] 导出 CSV（`GET /api/costs.csv`，按当前范围导出 graph/node/day 三段）
- [x] 节点名解析：从最近一次运行的 snapshot 取厂房名，产线已删/节点已改名仍准确
- [x] 退出条件：回答"钱花在哪了"一目了然
- 待补：周/月聚合视图、平均每次成本、运行对比

### 3.3 断线重连

- [x] 前端 SSE 断开后指数退避自动重连（`store/run.ts`，上限 10s）
- [x] 重连时带 `Last-Event-ID` header，从上次 seq 续传（服务端同时支持 `?after=` 与 `Last-Event-ID`，`?after=` 优先）
- [x] 重连中 UI 显示"重连中…"状态（初次连接显示"连接中…"，二者区分）
- [x] 服务端 SSE 已支持从 seq 续传，边界已修：重连回调读取最新 seq 而非错误时刻的陈旧快照；`resumeRun` 先关旧流再开新流，避免重复折叠
- [x] SSE 心跳：每 15s 发 `: ping` 注释帧，代理不回收空闲连接
- [x] 退出条件：断网恢复后从最后 seq 续传，事件不丢不重
- 待真实长任务/代理环境做一次端到端抽网验证

### 3.4 结构化失败面板

- [x] 失败面板取代顶部红横幅（`FailurePanel`，运行失败/跳闸时浮于画布顶部）
- [x] 显示：失败节点、错误码（中文化徽章）、错误信息、发生时间、第几次尝试、影响（下游未启动厂房数）
- [x] 一键操作：重试该节点（resetFrom）、返工到上游（选上游已完成节点重跑）、整条重跑
- [x] 失败历史：`RuntimeState.failures` 追加记录 node/gate/budget 三类失败，重跑后保留
- [x] 退出条件：失败后知道该点哪、做什么
- 修复：resume 不再重发 `run.started`，避免续跑时把已折叠的运行时状态（含失败历史、累计电费）清空
- 待补：真正的"报废整条线"对已终止失败 run 的语义（目前用 reset/关闭面板 + 整条重跑覆盖）

### 3.5 数据库与并发加固

- [x] **schema_migrations 表 + 有序迁移**（`db.ts`），取代 try/catch ADD COLUMN：每个迁移带 version/description/up，在事务里按序执行并记录；旧库首次打开做 baseline 检测（已存在的列标记为已应用，不重复 ALTER）。新增迁移只需在 MIGRATIONS 末尾追加。
- [x] **启动备份**：SQLite VACUUM INTO 到带时间戳的备份文件（`backups/pre-migration-<ts>.db`，保留最近 5 份，失败不阻塞启动）
- [x] **事件接口分页**：`GET /api/runs/:id/events?after=<seq>&limit=<n>` 返回窗口 + `nextCursor`，无参仍返回全量 + state；SSE 增量不变
- [x] **多标签页乐观锁**：graphs 加 `version`（迁移 8），PUT 带 `If-Match`，冲突返回 409，前端提示重新载入而非静默覆盖
- [x] **结构化日志**：内置 JSON-line logger（`logger.ts`），每条带 ts/level/msg/runId 等绑定，支持 `LOG_LEVEL`、`LOG_FILE` 按大小轮转（默认 5MB，保留 3 份），无需外部依赖

### 3.6 成本预警

- [x] 预算到 80% 时发 `power.warning` 事件（不停线，一次运行只触发一次）
- [x] 前端显示警告状态（电表变黄 is-warn，下方提示已达预算百分比）
- [x] 月度预算：设置中配置软上限，`db.costForMonth()` 聚合当月花费，运行中跨 run 累计到 80%/100% 发 `power.warning`（scope=monthly，仅警告不跳闸）
- [x] 退出条件：快超预算时能被提醒
- 说明：100% 仍由 `power.tripped` 硬跳闸；80% 为建议性警告，颜色提示。`RuntimeState.budgetWarned` 记录是否已警告，reducer 处理。

### 3.7 评估体系雏形

- [x] 聚合统计：合格率、平均返工次数、平均耗时（`db.evalReport`）
- [x] 按产线/时间维度（byGraph、byDay 每日合格率趋势）；节点维度由成本报表的厂房表覆盖
- [x] Prompt 改动前后对比：按 run snapshot 里 agent 的 (model+prompt) 指纹分组，每产线标注 v1/v2…，对比合格率/返工/耗时
- [x] 前端「评估」弹窗：合格率卡片、每日趋势条形图、按产线表、Prompt 版本对比表
- [x] 退出条件：改了 prompt 后能看到合格率变化趋势（按天趋势 + 版本对比）

### 3.8 Packet/Artifact 分层

- [x] 定义 Artifact 类型（core/artifact.ts：text/image/video/audio/file/json/uri）
- [x] 文本 artifact 内联兼容现有 output（output 字段不变，artifacts 为附加）
- [x] extractArtifacts() 从输出文本中提取 markdown 图片、裸 URL、JSON 代码块
- [x] 新增 artifact.produced 事件，runtime state 按节点收集 artifacts
- [x] Packet 携带 artifactKind，卡车按产出物类型变色
- [x] 前端 Inspector 展示产出物（图片缩略图、视频、音频播放器、链接、JSON）
- [x] Source 节点的 reference images 作为 image artifacts 发出
- [x] 退出条件：产线能产出图片等非文本内容并在 UI 中展示
- [x] 文件 artifact 存本地磁盘：`ArtifactStore` 将内联内容写入 `artifacts/<shard>/<runId>/<id>`，远程/data URI 直链不抓取；新增 `artifacts` 表（迁移 9）存元数据
- [x] 引擎 artifacts Map 从 string 升级为 ArtifactRef（当前仍按 node 存文本 output，artifact 事件为附加层）
- [x] 跨 run 产出物查询与成品库：`GET /api/artifacts`（最新优先分页）、`GET /api/runs/:id/artifacts`、`GET /api/artifacts/:id`（本地文件流式返回/远程 302），前端「成品」画廊按类型筛选、分页加载

---

## 阶段 4：开源准备

**目标：** 陌生人能 clone 下来跑起来，并能加自己的 worker。

### 4.1 Worker 插件化

- [x] 约定 `workers/` 目录，放实现 Worker 接口的文件
- [x] 启动时动态扫描和加载
- [x] Worker 元数据声明：支持哪些 model、需要哪些配置
- [ ] **插件进程隔离：** 第三方 worker/connector 在子进程（`child_process.fork` / `worker_threads`）中运行，只通过消息传递通信；主进程裁剪传入 env（只传声明需要的 key），文件/网络访问走主进程代理（见 4C.7 待办）
- [ ] 插件权限清单：加载时展示插件声明的 permissions，用户确认后才启用（见 4C.7 待办）
- [ ] macOS `sandbox-exec` / Linux seccomp 约束（可选增强）
- [x] 文档：如何写一个自定义 worker
- [x] 退出条件：不改核心代码，放一个文件就能加新 model 支持；第三方插件即使作恶也读不到未授权的 key 和文件

### 4.2 Connector

- [x] 定义 Connector 接口（core `ConnectorConfig` + server `resolveConnector`）
- [x] 实现文件 connector：读目录/CSV/JSON 文件作为原料（支持单文件/目录/glob，asImages，encoding）
- [x] 实现 HTTP API connector：GET/POST 拉数据（headers/auth basic+bearer/extract 字段提取/body）
- [x] Source 节点 UI：选择 connector、配置参数、测试连接（ConnectorEditor + POST /api/connectors/test 预览）
- [x] form connector：运行前填表，答案作为 source 文本注入
- [x] 退出条件：产线能从外部数据源自动拉原料

### 4.3 MCP 支持

- [x] 实现 MCP client
- [x] 连接 MCP server，发现其工具列表
- [x] MCP 工具自动成为可装备的技能卡
- [x] 退出条件：接一个 MCP server，它的工具能在产线里被调用

### 4.4 Artifact 存储抽象

- [x] 定义 StorageBackend 接口
- [x] 本地文件系统实现
- [x] S3 兼容存储实现（MinIO/AWS S3/OSS）
- [x] 退出条件：配置一行就能切换本地和 S3 存储

### 4.5 多模态

- [x] Worker 接口 input 从 string 扩展为支持 content parts（文本+图片）
- [x] Source 节点支持图片输入
- [x] Canvas 上图片类原料有视觉区分
- [x] 退出条件：商品图片能作为原料进入产线

#### 4.5 详细
- 类型 `ContentPart`（core `multimodal.ts`）：`{type:"text",text} | {type:"image",image}`，image 为 URL 或 data URI。
- `Worker.runAgent` 入参新增 `content?: ContentPart[]`。引擎在调用处自动把 `input` + 上游 source 的 `source.images` 组装成 `content`（文本段 + 图片段），同时保留 `input`/`images` 旧字段以兼容老 worker。
- Provider（`openai-compatible.ts`）优先使用 `content` 组装消息体；`buildUserContent` 将图片段映射为 `image_url`，回退到 `input`+`images` 快捷方式。已有 provider 侧的多模态（图片进模型）因此统一为 content parts 表达。
- 前端（`apps/web`）：Inspector 中 `SourceImages` 已支持编辑/缩略图；Canvas 节点对带图片原料的 source 增加蓝色「图 N」徽标，hover tooltip 显示「图片原料 N 张」。
- 测试：`engine.multimodal.test.ts` 验证 source 图片进入下游 agent 的 `content`；`providers/openai-compatible.test.ts` 验证 `buildUserContent` 三种路径。

### 4.6 触发方式

- [x] Webhook 触发：`POST /api/graphs/:id/webhook`（secret 验证，x-webhook-secret header 或 body）
- [x] 定时触发：cron 表达式配置，内置 TriggerScheduler（in-process timer，启动时从 graph.triggers 恢复）
- [x] 事件触发：一条产线完成后自动启动下游（onGraphFinished + onArtifact，eventSource 配置 graph/artifact）
- [x] 批量触发：上传 CSV/JSON，每条记录跑一次（fireBatch，并发控制，CSV 解析）
- [x] runs 表 trigger 字段标记来源（createRun 包含 trigger，listRuns 返回 trigger）
- [x] 触发管理 API：GET/POST/DELETE /api/graphs/:id/triggers，手动 fire，next-runs 预览
- [x] 前端 TriggersPanel：列表/编辑/删除/手动触发/下次运行时间/运行历史
- [x] 退出条件：不手动点派发也能自动跑

### 4.7 人机协作增强

- [x] 人工编辑：Agent 产出后人可修改再交下游
- [x] 审批节点：Gate 等人 approve/reject/edit
- [x] 通知：halt/审批时发通知（先做 webhook，企业版做飞书/钉钉）
- [x] 退出条件：人能在流程中间介入修改

#### 4.7 详细
- 引擎 `resume` 新增 `action`：`continue`/`approve`/`edit`/`reject`/`scrap`（continue 为 approve 的向后兼容别名）。`approve`/`edit` 让暂停的 Gate 判为通过并继续；`reject` 记录决策并以失败结束；`edit` 额外用编辑后的产物覆盖节点输出。
- 人工编辑产出：resume 入参 `editOutput: Record<nodeId,string>`，在继续前覆盖对应节点产物，下游直接以人工修正文本为输入（无需重跑模型）。
- 决策事件：复用 `gate.verdict`，新增可选字段 `decision: approved|rejected|edited` 与 `by`，让前端区分自动判定与人工决策。`run.finished` 新增 `haltedNodeId`/`reason`，`RuntimeState` 暴露 `haltedNodeId`。
- 通知（webhook 优先）：新增 `notify.ts`，运行因 Gate 耗尽而 halt 时向 `RUN_HALT_WEBHOOK` 发 POST（未配置则不发、失败不阻塞）。
- 前端：`ControlPanel` 在 halted 时提供「批准继续 / 编辑后继续 / 驳回 / 报废」；`api.resumeRun` 与 `store.resumeRun` 透传新动作与 `editOutput`；`RuntimeState.haltedNodeId` 供「编辑后继续」定位节点。
- 测试：`engine.humanloop.test.ts`（halt→approve/edit/reject 全流程）、`notify.test.ts`（webhook 发送/未配置/失败容错）。

### 4.8 文档与社区

- [x] 架构文档（technical-design.md 776 行，覆盖架构/数据模型/API 表面）
- [x] 扩展指南：写 worker、connector、skill、trigger、node type（docs/extending.md）
- [x] 贡献指南（CONTRIBUTING.md，含 commit 规范/编码约定/测试/PR 流程）
- [x] 示例产线集（docs/examples.md，8 个模板：改写循环/商品生成/多源聚合/视频广告/表单驱动/A/B 测试/定时报告/webhook 触发）
- [x] README 重写：5 分钟快速开始（含 provider 配置/跑第一条产线步骤/文档链接）
- [x] 首次启动引导（替代写死的 seed 图）— 全屏 Onboarding 组件，图列表为空时显示模板选择+空白开始，后端不再自动创建 seed 图
- [x] 退出条件：没读过文档的人 10 分钟跑起来

### 4.9 工程化

- [x] CI：GitHub Actions 跑 typecheck + test + build
- [x] 密钥泄漏检查（git-secrets 或类似）—— 接入 gitleaks 扫描（CI `secrets` job + `.gitleaks.toml`）
- [x] CORS 收紧到配置的 origin（替换现在允许所有来源），加基础安全响应头（`security.ts`：`CORS_ORIGINS` + X-Content-Type-Options / X-Frame-Options / Referrer-Policy / Permissions-Policy）
- [x] 结构化日志（内置 JSON-line logger，已在 3.5 完成）
- [x] LICENSE 选择 —— MIT（`LICENSE`，Copyright (c) 2026 bayernjf）
- [x] Docker Compose 部署配置（`Dockerfile` + `docker-compose.yml` + `.dockerignore`）
- [x] 版本号和 CHANGELOG（包版本 0.1.0 → 0.2.0，`CHANGELOG.md`）
- [x] 退出条件：clone → pnpm install → pnpm dev 顺畅

---

## 阶段 5：商业化

**方向记录，不细化。前四阶段产物会改变判断。**

### 5.1 企业版能力

- [ ] 多租户与数据隔离（tenant_id 行级隔离）
- [ ] RBAC 权限模型
- [ ] SSO/LDAP/SAML 集成
- [ ] 审计日志导出（SIEM 格式）
- [ ] 企业 Connector 套件（MySQL/PG/MongoDB/飞书/钉钉/Jira/SharePoint）
- [ ] 商业 SLA 支持

### 5.2 知识库（档案室）

- [ ] MemoryBackend 接口和 SQLite FTS 实现
- [ ] 事件流自动提取知识条目（驳回原因、成功案例、模式）
- [ ] 向量检索（sqlite-vec → pgvector → Milvus）
- [ ] 档案检索技能卡（agent 装备后查历史经验）
- [ ] 知识管理 UI：查看、编辑、删除、打标签

### 5.3 计费

- [ ] 真实计费与配额（事后计量是地基）
- [ ] 按用量计费 / 订阅套餐 / 企业定制
- [ ] 月度账单和用量预警
- [ ] 团队级预算

### 5.4 托管服务

- [ ] 云部署（K8s + Postgres + Redis + S3 + Milvus）
- [ ] 注册/登录/账号体系
- [ ] 团队协作与产线共享
- [ ] 高可用和水平扩展
- [ ] **运行时容器隔离：** SaaS 多租户场景，每次运行/每个租户放入容器（Docker/gVisor/Firecracker），只读根文件系统 + 临时可写层、网络只放通模型 API、CPU/内存配额；代码执行类技能可接 E2B/Daytona
- [ ] 密钥进 KMS/Vault，每租户独立 key，记录 key 使用审计

### 5.5 复盘与改进建议

- [ ] 自动生成产线复盘报告
- [ ] 改进建议（人决策，系统不自动改）
- [x] A/B 测试框架（同节点两个 prompt 版本对比）
- [x] 品牌词库（可管理词库 + 厂房节点一键载入 + gate 品牌词覆盖率门槛）
- [x] AI 生图节点（OpenAI 兼容 /images/generations，缺素材自动生 banner/场景图，支持 n 与节点级端点）
- [ ] 回归测试集

### 5.6 产线版本管理

- [ ] Graph 版本历史
- [ ] 草稿 vs 已发布
- [ ] 版本对比和回滚
- [ ] 运行引用具体版本（snapshot 机制已支持）

---

## 跨阶段技术债务与注意事项

### 持续关注

- **返工环表达力上限：** 嵌套返工、多质检站互斥返工。等真实工作流撞上来再改，不预先设计。
- **游戏化 vs 可用性：** 任何时候隐喻妨碍看清"产线在干什么"，改隐喻。20+ 节点时需要鸟瞰/车间双视图。
- **事件 schema 版本：** 任何不兼容改动 bump `EVENT_SCHEMA_VERSION`，写迁移。
- **测试速度：** 假 worker 保持毫秒级，集成测试单独标记不进 CI。
- **不加抽象层：** Connector/MemoryBackend/StorageBackend 等到有第二个实现时才提取接口，不提前写。

### 明确不做（随时参照）

- 对话型产品（客服聊天、语音助手）
- 通用低代码自动化（n8n 赛道）
- Agent 自动改自己的 prompt/产线
- 通用 ETL 引擎
- 自研框架跟 LangGraph 竞争
- 微服务（单体到证明需要拆）
- 技能树付费墙
- 阶段 1 上容器/VM 沙箱（本地单用户，过度工程）
- 自研 V8 isolate 沙箱（子进程足够）
- 信任 prompt 层安全承诺（"告诉模型别做坏事"不是沙箱）
- 对模型输出用 eval/new Function

---

## 阶段 6（建议）：内容线收尾 — 图片位置精确控制

> 目标：让排版节点产出的图片能精确控制**位置/尺寸/版式**，而不是只能 `![](url)` 内联。
> 对应 `docs/product-content-roadmap.md` 差距 #3（图片位置不可精确控制）。
> 当前 `ProductBlock` 的 `image` / `imageCards` 仅有 `url`（cards 含 `title`），无位置/尺寸语义。
> 依赖顺序：6.1 → 6.2 → 6.3 → 6.5 → 6.6；6.4 为可选 P1，可并行。

- [x] 6.1 `ProductBlock` schema 扩展（`packages/core/src/product.ts`）
  - [x] `image` 区块新增可选：`align`(left|right|center|full)、`width`(px 或 "N%")、`aspect`(1:1|3:4|4:3|16:9)、`rounded?`(bool)、`caption?`(string)
  - [x] `imageCards` 新增可选：`layout`(grid|carousel|row)、`columns?`(2|3)、每卡可选 `span?`(1|2)
  - [x] zod 向后兼容：旧 product-json（无这些字段）仍合法解析
  - [x] 退出标准：`parseProductDocument` 对带/不带新字段的文档都通过校验

- [x] 6.2 成品渲染（`apps/web/src/components/ProductBlocks.tsx` + `styles.css`）
  - [x] `image` 按 `align/width/aspect/rounded/caption` 用 design tokens 的 CSS 渲染，区分淘宝 vs 小红书版式
  - [x] `imageCards` 按 `layout` 走网格/轮播/横排；`carousel` 用原生 CSS scroll-snap（不引依赖）
  - [x] `aspect` 用 `aspect-ratio` 控制占位，避免图片加载抖动
  - [x] 退出标准：同一 product-json 在两种模板下渲染出可控位置/尺寸

- [x] 6.3 排版 agent prompt 注入位置语义
  - [x] 淘宝/小红书布局节点的 system prompt 增加"为每个图片区块标注 `align/width/aspect`"指引
  - [x] `imageGen` 节点 `ImageGenConfig` 新增 `aspect`，provider 按 `aspect` → `size` 映射（如 3:4 → 768x1024），生图比例贴合版式
  - [x] 退出标准：模板 prompt 已生成含位置字段的示例；provider 单测通过

- [x] 6.4 Inspector 手动微调（可选 P1，**已做**）
  - [x] `AgentConfig` 新增 `imageDirectives`；engine 在组装 agent prompt 时追加（下次运行生效）
  - [x] 排版/布局 agent 节点的 Inspector 增加「排版指令」输入框，写回 `node.agent.imageDirectives`
  - [x] 新增 `withLayoutDirectives` 单测
  - [x] 退出标准：在 Inspector 写入指令后重跑，agent 收到的 prompt 含该指令 → 影响下次渲染

- [x] 6.5 测试
  - [x] `product.ts`：新字段解析 + 向后兼容（core 测试，2 个新用例）
  - [x] `ProductBlocks` 渲染类型校验（web `tsc --noEmit` + 构建通过）
  - [x] 退出标准：`pnpm -r test` 全绿（core 48 / server 96）

- [x] 6.6 文档更新
  - [x] 本文件 阶段 6 勾选已完成项
  - [x] `docs/product-content-roadmap.md` 差距 #3 标注已解决
  - [x] 退出标准：文档与实现一致

---

## 阶段 4A（建议）：触发方式 — 让产线自动跑

> 目标：产线不再只能手动点"运行"，支持 webhook / 定时(cron) / 事件 / 批量 触发，并能把触发 payload 作为 source 输入。
> 属于 roadmap 阶段 4 的"触发方式"子块。本段只覆盖触发，不含 Connector（见 4B）、Worker 插件化、MCP、存储抽象、人机协作、文档社区、工程化（均为阶段 4 其余子块）。

依赖：4A.1 → 4A.2 → (4A.3 | 4A.4 | 4A.5 | 4A.6) → 4A.7 → 4A.8

- [x] 4A.1 触发模型（`packages/core/src/graph.ts`）
  - [x] 新增 `TriggerConfig` zod：`type`(manual|webhook|cron|event|batch)、`cron?`(表达式)、`webhookSecret?`、`eventSource?`(graphId/artifact)、`batch?`(csv/数组来源)
  - [x] graph 级 `triggers?: TriggerConfig[]`
  - [x] 退出标准：`compileGraph` 接受带 triggers 的 graph；旧 graph 无 triggers 仍合法
- [x] 4A.2 触发器服务（`packages/server/src/triggers.ts`）：内存索引 + 持久化到 `graph.triggers`，启动 `restore()` 恢复；暴露 `fire(graphId, payload?)` / `fireWebhook(graphId, secret, payload?)`，复用共享 `startRun`（run.ts）
  - [x] 退出标准：单测可注册 / 触发 / 列出 triggers（triggers.test.ts）
- [x] 4A.3 Webhook 端点（`packages/server` api）：`POST /api/graphs/:id/webhook` 校验 `webhookSecret`，payload 作为 source 输入启动运行；附带触发器 CRUD（GET/POST `/api/graphs/:id/triggers`、DELETE `/api/graphs/:id/triggers/:tid`）
- [x] 4A.4 定时触发（cron）：`cron.ts` 最小 5 段求值器（UTC，`*`/`?`/`,`/`-`/`/n`，闰年/周末正确）+ `scheduler.ts` 启动扫描 cron、按下次运行时间设计时器、触发后从 now 重排；重启由 `restore()` 从表达式重算（禁用触发器跳过）；`/api/graphs/:id/triggers` 的 upsert/delete 同步/取消调度（cron.test.ts / scheduler.test.ts）
- [x] 4A.5 事件触发：`triggers.onGraphFinished(graphId, status)` / `onArtifact(artifactId)` 在 run 完成/产出 artifact 时由 run.ts 回调触发；仅 status==="completed" 触发 graph 事件；匹配 `eventSource` 的下游 graph（triggers.test.ts）
- [x] 4A.6 批量触发：`triggers.fireBatch(triggerId, payload?)` 从 `batch.rows` 或 CSV(path) 或 payload 数组逐行启动运行，默认并发 4 限流；`POST /api/graphs/:id/triggers/:tid/fire` 手动触发（批量返回 runIds）；含 CSV 解析（triggers.test.ts）
- [x] 4A.7 UI：触发器配置（独立 Triggers 标签或 Inspector），显示下次运行时间、手动触发、最近运行历史
- [x] 4A.8 测试 + 文档（roadmap 阶段 4 触发子块勾选）

## 阶段 4B（建议）：Connector 数据源 — 从真实数据源拉料

> 目标：source 节点能从文件 / HTTP / 表单 拉真实原料，而不是只能手动填文本框。
> 属于 roadmap 阶段 4 的"Connector 数据源"子块。S3 等远程存储归 阶段 4E（artifact 存储抽象），本段先做本地文件 + HTTP + 表单。

依赖：4B.1 → 4B.2/4B.3/4B.4 → 4B.5 → 4B.6 → 4B.7

- [x] 4B.1 Connector 抽象（`packages/core/src/graph.ts`）：`ConnectorConfig` zod — `type`(manual|file|http|form)、`file?`(path/glob/encoding)、`http?`(url/method/headers/auth/extract)、`form?`(字段 schema)
  - [x] source 节点增加可选 `connector?: ConnectorConfig`（升级原预留占位 `{type,config}` 为类型化 schema）
  - [x] 退出标准：`compileGraph` 接受；旧 source（无 connector）仍合法
- [x] 4B.2 文件 Connector（`packages/server`）：读本地文件/目录，按 glob 收集文本与图片，作为 source 输入（text + images）
- [x] 4B.3 HTTP Connector（`packages/server`）：GET/POST 拉 JSON/HTML/文本，可选字段提取 → source 文本；支持 Bearer/Basic auth 与错误处理（非 2xx 抛错）
- [x] 4B.4 表单 Connector（UI）：运行前弹出字段表单（FormConnectorModal），提交值经 `connectorValues` 注入 source 文本
- [x] 4B.5 source 装配（`packages/server/src/engine.ts`）：跑 source 节点时若配了 connector，先拉数据再喂下游；失败重试 2 次后给清晰错误（errorCode=CONNECTOR），不扩散为未捕获异常
- [x] 4B.6 UI：source 节点 Inspector 增加 Connector 选择 + 配置（文件 / HTTP / 表单，含 glob、auth、字段提取、请求头/体）；运行前表单弹窗
- [x] 4B.7 测试 + 文档（roadmap 阶段 4 Connector 子块勾选）
  - 测试：`packages/server/src/connectors.test.ts`（file 单文件/目录/glob/asImages/base64、http JSON 提取/纯文本/非 2xx/Bearer auth/POST+自定义头、form 填值/空值、缺配置抛错）、`connectors-engine.test.ts`（source 装配拉料 + 不可达时 CONNECTOR 错误）
  - 用法：source 节点在 Inspector 选 Connector 类型并配置；`file` 支持路径/目录/glob 与 `asImages`；`http` 支持 GET/POST、Bearer/Basic auth、响应字段 `extract`、自定义 headers/body；`form` 在运行前弹窗填写，值经 `connectorValues` 注入 source 文本；拉取失败重试 2 次后以 `errorCode=CONNECTOR` 结束该节点，不扩散为未捕获异常。

## 阶段 4D（建议）：MCP 支持

> 目标：让产线能接入任意 MCP server，把它暴露的工具当作可装备的技能卡直接调用。
> 属于 roadmap 阶段 4 的"MCP 支持"子块（4.3）。当前实现 stdio 传输；SSE/HTTP 传输为后续增强。

依赖：4D.1 → 4D.2 → 4D.3 → 4D.4 → 4D.5 → 4D.6

- [x] 4D.1 `McpClient`（`packages/server/src/mcp.ts`）：transport 抽象的 JSON-RPC 2.0 客户端（`initialize` / `listTools` / `callTool`），与具体传输解耦便于测试
- [x] 4D.2 stdio 传输 `StdioMcpTransport`：子进程 + `Content-Length` 帧，按 `id` 关联请求/响应，忽略通知
- [x] 4D.3 工具发现后注册为技能卡（`registerMcpTools`）：每个工具注册为 `kind:"tool"` 的 skill（`id=mcp:<server>:<tool>`），`execute` 转发到 MCP server；进入全局技能注册表，与内置工具一样可被挂载与调用
- [x] 4D.4 启动装配：读 `MCP_SERVERS` 环境变量（JSON 数组 `[{id,command,args?}]`），逐个连接并注册；单台失败不影响其余
- [x] 4D.5 状态与示例：`GET /api/mcp` 返回已连接 server 及其工具；`scripts/sample-mcp-server.mjs` 为最小可跑的 echo MCP server；测试含单测（内存 transport）+ 端到端（真实子进程）
- [x] 4D.6 文档（本段勾选 + 用法说明）
  - 用法：设 `MCP_SERVERS='[{"id":"sample","command":"node","args":["scripts/sample-mcp-server.mjs"]}]'` 后启动；其工具出现在技能卡中，运行时像内置工具一样被模型调用。`GET /api/mcp` 可查看接入情况。
- [x] 4D.7 SSE / HTTP 传输、工具调用权限治理（network/fs 白名单生效）

### 4D.7 详细：远程传输 + 权限治理
- 传输抽象扩展为三种（`packages/server/src/mcp.ts` 的 `McpServerSpec`）：
  - `stdio`：原行为，spawn 本地进程（4D.2）。
  - `http`：`StreamableHttpMcpTransport`，POST JSON-RPC，`Accept: application/json, text/event-stream`，兼容服务端以 SSE 或 JSON 返回，并捕获 `Mcp-Session-Id` 维持会话。
  - `sse`：`SseMcpTransport`，GET 拉起长连接接收 `endpoint` 事件拿到 POST 地址，再把客户端请求 POST 过去，响应经 GET 流按 `id` 回传（兼容旧版 MCP server）。
- 配置格式升级：`MCP_SERVERS` 每项可写 `{id, transport, command?, args?, url?, headers?, permissions?}`；旧式 `{id,command,args}` 仍兼容（默认 stdio）。`permissions` 用于声明该远程 server 的工具允许触碰的资源（默认 `{subprocess:false, env:[]}`，即不授予任何 network/fs —— 对不可信远程 server 的安全默认）。
- 权限治理 `packages/server/src/permissions.ts`：
  - `evaluateToolCall(skill, op, cfg)` 把技能**声明**的 `permissions` 与运营方**白名单**（`TOOL_NETWORK_ALLOW` / `TOOL_FS_ALLOW` / `TOOL_SUBPROCESS_ALLOW`）结合，调用期返回 `null`（放行）或原因字符串（拒绝）。白名单存在时覆盖技能声明。
  - `guardToolCall(name, args, cfg)` 在引擎工具执行关口（`engine.ts` 的 `executeTool` 闭包）中调用：对 `web_fetch` / `web_search` 解析目标 host 后校验；其它工具按声明校验 fs/subprocess。
  - 信任边界：内置工具在本进程内被本关口拦截；MCP 工具运行在外部 server，运行时无法拦截其网络，故治理以**挂载时声明的最小 permissions** 为准（运营方应为不可信 server 显式收紧）。
- 测试：`mcp.test.ts` 现含 stdio（真实子进程）+ Streamable HTTP + legacy SSE 三种传输的端到端；`permissions.test.ts` 覆盖 network/fs/subprocess 的放行与拒绝及 `TOOL_NETWORK_ALLOW` 白名单生效。
- 退出条件：产线能接入远程 MCP server（SSE/HTTP），且 `web_fetch` 等网络工具在运营方白名单之外的目标被拒绝。

## 阶段 4C（建议）：Worker 插件化

> 目标：产线能在不改核心代码的前提下，接入自定义 worker（例如对接不同模型供应商）。把实现 `Worker` 接口的文件丢进 `workers/` 目录即可被发现与选用。
> 属于 roadmap 阶段 4 的"Worker 插件化"子块（4.1）。进程隔离 / 权限清单为后续增强（见 4C.7）。

依赖：4C.1 → 4C.2 → 4C.3 → 4C.4 → 4C.5 → 4C.6

- [x] 4C.1 `WorkerPlugin` 接口 + `WorkerRegistry`（`packages/server/src/worker-plugins.ts`）：`id` / `name` / `models?` / `createWorker()`
- [x] 4C.2 插件目录约定：`*.worker.(ts|js|mjs|cjs)` 导出 `plugin`（或 `default`），启动时 `loadWorkerPlugins(dir)` 扫描并注册；坏插件仅告警不致命
- [x] 4C.3 选择入口：`GET /api/workers` 列出可用 worker（内置 + 插件）；`POST /api/runs` 与 `POST /api/runs/:id/resume` 支持 `workerId`，未知/缺失回退内置 `agnes`
- [x] 4C.4 示例插件 `packages/server/src/workers/demo.worker.ts`（复用 `routingWorker`，演示约定）
- [x] 4C.5 测试：`packages/server/src/worker-plugins.test.ts`（扫描发现 / 忽略非插件与坏文件 / 注册表回退与按 id 选取）
- [x] 4C.6 文档（本段勾选 + 用法说明）
  - 用法：在 `workers/`（可通过 `WORKERS_DIR` 覆盖）放一个 `xxx.worker.ts`，`export const plugin: WorkerPlugin = { id, name, models, createWorker }`；重启后 `GET /api/workers` 可见，运行产线时传 `workerId` 即可选用。
- [x] 4C.7 插件进程隔离（`child_process.fork` + env 裁剪 + 文件/网络经主进程代理）、加载时权限清单确认

### 4C.7 详细：插件进程隔离
- `WorkerPlugin` 新增 `isolation?: "in-process" | "subprocess"`（默认 in-process）与 `env?: string[]`（声明子进程可见的环境变量名）。
- `packages/server/src/isolation.ts`：
  - `trimEnv(declared)`：只保留安全基线（PATH/HOME/TMPDIR…）+ 插件声明的 key，其余（如密钥）不进子进程。
  - `spawnIsolatedWorker(entry, id, declaredEnv)`：`child_process.fork` 运行 `worker-proxy.mjs`，通过 IPC 代理 `runAgent` / `judge` / `generateImage`；子进程内 `fetch` 与 fs 调用回传主进程执行。
  - `IsolatedWorker` 实现 `Worker` 接口（生成器事件在子进程收集后按序重放）。
  - 主进程侧 `proxyFetch` / `proxyFs` 复用 4D.7 的 `loadPermissionConfig` + `matchDomain`  enforcement：网络按 host 走 `TOOL_NETWORK_ALLOW`、文件按 path 走 `TOOL_FS_ALLOW`。
  - `disposeIsolatedWorkers()` 在进程退出（SIGINT/SIGTERM）时清理子进程。
- `worker-proxy.mjs`：子进程入口，加载插件、用 `globalThis.fetch` 覆盖实现网络代理，用 `globalThis.__proxyFs` shim 实现文件代理（ESM 的 `node:fs/promises` 命名空间只读，无法直接覆盖，故走协作 shim；对任意插件的逐调用 fs 拦截需自定义 ESM loader，列为已知限制）。
- 注册表 `loadFrom`：插件声明 `isolation:"subprocess"` 且入口为 `.js/.mjs` 时 fork 隔离运行；`.ts` 插件或失败时回退 in-process 并告警。
- 测试：`isolation.test.ts`（env 裁剪不泄露密钥、网络/文件代理及白名单放行与拒绝、跨进程方法调用）。
- 退出条件：敏感环境变量不进入插件进程；插件的网络/文件访问受主进程白名单约束。

## 阶段 4E（建议）：Artifact 存储抽象（本地 / S3）

> 目标：产线生成的图片/文件等产物，字节落盘位置可插拔。默认本地文件，配置一行切到 S3 兼容存储（AWS S3 / MinIO / Aliyun OSS）。
> 属于 roadmap 阶段 4 的"Artifact 存储抽象"子块（4.4）。引擎只依赖 `ArtifactStore`，后者委托给 `StorageBackend`，因此切换后端不影响调用方。

依赖：4E.1 → 4E.2 + 4E.3 → 4E.4 → 4E.5 → 4E.6 → 4E.7

- [x] 4E.1 `StorageBackend` 接口（`packages/server/src/storage.ts`）：`kind`(local|s3|memory)、`put(key,data)` / `get(key)->Buffer|null` / `delete(key)`
- [x] 4E.2 本地实现 `LocalStorageBackend`：文件落本地磁盘，`key` 即相对路径
- [x] 4E.3 S3 兼容实现 `S3StorageBackend`：用 REST + AWS SigV4 直连（无 AWS SDK 依赖），支持 `endpoint`(MinIO/OSS) 与 `prefix`；`get` 对 404 返回 null
- [x] 4E.4 配置切换：`storageConfigFromEnv()` 读 `STORAGE_BACKEND`(local|s3) 及 `S3_BUCKET/S3_REGION/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY/S3_ENDPOINT/S3_PREFIX`；`ArtifactStore.fromEnv()` 一行装配
- [x] 4E.5 `ArtifactStore` 改造：字节读写全部委托给 `StorageBackend`（`save/saveBinary/open/readBytes/remove` 改为异步），本地行为不变，S3 对调用方透明（DB 仍记 `storage:"local"` + `/api/artifacts/:id`，路由从后端取字节）
- [x] 4E.6 测试：`packages/server/src/storage.test.ts`（local/memory 往返、S3 PUT/GET/404/prefix/非 2xx 抛 StorageError、env 切换）、`artifact-store.test.ts` 与 `artifacts.test.ts` 随异步 API 更新
- [x] 4E.7 文档（本段勾选 + 用法说明）
  - 用法：默认无需配置即本地存储；切 S3 只需 `STORAGE_BACKEND=s3` 加凭据环境变量，重启即生效，无需改代码。产物仍经 `/api/artifacts/:id` 提供（S3 模式下由后端按需取回）。

## 阶段 E（建议）：引擎表达力增强 — 摘要 / 模块卡 / 契约卡 / 人工确认

> 目标：增强 agent 的表达力与可控性。对应 roadmap 2.1（滚动摘要）、2.2（Prompt 模块卡 / 输出契约卡 / 危险操作人工确认）。
> 2.1 / 2.2 当前均为"延后 / 未勾"。E.1–E.4 相互独立，可并行。

- [x] E.1 滚动摘要（roadmap 2.1）
  - [x] 上游输入超阈值（字符 / token）时，用 LLM 摘要压缩后再拼接，而非硬 `truncate`（`inputPolicy.mode = "summary"`）
  - [x] 可配置摘要预算（maxChars）与是否启用；摘要失败 / 无 summarizer 时回退 `truncate`
  - [x] 退出标准：长产线单测显示超长输入被摘要而不是截断（`engine.summary.test.ts` 已覆盖：摘要压缩 / 抛错回退 truncate / 无 summarizer 回退 / 阈值内透传）
- [x] E.2 Prompt 模块卡（roadmap 2.2）
  - [x] 装备(equip)的模块卡，其 prompt 在运行期自动拼进 agent system prompt（支持多级 equip 依赖 + 去重，`collectPromptModules` BFS + seen 去重，可处理环）
  - [x] 退出标准：被 equip 的模块卡内容出现在 agent 收到的 prompt 中（单测 `engine.skills.test.ts` 已覆盖：挂载注入 / 多级 equip + 去重 + 环）
- [x] E.3 输出契约卡（roadmap 2.2）
  - [x] 节点可声明输出 schema（JSON schema）；引擎校验 agent 输出，不达标触发 rework（复用现有 rework 机制，放宽 `compile` 允许 agent 节点发起 rework 线）
  - [x] 退出标准：输出不符契约时自动返工达到上限（单测 `engine.skills.test.ts` 已覆盖：达标→done / 不达标 rework 后恢复→done / 始终不达标→failed + VALIDATION）
- [x] E.4 危险操作人工确认（roadmap 2.2）
  - [x] 写文件 / 外部网络 / 删除类 tool 首次调用走 halt，暂停运行等人 approve/deny，再续跑（`isDangerousTool` + `HaltRequested`，`reason = "dangerous-tool:<name>"`）
  - [x] 需要人机协作暂停 / 恢复机制（事件 + 恢复点，`resume({ approveTools })` 续跑执行被批准的危险工具）
  - [x] 退出标准：危险 tool 调用被暂停且需人工确认后才继续（单测 `engine.danger.test.ts` 已覆盖：halt→带 approveTools 跑完 / 不带 approveTools 重新 halt）

---

## P1 已知延后项 — 实施计划

> 从各阶段"延后/待补"中收拢的 6 项，按价值/工作量比排序，分 3 个批次推进。
> Batch 1 可直接落代码；Batch 2 的 ArtifactRef 需先写设计笔记；Batch 3 依赖 #1 且按需启动。

### Batch 1 — 快速赢（互相独立，可并行）

#### P1-1 周/月成本聚合视图（对应 3.2 待补）

**P1 — 小 (~120 行) — 无依赖 — ✅ 已完成 (2026-08-27)**

- [x] `db.costReport()` 新增 `byWeek`（`strftime('%Y-W%W')`）和 `byMonth`（`strftime('%Y-%m')`）聚合维度，结构同 `byDay`
- [x] `CostReport.tsx` 新增「日 / 周 / 月」粒度切换；智能默认（≤14 天日，≤90 天周，否则月）；条形图数据源随粒度切换
- [x] 测试：`costs.test.ts` 加 byWeek/byMonth 聚合断言
- [x] 退出条件：选「近 30 天」切周粒度看到 4-5 根周柱；选「全部」切月粒度看到按月柱

#### P1-2 每节点质量评分（对应 3.7 "per-node quality scoring"）

**P1 — 小 (~200 行) — 无依赖 — ✅ 已完成 (2026-08-27)**

- [x] `openai-compatible.ts` 的 `judge()` 确保从模型输出 JSON 中提取 `score`（0-10），system prompt 要求输出 `{passed, reason, score}`（此前已实现）
- [x] `db.evalReport()` 聚合 avgScore（此前已实现）
- [x] `core/runtime.ts`：`NodeRuntime` 加 `lastVerdict`，gate.verdict reducer 保存判定结果含 score
- [x] 前端 Inspector：节点标题栏显示质量分徽章（good/warn/bad 三色）
- [x] 前端 EvalReport：统计卡片加平均质量分，byGraph/byPrompt 表格加平均质量列
- [x] 测试：judge score 提取断言 + byNode 质量聚合断言（core 54 + server 230 全绿）
- [x] 退出条件：真实模型跑带质检产线，评估报告能看到每节点平均质量分，v1/v2 可对比

#### P1-3 真实长任务抽网验证（对应 3.3 "待真实长任务验证"）

**P2 — 极小 (~80 行) — 纯验证任务 — ✅ 已完成 (2026-08-27)**

- [x] `sse-resume.test.ts` 已实现基于 `?after=` query param 的断网重连测试（commit f3ba54b）
- [x] 补充 `Last-Event-ID` header 方式的重连测试，覆盖原生 EventSource 行为
- [x] 两种重连方式（query param + header）均验证：断网后重连事件 seq 连续无重复、覆盖全量
- [x] `handoff.md` 3.3 节记录验证结果
- [x] 退出条件：脚本跑通，断网恢复后事件不丢不重

### Batch 2 — 基础设施

#### P1-4 引擎 ArtifactRef 升级（对应 3.8 "引擎 artifacts Map 升级"）

**P1 — 中 (~300 行) — 改核心路径，需先写设计笔记 — ✅ 已完成 (2026-08-27)**

- [x] 先在 `docs/technical-design.md` 追加「ArtifactRef 升级设计」节（数据结构、inputFor 兼容策略、resume 重建、事件 schema 不变结论、回滚方案）
- [x] `engine.ts`：`artifacts: Map<string,string>` → `Map<string,Artifact[]>`；节点完成时 push Artifact 对象；文本节点产出 `{kind:"text",content:output}`
- [x] `inputFor()` 重构：遍历上游 artifacts[]，文本取 content 拼接，图片 URI 收集到 images[]，视频/音频/文件加文本占位
- [x] `imagesFor()`：从所有上游 artifacts 提取 image URI，不再只依赖 source.images；删除 `createImageResolver` + `extraImages`
- [x] `reconstructState()`/`resume()`：从 `artifact.produced` 事件重建 artifacts Map；node.started attempt 变化时清空（仅已存在条目，避免 resume 误判完成）
- [x] 测试：`engine.artifactref.test.ts`（4 用例）— imageGen 图片流入下游 vision / reconstructState  typed arrays / inputFor 图片占位 / rework 环复位
- [x] 退出条件：imageGen 产出的图片能被下游 agent 通过 images 参数拿到；多图场景下游全收；假 worker 全量测试绿（234 passed）

#### P1-5 fs 隔离完整 ESM loader（对应 4C.7 已知限制）

**P2 — 中 (~200 行) — 安全增强 — ✅ 已完成 (2026-08-27)**

- [x] 新建 `packages/server/src/fs-loader.mjs`：自定义 ESM loader，`resolve()` hook 拦截 `node:fs/promises` / `fs/promises`，重定向到代理模块
- [x] 新建 `packages/server/src/fs-proxy.mjs`：代理模块导出 8 个支持的 fs 方法（readFile/writeFile/appendFile/readdir/stat/unlink/mkdir/rm），每个都调用 `globalThis.__proxyFs`；未实现方法抛清晰错误
- [x] 新建 `packages/server/src/fs-loader-register.mjs`：`module.register()` 注册 loader
- [x] `__proxyFs` 扩展：read/write/appendFile/readdir/stat/unlink/mkdir/rm（worker-proxy.mjs）
- [x] `isolation.ts`：`proxyFs` 扩展对应 8 种操作 + 白名单校验；`spawnIsolatedWorker` fork 时加 `execArgv: ['--import', FS_LOADER_REGISTER]`
- [x] 测试：isolation.test.ts 8 用例全绿；sample-worker-plugin 改为直接 `import("node:fs/promises")`（不再依赖协作式 __proxyFs 检查），验证 ESM loader 拦截生效
- [x] 退出条件：恶意插件直接读 `/etc/passwd` 被拦截；授权目录读取正常；全量测试 234 passed

### Batch 3 — 大功能（按需启动）

#### P1-6 视频/音频生成（对应阶段 4 "视频/音频生成仍为阶段 4 待做"）

**P2 — 大 (~600 行) — 依赖 P1-4，provider 支持不统一 — ✅ 已完成 (2026-08-27)**

- [x] 期 A 视频：`core/graph.ts` 新增 `videoGen` 节点类型 + `VideoGenConfig`（model/prompt/duration/aspect/size/n/baseUrl/apiKey）；`Worker` 加可选 `generateVideo()`；`openai-compatible.ts` 实现（`/videos/generations`，支持同步返回 + 异步轮询两种响应格式，300s 超时）；引擎新增处理分支（调用 worker→storeBinary→artifact.produced→折叠到下游，无方法时 soft-fail）；前端 Inspector 配置面板 + `<video>` 播放（FinishedProduct/ArtifactChip 已预留）；假 worker 占位实现
- [x] 期 B 音频：同结构新增 `audioGen` + `AudioGenConfig`（model/prompt/voice/format/speed/n/baseUrl/apiKey）+ `generateAudio()`（`/audio/speech` TTS，同步返回二进制，120s 超时）
- [x] 测试：`engine.videogen.test.ts`（4 用例：单视频产出/多视频 n>1/无方法 soft-fail/视频流入下游占位）+ `engine.audiogen.test.ts`（5 用例：单音频产出/wav 格式/多音频/无方法 soft-fail/音频流入下游占位）
- [x] 退出条件：配置支持视频生成的 provider（或假 worker），videoGen 产出视频 artifact，前端可播放，下游可引用；全量测试 core 54 + server 243 全绿
- [x] 前置：P1-4 ArtifactRef 升级完成后再启动
