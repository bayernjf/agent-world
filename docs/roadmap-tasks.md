# Agent World 任务路线图

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
- [ ] Prompt 模块卡：装备后自动拼接到 system prompt
- [ ] 输出契约卡：装备后要求模型输出符合 schema，不合格触发返工
- [x] 工具调用全审计：`tool.called`/`tool.result` 进事件流，Inspector 可见调了什么、传了什么、返回了什么；runtime reducer 跟踪 toolCalls
- [x] `ToolContext` 注入：worker 通过 `executeTool` 回调执行工具，不直接拿 `fetch`；引擎解析已装备技能并传入工具定义
- [ ] 危险操作（写文件、发网络、删除）首次调用 halt 等人工确认，复用阶段 1 的 halt/resume（等文件/写操作类技能落地时一起做）
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
- [ ] **启动备份**：SQLite VACUUM INTO 到带时间戳的备份文件
- [ ] **事件接口分页**：`GET /api/runs/:id/events?from=&to=`，SSE 仍增量
- [ ] **多标签页乐观锁**：graphs 加 version，PUT 带 If-Match，冲突时报错而非静默覆盖
- [ ] **结构化日志**：pino 或同等方案，每条日志带 runId、级别、文件轮转

### 3.6 成本预警

- [ ] 预算到 80% 时发警告事件（不停线）
- [ ] 前端显示警告状态（电表变黄）
- [ ] 月度预算：runs 表加月度聚合，超限发警告
- [ ] 退出条件：快超预算时能被提醒

### 3.7 评估体系雏形

- [ ] 聚合统计：合格率、平均返工次数、平均耗时
- [ ] 按产线/节点/时间维度
- [ ] Prompt 改动前后对比（需要 graph 版本，先用 snapshot diff）
- [ ] 退出条件：改了 prompt 后能看到合格率变化趋势

### 3.8 Packet/Artifact 分层

- [ ] 定义 Artifact 类型和存储接口
- [ ] 文本 artifact 内联兼容现有 output
- [ ] 文件 artifact 存本地磁盘，数据库存元数据
- [ ] Packet 加 artifactId 引用
- [ ] 引擎 artifacts Map 从 string 升级为 ArtifactRef
- [ ] 前端支持展示非文本产出（文件下载、图片预览）
- [ ] 退出条件：产线能产出文件，不只是文本

---

## 阶段 4：开源准备

**目标：** 陌生人能 clone 下来跑起来，并能加自己的 worker。

### 4.1 Worker 插件化

- [ ] 约定 `workers/` 目录，放实现 Worker 接口的文件
- [ ] 启动时动态扫描和加载
- [ ] Worker 元数据声明：支持哪些 model、需要哪些配置
- [ ] **插件进程隔离：** 第三方 worker/connector 在子进程（`child_process.fork` / `worker_threads`）中运行，只通过消息传递通信；主进程裁剪传入 env（只传声明需要的 key），文件/网络访问走主进程代理
- [ ] 插件权限清单：加载时展示插件声明的 permissions，用户确认后才启用
- [ ] macOS `sandbox-exec` / Linux seccomp 约束（可选增强）
- [ ] 文档：如何写一个自定义 worker
- [ ] 退出条件：不改核心代码，放一个文件就能加新 model 支持；第三方插件即使作恶也读不到未授权的 key 和文件

### 4.2 Connector

- [ ] 定义 Connector 接口
- [ ] 实现文件 connector：读目录/CSV/JSON 文件作为原料
- [ ] 实现 HTTP API connector：GET/POST 拉数据
- [ ] Source 节点 UI：选择 connector、配置参数、测试连接
- [ ] 退出条件：产线能从外部数据源自动拉原料

### 4.3 MCP 支持

- [ ] 实现 MCP client
- [ ] 连接 MCP server，发现其工具列表
- [ ] MCP 工具自动成为可装备的技能卡
- [ ] 退出条件：接一个 MCP server，它的工具能在产线里被调用

### 4.4 Artifact 存储抽象

- [ ] 定义 StorageBackend 接口
- [ ] 本地文件系统实现
- [ ] S3 兼容存储实现（MinIO/AWS S3/OSS）
- [ ] 退出条件：配置一行就能切换本地和 S3 存储

### 4.5 多模态

- [ ] Worker 接口 input 从 string 扩展为支持 content parts（文本+图片）
- [ ] Source 节点支持图片输入
- [ ] Canvas 上图片类原料有视觉区分
- [ ] 退出条件：商品图片能作为原料进入产线

### 4.6 触发方式

- [ ] Webhook 触发：`POST /api/webhooks/:graphId` 启动产线
- [ ] 定时触发：cron 表达式配置，内置调度器
- [ ] 事件触发：一条产线完成后自动启动下游
- [ ] 批量触发：上传 CSV/JSON，每条记录跑一次
- [ ] runs 表 trigger 字段标记来源
- [ ] 退出条件：不手动点派发也能自动跑

### 4.7 人机协作增强

- [ ] 人工编辑：Agent 产出后人可修改再交下游
- [ ] 审批节点：Gate 等人 approve/reject/edit
- [ ] 通知：halt/审批时发通知（先做 webhook，企业版做飞书/钉钉）
- [ ] 退出条件：人能在流程中间介入修改

### 4.8 文档与社区

- [ ] 架构文档（technical-design.md 完善为公开版）
- [ ] 扩展指南：写 worker、connector、skill
- [ ] 贡献指南
- [ ] 示例产线集（5-10 个覆盖典型场景）
- [ ] README 重写：5 分钟快速开始
- [ ] 首次启动引导（替代写死的 seed 图）
- [ ] 退出条件：没读过文档的人 10 分钟跑起来

### 4.9 工程化

- [ ] CI：GitHub Actions 跑 typecheck + test + build
- [ ] 密钥泄漏检查（git-secrets 或类似）
- [ ] CORS 收紧到配置的 origin（替换现在允许所有来源），加基础安全响应头
- [ ] 结构化日志（pino 或同等），每条带 runId、级别、文件轮转
- [ ] LICENSE 选择
- [ ] Docker Compose 部署配置
- [ ] 版本号和 CHANGELOG
- [ ] 退出条件：clone → pnpm install → pnpm dev 顺畅

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
- [ ] A/B 测试框架（同节点两个 prompt 版本对比）
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
