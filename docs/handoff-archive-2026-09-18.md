# Handoff Archive — 2026-09-18

> 从 `handoff.md` Active work 归档的已完成项详细过程。本文件只读，新增内容请写回 `handoff.md`。
> 更早归档：`handoff-archive-2026-09-07.md`（#1–#37）、`handoff-archive-2026-09-10.md`（#24–#43）、`handoff-archive-2026-09-11.md`（#44–#45）。

---

## Active work 已完成项详细过程（#39、#46–#56 + 2026-09-16 续 + M1 验收）

### #39 商业化 M1：成本计量回采 — 三问分析 + 价格校准（2026-09-08 开跑，✅ 完成 2026-09-13/14）

用 M0 环境跑真实产线，攒按用户/模型/月拆分的真实成本，作为 design-monetization.md §4 定价的数据前提。开跑前置已落地（PR #211）：① 单价缺口审计 `unpricedModels()`；② 按模型分摊 `node_runs.model`（迁移 36）+ `byModel` 聚合 + 前端表 + CSV。

**🎉 M1 三问分析完成（2026-09-13，基于 108 runs / 87 done）**：①成本画像——③短视频占 97.7%（$5.40），agnes-video-v2.0 占 90.4%（$5.00/10次），文本模型极便宜（180次调用仅 $0.13）；②完成率——①写草稿 95.3%、③短视频 76.9%、④批量 76.9%、②翻译 33.3%（返工逻辑导致 RATE_LIMIT）；③运行时长——中位数 3.8min，②翻译平均 8.6min（返工耗时最长）。

**✅ 价格校准完成（2026-09-14，基于 125 runs / $5.57 总成本）**：Starter $19→$9、Pro $49→$29、Team $199→$149，新增 §4.1 价格校准依据小节；超额加购价：视频 $2/段、图片 $0.20/张、token $0.50/100万。M1 阶段正式完成，M2 可以启动。

---

### #55 竞品痛点应对（G1–G5，安全子集三批落地，PR #319/#325/#331）

**依据 `docs/design-step-trace-and-robustness.md`，只落地不改 run 执行状态机的安全项（不影响 Hasee M1 回采）。**

#### 第一批：G1 只读时间线 + G2.1/G4.1 纯函数（PR #319，merge `4163efb`，2026-09-16）

- **G1 只读时间线（端到端可用）**：①core `04a1a55` 新增纯函数 `buildTimeline(events)`（`packages/core/src/trace.ts`，按 nodeId×attempt×variant 聚合节点/尝试/状态/耗时/tokens/cost/model/score/gate 裁决/错误码/输出预览/工具调用/产物，tokens/cost 只计每节点最后一次 attempt，乱序未知事件忽略不抛错）；②server `02f5b65` 新增只读 `GET /api/runs/:id/timeline`（requireRun viewer，直接投影 events 表、无 DB 迁移，并从 run.snapshot best-effort 解析 nodeMeta）；③web `4aba58d` 新增自包含 `RunTimelineView`（运行历史每行"步骤"按钮内联展开，展示每节点全部 attempt 含重试、状态徽章、耗时/model/token/成本/评分、gate ✓✕、错误码+信息、输出预览、工具/产物数、合计与预算熔断警告，zh/en i18n + CSS）。
- **G2.1 上游数据契约纯函数**：`contract.ts` `validateContract(contract,output)`/`coerceOutputObject`/`describeContractFailure`（无契约/空断言恒通过；空串/空数组/空对象按缺失；自定义 `SCHEMA_VIOLATION` 字符串）。
- **G4.1 超时判断纯函数**：`deadline.ts` `isTimedOut`/`remainingMs`/`deadlineAt`（timeoutMs 空/非正=不限时）。
- **第二批①·G1 完整输出懒加载**：server 新增 `GET /api/runs/:id/nodes/:nodeId/attempt/:attempt/output`（viewer 授权；完整字符串直接从 `node.finished` 事件投影，无需改 driver/无 DB 迁移；attempt 非整数/<1 返回 400；main 变体优先、缺失回退最后一个变体；8 HTTP 测全绿）。web `RunTimelineView` 截断输出旁加「展开完整输出/收起」按钮，按需懒加载、三态，`lib/api.ts` 加 `getRunNodeOutput`，zh/en run.json + CSS。
- **第二批②·G2.3 输出契约配置形态（core schema + Inspector UI，纯配置）**：core `contract.ts` 加 `ContractSpecSchema`（zod，requiredFields default []、types 为 Record），`graph.ts` 的 `GraphNode` zod schema 加可选顶层字段 `contract`（旧节点向后兼容）。web `Inspector.tsx` 新增 `ContractFields` 子组件挂在「配置」tab（所有 kind 可见；可增删必填字段、逐字段选 string/number/boolean/array/object 类型；空契约恒通过）。
- **验证**：core 新增 24 测（trace 8/contract 11/deadline 5）、server timeline 3 测、web 组件 2 测 + RunHistory 既有 40 测无回归；四包 typecheck 全绿。注意 server/web 消费 core 的 dist，改 core 后须先 `pnpm --filter @agent-world/core build`。

#### 续：执行核心四项收口（PR #325，merge `fb00657`，2026-09-17）

- **G2.2 输出契约 engine 接线**（`c7beaea`）：core `ErrorCode` 扩 `SCHEMA_VIOLATION`；engine 在唯一发包出口 `sendPackets` 开头加 `enforceContract` 闸门（`contractChecked` Set 去重；仅对 done 且声明了断言的节点用 core `validateContract` 校验，违例删产物 + 置 failed + emit `SCHEMA_VIOLATION` + 返回 false 拦截 flow 包），runNode finally 兜底末端不发包节点。**关键坑**：闸门必须在 handler 同步段的 `sendPackets` 内（schedule 的 launch while 在同一调用栈继续扫描），放 finally 会因 microtask 时序让同步完成节点（source）的下游提前启动。SCHEMA_VIOLATION 是确定性失败、不在 RETRYABLE 集、不重试，error 边可 catch。9 engine 集成测。
- **G2.4 批量预置数据源契约**：2026-09-18 逐文件核实当前无一处可安全预置（所有 source 节点 output 是 `buildSourceBrief` 文本、connector 结构化 data 走 `ctx.sourceMeta` 旁路不过契约闸门、`ContractSpec` 不支持数组），强配必 100% 误拦真实 run，维持缓做；重启前置契约能力三选一路径见 `docs/deferred-items.md` G2.4 行。
- **G1.2 从节点 fork 重跑**（后端 `3621db7` + 前端 `8dc75aa`）：语义=fork 点及其全部上游复用父 run 产物（合成零成本 `reused:true` 的 node.finished、不重跑不计费），只重跑 fork 点的 flow 下游；新 run 全新 runId、seq 从 0、继承父 run `budget_usd`、`trigger="fork"`，父 run 审计轨迹不动。core `node.finished` 加可选 `reused`、`buildTimeline` 透传；engine 末尾新增 `fork()`；`run.ts` 加 `forkRun()`；`POST /api/runs/:id/fork {fromNodeId}`（editor→403、缺参→400、running→409、坏节点/模型→422）。前端每个成功节点加「从此处重跑」按钮、reused 节点显示「复用」角标。后端 8 测、前端 3 测。
- **G3 节点 maxRetries 下放 + 预算 UI**（`ae31c38`）：后端各 handler 早已读 `<kind>.retry.maxRetries`、run 级 `budget_usd` UI 也早已端到端；真正缺口是前端无可视配置。新增共享 `RetryField`（clamp 到 schema [0,10]），挂到 7 类带 retry 策略的节点（textGen/http/code/translate/search/notify/vcs），zh/en nodes.json 加 `inspector.common.maxRetries*`，2 测。
- **G4.4 视频远端进度轮询（仅本次运行内子集，`dfebcca`）**：Worker 加可选 `submitVideoJob`/`queryVideoJob` 接缝；videoGen 两方法齐备时"提交一次→指数退避（2s..20s）轮询→5min 上限 TIMEOUT"，远端 TIMEOUT/RATE_LIMIT 码透传；缺一方法字节级回退同步 `generateVideo`。当前无 provider 实现该接缝，生产仍走同步路径。5 测。跨 run 断点续跑随 G4.2。
- **验证**：四包 typecheck 全绿；core 20 文件 275、server 150 文件 1232、web 100 文件 1910、mcp 3 文件 71，共 273 文件 3488 测全过；i18n 守护绿。
- **本轮后仍留待**：G2.4 模板预置 contract；G4.2 degraded 状态机 + G4.3 前端「继续此节点」+ G4.4 跨 run 续跑（三者绑定，改执行核心，避开 M1 回采关键期）。

#### 续二：G5 prompt 热迭代闭环（PR #331，merge `26ec4a5`，2026-09-18，已部署 Hasee）

方案见 `docs/design-ab-testing.md` §5。纯只读投影 + 编译独立 run，不改 run 执行状态机。

- **G5.2 core**（`8ee7fe3`，`packages/core/src/ab-gate.ts`）：`findDownstreamGate(graph,targetNodeId)` 只沿 flow 边 BFS 找目标下游最近 gate，标记最短路径上是否经过内容变异节点；`projectGateVerdict(...)` 复用 `buildTimeline` 折叠该 gate 各 attempt 的 verdict、取最终一次，给 passed/score/reason/minScore/meetsBar/mutatesInBetween/history。10 单测。
- **G5.1 + G5.2 server**（`cb396f1`）：`POST /api/runs/ab` 增可选 `fromRunId`（fail-closed：不可见/不存在 404、跨图/非 done/snapshot 无目标 textGen/空 input 各 422）；取样时 Arm A 自动前置当前 live graph 的现网 prompt、input 投影自 runs.input 列；不带 fromRunId 维持 ≥2 全手填向后兼容。`GET /api/runs/:id/timeline` run 对象带 input。abReport 每 arm 选代表 run 批量取 events，经 projectGateVerdict 挂 `ABArmReport.gate`；winner 推荐逻辑不变、gate 仅呈现。`api.ab.test.ts` 6 测 + `ab.test.ts` G5.2 集成 6 测。
- **G5.1 + G5.2 web**（`ff2e017`）：RunTimelineView 在 run+节点均 done 且为 textGen 时加「以此样本做 prompt 对比」ghost 按钮；ABDialog 取样模式（目标锁定、input 只读预填、≥1 新 prompt、自动算 Arm A）；ABReport 增「质检站判定」列；zh/en i18n 13 key。受影响 4 文件 96 测全过。
- ✅ 已收口：core `8ee7fe3`、server `cb396f1`、web `ff2e017`、docs `71c2d1f`；health 探针 `commit=26ec4a5 db=ok`。

---

### #56 gate 禁用词重写反馈增强 + handoff 对账 + Windows 质量门基线（2026-09-18）

- **③ gate 禁用词重写反馈带命中词与上下文（✅ commit `703c47d`）**：治 deferred-items 编排线真实痛点——旧 `prohibitedSnippets`（nodes/shared.ts）每个禁用词只取首处（indexOf）、固定 ±12 字窗口、`replace(/\s+/g,"")` 强去空白；同一禁用词在文中多处出现时重写反馈只点一处，模型改不全就反复命中直到 `onExhausted=halt` 零产出（事故 run `qc-k7qhs`，命中「最」）。新增纯函数 `nodes/prohibited.ts` 的 `prohibitedHitsWithContext`：按句读边界取完整分句、超长无标点回退 ±16 字窗口、同一词多处全部上报（每词 perTerm=2、总 totalSnippets=6 封顶、去重）、`count` 报真实总次数；gate reason 改为"命中禁用词共 N 处（词A×n、词B），第 X 次质检。出现位置：「词」分句；…，请逐句改写并通读全文确认无其它遗漏处"。重写输入拼接链路与 `onExhausted=halt` 停机策略均不变（纯增强、向后兼容）。新增 `nodes/prohibited.test.ts` 7 纯函数测 + `gate-prohibited-feedback.test.ts` 1 集成测，phase1 13 测全绿。
- **② handoff/设计文档对齐真实 git 状态（✅ commit `f6ac9b5`）**：核实 G5 四 commit 已随 PR #331（merge `26ec4a5`）合 dev 并部署 Hasee，改 handoff 索引/标题/待办 3 处 + design-ab-testing.md 状态 1 处。
- **④ Windows 本机质量门快检（✅ 环境打通 + 基线甄别，详见 handoff Quality gate「Windows 本机测试基线」）**：便携 Node v24.11.0（`C:\Users\24670\node24`，corepack 代理 pnpm、npmmirror 源）、`pnpm install` + core build 成功，server typecheck 绿。全量 153 文件 1247 测 1112 过 / 135 失败（56 文件），逐类坐实全部为 Windows 平台基线：(a) 临时 sqlite 目录 afterEach `rmSync` 抛 EPERM；(b) 代码沙箱后端缺失（Windows 无 bwrap/seatbelt/rlimit）。铁证：`git stash -u` 干净 HEAD 重跑与带改动完全一致。
- **① M1 四产线 09-14 降频后观察小结（✅ 2026-09-18 05:33 UTC 由 Mac SSH 取数）**：降频+放宽 QC+RATE_LIMIT/TIMEOUT 退避 retry 后窗口完成率全面回升——①写草稿 84/87=97%、②翻译 8/11=73%、③短视频 8/8=100%、④批量 3/3=100%；累计完成率①94%/②51%/③86%/④82%。②翻译自 09-16 00:00 起连续 7 个 cron run 全 done，"未翻译反问"质量问题被降频节奏压住，观察窗 09-19 前继续攒数据。

---

### #54 窄视口 HUD/工具条竖折修复（✅ 闭环，PR #319，merge `4163efb`）

窄视口（实测 CSS 视口宽 ~863px）顶部 HUD/画布工具条按钮与统计文字被 flex 压成竖条，另发现折叠 Inspector 撑出 420px 横向溢出。真机 DOM 探针定位 9 处竖折。修复 commit `a8e4a89`（纯 CSS 10 行 `apps/web/src/styles.css`）：`.hud`/`.hud__actions`/`.canvas-toolbar` 加 `flex-wrap:wrap`；`.hud__meta` `flex:0 0 auto`+`nowrap`；`.hud__actions .chip` 与 `.canvas-toolbar__btn` `white-space:nowrap`；`.stage` 加 `overflow:hidden`。已 cherry-pick（CSS `7cce04b` / handoff `dd4107a`）随 PR #319 合 dev 并部署 Hasee；curl 拉线上 CSS bundle 逐条确认 7 条规则全部在。2026-09-18 回 Mac 后真机复验：视口 929px 实测横向 overflow=0、全叶文本扫描零竖折元素、HUD 与工具条均横排正常。#54 视觉复验完成。

---

### #53 Demo User Hasee 真机走查 + 零配置首跑 422 修复（✅ 闭环，PR #302/#305/#307）

**走查（PR #302 merge `b34fa29`）**：原 systemd override 只有 MONETIZATION_ENFORCE=1、漏 ALLOW_DEMO，补独立 drop-in `demo.conf`（仅 `Environment=ALLOW_DEMO=1`）。核心链路真机通过：登录页出现「免注册，先体验演示」；/me isDemo=true、TTL 24h、quota 全对；**最关键项**：MONETIZATION_ENFORCE=1 且 free token=0 下，demo 文本 run 不被 402 误拦（run done、成本 $0.001502 正常归集）；媒体能力锁定（视频节点编辑态可添加、派发时 gate 硬拦 402 `DEMO_QUOTA_MEDIA`）；DemoBanner/ClaimDialog/退出演示均正常。部署待办 `prune:demo` 已在 Hasee 挂 agentworld crontab 每小时第 17 分 `--apply`。

**必修 bug（demo 零配置首跑 422）根因与两轮修复**：
- **根因**：`setGraph()` 每次加载图都同步跑 `migrateGraphModels()`，而模型选项 `cachedModelOptions` 初始为 `[]`、靠模块加载时异步 `getSettings()` 填充。demo 一键落地即加载预置 tpl-draft，若此刻选项尚未返回，`remapNodeModel()` 会把有效的 `agnes-2.0-flash` 误判为"未知模型"，`defaultModelFor()` 在空选项下返回 null，把节点 model 改写成空串并经 `scheduleSave()` 自动写回后端；随后派发 `validateModels()` 见空 model 即 422。
- **首轮修复（PR #305 merge `5812aca`）**：新增模块级 `modelOptionsReady` 标志；`refreshDefaultModel()` 用 finally 置位并补跑一次迁移；`remapNodeModel()` 在取到非空 current 但 `!modelOptionsReady` 时直接 return false。
- **二次根因（更深）**：`refreshDefaultModel()` 在模块加载时（页面还在 /login、未登录）就跑，`getSettings()` 返回 401 被 catch 吞掉，原 finally 仍把 `modelOptionsReady=true`、而 `cachedModelOptions` 还是空 []。二次修复（PR #307 merge `76dbd42`，commit `27543bd`）：改为仅 settings 成功才置 `modelOptionsReady=true`，401/失败保持 false。`graph.migrate.test.ts` 7→8（新增 login 屏 401 竞态回归）。
- **真机复验（Hasee `76dbd42`）**：全新 demo 不碰模型分配直接派发 → run 被接受并执行（过了 validateModels，不再 422），DB graph 两个 textGen model 均保留 `agnes-2.0-flash`。run 最终 failed 在「润色」节点是 agnes free tier 429（外部配额，待升级付费 key），非本 bug。**#53 零配置首跑 422 正式闭环。**

---

### 2026-09-16 续：claim 转正真机全链路 + RTS 园区 polish 走查

- **任务 3（demo claim 原地转正）真机完整走通**：demo 会话点「注册并保留我的工作」→ ClaimDialog 填邮箱+两次密码→转正，转正后前端+DB 双验：同 userId 不变、is_demo=0、demo_expires_at=NULL、/me demo=null、email 更新、DemoBanner/转正按钮消失、graph 与 failed run 历史原样保留；退出后用新邮箱+密码可重新登录为正式账号。副作用：生产 Hasee 库多了一个正式测试账号 `claim-test-20260916@example.com`（userId `a29aed33-7b14-4282-8e22-9ae999457c6d`，prune cron 不会清理）；无现成"删正式账号"脚本。**（2026-09-16 用户决定：测试账号先留着观察，不删。）**
- **任务 2（RTS L0 园区 polish）真机走查：旧 polish 项均已完成且真机正常**——状态色、标签深色 pill+青字、跨厂厂顶抛物线拱+ROI、raycast 点选浮层+白色选中环。注意：之前"点不中工厂"是浏览器自动化 `bu.click_xy` 坐标映射偏差（park canvas `rect.left=-131`），非产品缺陷；真实鼠标命中正常。
- **唯一新修（PR #310 merge `b957832`）**：从"选中过节点的 3D 视图"进入/返回 L0 园区时，右侧 L1「节点详情」Inspector 仍残留展开挤占画布。修复 commit `d2cf6d3`（`App.tsx` 的 `enterPark`/`backToPark` 加 `setInspectorCollapsed(true)`）。

---

### #46 RTS 阶段 B 完成 + 预研模拟（2026-09-11~14）

B1-B9 全部落地（parkLayout / 园区布局持久化 / overview category / CanvasPark / 状态色 / raycast 浮层 / 相机记忆 / FPS 调试 / 拖拽持久化）。阶段 C 预研模拟：给 14 条现有 graphs 全部设置 park 坐标（按类别聚簇 + 螺旋布局），3D 园区总览正常显示。园区 UI 优化（PR #285 `a000de1`）：状态色变亮、标签加半透明深色 pill、字号 42→52、尺寸 300x80→380x100。阶段 C 范围（8 步草案）已写入 deferred-items.md。重启触发条件：商业化闭环 + 真实多产线规模形成（人均 ≥3 活跃产线）。

---

### #47 商业化 M2：订阅 gate 落地（S1–S8，PR #277，merge `124bdca`，2026-09-14 部署 Hasee）

方案 docs/design-monetization-m2-implementation.md。**S1** 无需新建迁移（subscriptions/usage_ledger 已在 base DDL + 迁移 34，最新迁移 37）。**S2** `1d7a3e4`：core 新建 `plans.ts`（PLANS 配额 / PLAN_PRICES $0/$9/$29/$149 / normalizeTokens / isPlanId），server `subscriptionService.ts`（currentPeriodEnd 月初 UTC / getOrCreateSubscription 懒建 free / setPlan 即时改套餐 + audit `billing.plan_changed`）。**S3** `8a8a32f`：用量真相在 node_runs、usage_ledger 为累加投影；driver 加 countDoneNodes/sumArtifactBytes/setUsage/listFinishedRunsSince/listUsageLedger；`recordRunUsage`（run.finished 钩子，try/catch 隔离）/`currentUsage`/`quotaRemaining`；新建 `usage-backfill.ts` 幂等回填 + `pnpm backfill:usage` CLI。**S4** `7dece12`（唯一 checkpoint）：enforceSubscription 加视频段/存储检查、token 改 normalizeTokens、QuotaError 加稳定 metric；gate feature flag `MONETIZATION_ENFORCE` 默认关闭。**S5** `9807988`：GET /api/subscription；BYOK 视频放行修复 `99d639b`。**S6** `f3ed6f4`：Settings 新增 billing tab、UsagePanel 四 meter、UpgradeGate 402 模态、PlanComparison 四档对比、billing i18n。**S7** `d045f46`：usage-alert.ts 在 start/resume 两处 run.finished 钩子异步触发，付费用户 token 80% info / 100% warning 公告；确定性公告 ID `usage_alert:<user>:<periodStart>:<tier>`。**S8** 代码/测试/文档完成。

**Hasee 部署完成（2026-09-14 10:29 UTC）**：①pull+build（迁移自动）②backfill:usage 回填 120 runs ③owner（userId `92d95665-10ef-49d7-a2c3-6ba39d92f5fb`）升 pro ④设 MONETIZATION_ENFORCE=1 重启（PID 22323）。健康探针全绿。测试基线：判断 M2 回归只看订阅/计费/公告相关测试 + typecheck，code-sandbox/engine.* 失败是 macOS 沙箱基线非回归。

---

### #48 商业化 M3：收款与账单落地（PR #280/#287/#290，2026-09-14/15 部署 Hasee）

**S1–S5（PR #280 merge `f65a9c6`）**：invoices 表（迁移 38）+ invoiceService + 账单页 UI + HTML 发票 + admin 手动收款闭环 + Team seats 限制。9 月周期账单 4 张。

**S6 Stripe（设计 docs/design-monetization-m3-s6-stripe.md）**：
- **后端 A0–A4（PR #290 merge `27f28ee`）**：A0 `c0f708e` 装 stripe 22.6.2；A1 `f5113be` 迁移 39（subscriptions/invoices Stripe 镜像列 + 3 索引）+ driver CRUD；A2 `8f32b37` stripe.ts 网关封装（env 配置、可注入 client、懒单例，19 mock 测）；A3 `b133c91` stripeWebhook.ts 五事件镜像同步 + 复用 idempotency_keys（10 测）；A4 `add61a4` api.billing.ts 三端点（/checkout /portal /webhook，webhook 绕过 cookie 认证走签名、raw body，6 测）。**关键踩坑**：stripe 22.6.2 周期/价格移到 subscription item（`sub.items.data[0].current_period_*`/`.price.id`），Invoice 无顶层 subscription（经 customer 反查），line 价格走 `line.pricing.price_details.price`。
- **v39 迁移启动崩溃修复（`7118990`）**：A1 把 3 个引用「老表后期才由迁移加的 stripe 列」的 CREATE INDEX 放进了 base DDL，老库 subscriptions 是 v34 旧表（无 stripe 列），DDL 阶段建索引即崩。修法：base DDL 删那 3 个 stripe 索引，新增模块级 `POST_MIGRATION_INDEXES`（迁移循环后 COMMIT 前幂等补建），v39.up 原索引保留作双保险。**规则：老表加新列且需索引时，索引不能放 base DDL，应放 POST_MIGRATION_INDEXES + 迁移 up 双保险。**
- **PR #287 CI 修复（`d2ecf90`）**：park-coord.test.ts 硬编码 `SCHEMA_VERSION` 断言 38，迁移 39 引入后版本升为 39。
- **前端 A5（PR #290，方案 docs/design-monetization-m3-s6-a5-frontend.md）**：A5.1 api 层 + 纯函数 `lib/billingReturn.ts`（parseBillingReturn 白名单，7 测）；A5.2 zh/en `billing.stripe` 子树 i18n；A5.3 BillingTab 按钮矩阵（自助仅"升级到更高价套餐"、Stripe 付费用户当前卡给管理订阅/更新支付方式/重新订阅、past_due 警示条、503 静默回退 contactOwner，11 组件测）；A5.4 App 挂载解析 `?billing=success/cancel/manage-done`。本地走查亲眼确认免费用户三档升级按钮、点升级后端真返 503 后按钮消失回退联系管理员。**剩余：仅真机 Step6（待收款主体 + STRIPE_SECRET_KEY/WEBHOOK_SECRET/PRICE_IDS，缺 key 优雅降级不阻断启动）。**

---

### #49 RTS 阶段 C 技术内核 C1–C3（PR #290，merge `27f28ee`，2026-09-15 部署 Hasee）

- **C1 ✅（`2ea918a` core / `c47e50b` server+web）**：core 新增 `crossGraph.ts` 纯派生跨厂产物边，不碰持久化 schema。跨厂边仅两类静态来源：① subprocess 节点（`node.subprocess.graphId`）② graph-event trigger（全库实测为 0）。方向统一 from=上游供给方 → to=下游消费方。导出 externalGraphRefs / buildCrossGraphEdges（internalOnly 剔除悬空与越权边）/ upstreamGraphIds / downstreamGraphIds，13 测。server `crossGraphService.loadCrossGraphEdges`（best-effort：单图 load 抛错 catch 跳过、任一端点不在可见集合即剔除，防租户泄露）挂到 `GET /api/operations/overview` 返回 `crossEdges`，5 测。
- **C2 ✅（`42468ac`）**：CanvasPark 渲染跨厂管道（THREE.Line，CROSS_PIPE_Y=6 避 z-fight，opacity .32）+ 每边 CROSS_TRUCKS_PER_EDGE=3 辆错相位卡车（subprocess 暖橙 / event 青，SPEED 260）。**RBAC 排查结论**：本地唯一 subprocess 边两端均属 a2afe301，当前账号不可见 → crossEdges=[] 是 internalOnly 正确剔除；临时把两端 graph 的 user_id 改成当前用户验证渲染正确后已立即还原 owner。非阻断 polish：跨厂管线 opacity .32 在等距俯视下偏暗（后由 #51 改抛物线拱 + .55）。
- **C3 ✅ 方案 B（决策见 design-rts-overview.md，`c1618a0` docs / `4a526ff` feat）**：用户拍板方案 B（同构锚点交叉淡化 + 相机缓动），方案 A（单场景 LOD 融合）仅文档留档。store(view-mode.ts) 新增不持久化 one-shot `drillAnimRequest:{dir:"in"|"out"}`；App.enterFactory/backToPark requestDrillAnim；Canvas3D mount 时 consume 到 "in" 把 camera.zoom seed 成 targetZoom×2.6，rAF 用 easeOutCubic 在 420ms 内 ease 回；CanvasPark 恢复 saved parkCamera 时 consume 到 "out" 同理。本地浏览器走查确认 zoom 平滑 ease + opacity 淡入、无白屏/闪黑/掉帧。web 197 测全过、i18n 守护 4 过。

---

### #50 RTS 阶段 C 剩余 C4–C8（PR #292，merge `1f5da5e`，2026-09-15 部署 Hasee）

三个原子 commit：`dffcf55` server（月度经济/分厂指标/未来 48h plan）、`e540422` server（cronState）、`9a7c900` web（C4-C7 全部 UI）。

- **C4 资源经济栏 ✅（ParkEconomyBar，HTML HUD，testid `park-economy`）**：后端 overview 一次性扩展承载——sqlite-driver 新增 `operationsEconomy`（node_runs JOIN runs、排除 running、月界与 costForMonth 同口径、支持 graphIds 协作 scope）+ `metricsByGraph`（content_metrics 按 graph_id SUM）。前端 HUD 显示本月成本 + 入/出 token + 预算剩余条（ratio≥0.8 warn/≥1 over 并钳 100%）。
- **C5 排期空间化 ✅（ParkScheduleAxis 24h 轴 + CanvasPark 底座倒计时环）**：cron next-fire 与 content_plan 画到同一 24h 轴；每厂底座加青色倒计时圆盘 sprite（<60m 显示「Nm」、<24h「Nh」）。**两处主动裁剪**：①plan 改期用「点击 +1h/+24h」而非自由拖拽；②cron 是周期表达式无单次改期语义，cron 在轴上只读、工厂浮层做暂停/恢复。
- **C6 效果热度 ✅（sprite canvas 纹理，makeHeatTexture 暖金 pill）**：分厂 CTR/GMV 聚合以工厂上方热度条呈现，全 0/无 content_metrics 数据的厂诚实不渲染。裁剪：先做 CTR/GMV；ROI 前端已在 #51 补齐。
- **C7 宏观轻操作全集 ✅（全程不进图）**：工厂浮层「进入/重试（仅 failed）/暂停↔恢复 cron」；新增 FactoryReviewCard（懒加载 listPendingReviews，纯函数 approveDecision：tool halt→approve+approveTools、human/gate→continue、驳回 reject）。把每厂 billboard 收进 per-factory THREE.Group 存 state.billboardById Map。
- **C8 收尾 ✅**：i18n zh/en park.json 增 economy/schedule/review 三段同构；新增 CSS 全走设计 token。**Hasee 真机走查**：经济栏显示真实「本月成本 $7.8100 / 入 431.2k / 出 313.0k」；底座倒计时环正确；24h 轴列 4 条 M1 cron tick；点暂停→环与轴 tick 即时消失，再点恢复→环重现、轴恢复，端到端落库闭环无残留；无 metrics 故无热度 pill（空态正确）。

---

### #51 RTS polish 清欠 + C6 补 ROI + 生产运维 P0/P1 对账（PR #296，merge `4b1cd90`，2026-09-15）

- **① 跨厂物流管线 polish**：贴地直线 → 越过厂顶的抛物线拱（新增无 three 依赖纯函数 crossArchY/crossArchPoints，弧顶 y≈236 > 厂高 140），CROSS_PIPE_OPACITY .32→.55，24 段采样；卡车 y 沿 crossArchY 爬升；crossGroup 重建时对旧 `THREE.Line` dispose geometry/material。
- **② C6 补 ROI**：后端 ad_spend 链路早已就绪（content_metrics.ad_spend → metricsByGraph SUM(ad_spend) → db.GraphMetrics.adSpend），纯前端在 CanvasPark `formatHeat` 的 GMV 段后补 `ROI ${gmv/adSpend}×`（gmv、adSpend 皆正才显示；adSpend=0 绝不显示 ∞；顺序固定 CTR·GMV·ROI）。
- **③ 生产运维逐域对账 + 补真实缺口**：12 域自包含 P0 经实证全部具备。**实证发现的唯一真实隐患**：服务器根 `/opt/agent-world/deploy.sh|rollback.sh` 是 untracked 手工副本（git 只跟踪 scripts/deploy/，根副本 git pull 永不更新、未来必漂移）——修法：仓库 `scripts/deploy/*` 设为唯一逻辑源（deploy 改为「仅当部署前当前服务健康才写 last-known-good」；deploy/rollback 均最多 15s 轮询健康），服务器根两份改为 `exec bash scripts/deploy/*.sh "$@"` 引导（原文件备份 /tmp/{deploy,rollback}.sh.root-bak）。**唯一未独立落地的 P0＝Playwright E2E 冒烟**（重启条件＝对外开放注册前，届时先在 runner 装 chromium）。其余 P1/P2 卡外部或属规模化触发。对账结论落 `docs/engineering-blueprint.md`「现状对账（2026-09-15）」。
- **澄清**：所谓"3D 审计剩 6 项 low"经核并不存在未清项——code-audit 77 项已于 09-11 全部清账，`grep TODO/FIXME/HACK apps/web/src/canvas/` 零命中。

---

### #52 演示用户（Demo User）D1–D6（PR #302，merge `b34fa29`，2026-09-15 部署 Hasee）

方案 docs/design-demo-user.md。新用户在登录页点「免注册，先体验演示」即建一个带 `is_demo` 标记的真实账号（复用 userId 隔离/JWT/订阅全套，转正时同 userId 原地保留数据）。3 个原待拍板点全部采用默认：30k token / ≤15 run / 并发 1 / 20MB / 禁视频音频、TTL 24h、cookie 沿用 signToken(false)=24h、预置模板仅 tpl-draft、ALLOW_DEMO 默认关 Hasee 显式开、转正原地保留。

**落地**：①`e305dc8` 迁移 v40 users 加 `is_demo`/`demo_expires_at`（sqlite+pg 共用一份 driver body；down 只清标记不 DROP 列）+ createDemoUser/claimDemoUser/listExpiredDemoUsers/deleteUserCascade（前置 is_demo 短路 + 末级 AND is_demo=1 纵深防御，绝不误删正式号）；②`0390ba6` `src/demo.ts` DEMO_QUOTA + enforceDemoQuota + 能力守卫；③`ae84d45` 三端点 `/api/auth/demo`（开关+IP 限流+同 cookie 复用+克隆 tpl-draft）、`/me` 带 isDemo+quota、`/claim` 原地转正，9 处 blockDemo 拦改密/publish/webhook/远端 MCP/自定义 connector/admin/billing（403 DEMO_LOCKED+claimUrl），run gate 加独立 demo 分支（自带 30k 池，MONETIZATION_ENFORCE=1 且 free token=0 下 demo 文本照样放行——Hasee 最大坑，由集成测末例锁定）；④`1ab6d35` 前端 useSession store + 登录/注册页演示入口 + DemoBanner + ClaimDialog + api 层识别 DEMO_LOCKED/DEMO_QUOTA 自动开转正弹窗 + UserMenu demo 态 + zh/en auth.json i18n + CSS；⑤`b3feb6d` `scripts/prune-demo-users.ts`（默认 dry-run、--apply 真删，npm script `prune:demo`）+ 部署手册补环境变量与每小时清理 cron。

**D6 本地端到端走查通过**：API 层 demo 201、/me 正确、demo 邮箱登录 401、publish/billing/admin 均 403、demo 文本 run 200 且真实调 agnes 产出、claim 200 同 userId 原地转正且产线/产物全保留；UI 层登录页入口→一键进主界面见预置产线+DemoBanner→点转正弹 ClaimDialog→提交后弹窗与 Banner 消失、数据保留。web 顺序全量 97 文件 1865 全过。

---

## M1 运行床验收（2026-09-08 真机 Hasee，A/B/C/D 四层全过）

- **A 只读对账通过**。
- **B 真实模型冒烟**：文本/图片计费端到端非零（图片 $0.04/张）；**视频/音频曾被计为 $0**——根因是 provider worker 从不填 media units/cost，已在 `6554769` 修复（视频 perSecond：适配器 durationPath → num_frames/frame_rate → 节点 duration → 5s 兜底；音频 perKiloChar 按输入字符数），17 用例绿。后续 PR #218（merge `2e23a06`）真机抓取确认时长在顶层 `seconds` 字段且为数字字符串 `"5.0"`，配 `durationPath:"seconds"`，`seconds:"8.0"`→8s/$0.80 不回归。
- **C 安全韧性四项全过**：**C1 限流**连发 40 次 POST /api/runs，前 30 放行（404，限流在 startRun 前不建 run 不烧钱）、第 31-40 全部 429；**C2 预算硬熔断**置 monthlyBudgetUsd=0.0001 后派发现场 402，模型调用前拦截零费用；**C3 静态加密**settings.data 为 enc:v2 密文，节点级 apiKey 注入实测 graphs.doc 落 enc:v2；**C4 SIGTERM drain** 部署重启日志 `shutdown started→shutdown complete`→迁移重跑→健康恢复，历史 4 次 SIGTERM 全部干净退出。
- **D 部署/CI 三项全过**：**D1 CI 安全门禁** CodeQL + CI 全 success，ci.yml 含 `pnpm audit --audit-level=high` + gitleaks；**D2 部署一致性** Hasee 健康探针与 origin/dev 逐字一致；**D3 备份可恢复性（只读演练）** 备份库拷到 /tmp 后 integrity_check=ok，行数对账一致，实测 RPO≈6h、RTO 秒级（库 823KB）。

**三个真实缺口（已全部闭环）**：①媒体计量修复未上 Hasee（PR #216 merge `a12f404` + PR #218 merge `2e23a06` 已部署）；②备份只在同盘同机 + WAL checkpoint 静默失败（#40 node:sqlite 替换 + Mac 每日异地备份兜底）；③/metrics 未经 nginx 暴露（2026-09-10 Hasee nginx 加 `location /metrics`，验证 curl 200 含 runs_total 等指标）。

---

## #41 M1 回采每日体检历史记录（2026-09-11 ~ 2026-09-18 07:52）

> 最新体检（2026-09-18 11:19 UTC）保留在 handoff.md 主文件。以下为历史体检过程。

- **2026-09-11（第 1 次体检，🔴 P0 阻塞发现 → 同日修复）**：cron 调度器完全未工作——根因 `index.ts` 中 `triggers.restore()`（async）未 await 即 `scheduler.start()`。修复 `triggers.restore().then(() => scheduler.start())`（`c826052`）+ 兜底 catch 保留 ProviderError code（429 不再记 UNKNOWN，`93a7d19`）。附带修复 CI flaky `ProductLibrary.test.tsx`（`2ecf3f2`）。PR #249 合并，03:57 UTC 部署 Hasee（PID 94661）。
- **2026-09-11（06:18 UTC cron 修复实测，✅）**：提频后自动 cron tick 证据确凿——`05:40 trg_mtv0zp69 → run e2142838`、`06:00 trg_m1_batch_weekly → run af9b07ae`、`06:10 trg_mtv0zp69 → run e266d932`，3 run 全部 done；成本归集健康；05:30 后零 429。
- **2026-09-12（⚠️ 网络不可达）**：SSH 连接超时、HTTP 空响应、内置浏览器 ERR_ADDRESS_UNREACHABLE，未取到数据，不编造结论。
- **2026-09-12（第二次体检，🔴 服务器关机 12h + ②翻译 QC TIMEOUT）**：服务器 03:20 UTC 自动恢复，agent-world.service 03:23:23 启动（PID 1577）。数据缺口：09-11 15:10 → 09-12 03:20 约 12 小时无 run。②翻译 2/2 全挂在 QC 质检站节点 60s TIMEOUT；①写草稿 3 failed = 2 次旧 429 + 1 次 QC TIMEOUT。成本总计 $0.578704，零碎片。
- **2026-09-12（03:50 UTC cron 恢复验证，✅）**：①写草稿产线 03:40 UTC tick 精确触发并成功完成（run `c92d79fb`，done，成本 $0.001684），证实 `triggers.restore().then(...)` 重启后自动恢复。
- **2026-09-12（②翻译 QC TIMEOUT 根因定位 + 修复）**：根因 `openai-compatible.ts` 中 judge/generateImage/generateVideo 三处 `withRetry` 只用 `isRateLimit`（仅匹配 429），不对 TIMEOUT 重试。修复：新增 `isTransientError`（RATE_LIMIT + TIMEOUT），三处改用；judge 超时 60s→120s。
- **2026-09-12（QC TIMEOUT 修复部署 + 手动触发验证，✅）**：PR #264（commit 01cbb63，06:04 UTC）部署 Hasee（PID 3939）。手动触发②翻译 run `16de2a85` 6 节点全 done、QC 节点无 TIMEOUT、成本 $0.000924。
- **2026-09-13（02:31 UTC，✅ 降频效果显著）**：总 66 runs（57 done/6 failed，86%）。降频后①写草稿 8 次全成功、②翻译降频后 2 次全成功；最近 429 为 09-12 16:00（降频前），之后无新 429。发现 0 计费 done 节点较多与 8 个 None 模型成本记录（待确认）。
- **2026-09-13（04:30 UTC 成本归集两个 bug 修复）**：**Bug 1（gate 节点全部 0 计费）**：根因 `Worker.judge()` 返回类型不含 usage，`gate.ts` 只能用 `zeroUsage()` 兜底。修复：judge 返回类型加 `usage: Usage`、openai-compatible judge 返回 verdict+usage、gate.ts 三处用 modelVerdict.usage。**Bug 2（translate 节点 model=None）**：根因 `computeUsage()` 返回对象无 model 字段。修复：`computeUsage()` 加 model 参数。历史数据 0 计费无法回填，只能从修复部署后开始正确记录。
- **2026-09-13（手动补数据 + M1 三问分析，🎉 100+ 达成）**：稀疏手动触发策略（每次 1 个、间隔 10 分钟）两轮共 14 run（13 成功 1 失败，92.9%）。总 run 92→108，done 87，完成率 79.8%，总成本 $5.55。三问分析详见 #39。
- **2026-09-14（02:44 UTC，✅ 整体健康，M1 目标达成）**：总 run 125，done 100（80.0%），总成本 $5.5745。最近24h ①写草稿 24/24 done（100%）；③短视频/④批量失败主要是手动密集触发 RATE_LIMIT（cron 自动后正常）；4 条产线 0 计费 done run 全部为 0。
- **2026-09-14（15:00 UTC ②翻译专项优化）**：完成率仅 41.7%，根因 agnes free tier RATE_LIMIT 配额用完。三项优化：①代码层 withRetry 加 getDelay 回调，RATE_LIMIT 只 retry 1 次等 5 分钟（`d721fd1`）；②cron 从 `0 */4` 改成 `0 */8`；③放宽 qc criterion。根本解：升级 agnes 付费 key。
- **2026-09-16（只读体检，✅ 两 bug 修复均已验证）**：四产线 09-14 后 run 分布；halted_reason 落盘验证 ✅（PR #272）；translate model=NULL 修复验证 ✅；gate/qc done 节点均有非零 cost/model。全库 total runs=211 / done=174。
- **2026-09-17（02:52 UTC，✅ 整体健康）**：累计①≈97%、②≈54%、③≈84%、④≈81%。成本合计 $8.9805，③短视频 $8.6444（96.3%）。节点级 error_code：RATE_LIMIT 18、VALIDATION 3、TIMEOUT 3；今日 cron 自动触发无新 RATE_LIMIT。
- **2026-09-17（06:47 UTC ②翻译降频窗口专项复核，✅ 配额问题已压住）**：窗口内 8 run = done 5（62.5%），09-16 00:00 起连续 4 个 cron run 全 done。新发现（非配额）：两条 halted 的 QC 判定为"模型反问要初译稿、未翻译原文"，建议查 intake/brief 原料注入与空输入兜底。
- **2026-09-18（Windows 设备，⛔ 授权阻塞）**：SSH 公钥未授权、/login 需登录、/metrics 仅进程级计数，未取到分产线数据。
- **2026-09-18（07:52 UTC Mac SSH 补做，✅ 四产线全绿）**：health commit=`440ede9` db=ok；全库 270 runs = 231 done / 29 failed / 3 halted / 7 interrupted。降频窗口完成率①97%/②73%/③100%/④100%；近 25h 四产线共 31 run 全 done；②翻译自 09-16 00:00 起连续 7 个 cron run 全 done，"未翻译反问"未复现（间歇性根因未修但被降频压住）。成本合计约 $10.67，③短视频 $10.27（96%）。


---

## Recently shipped 滚动归档（2026-09-18 晚）

> 以下 3 条原为 handoff.md 主文件「Recently shipped (last 6)」第 4–6 条（2026-09-16/17，均已合 dev）。主文件只保留最近 6 条，滚入本归档；commit / PR 信息原样保留。

- **feat(core,server,web) 竞品痛点执行核心四项收口：G2.2 契约接线 / G1.2 节点 fork / G3 重试下放 / G4.4 视频轮询（2026-09-17，工作分支 feature/20260824，5 个原子 commit，已随 PR #325 合 dev，merge `fb00657`）**——把 #55「明确留待」里不卡外部、空契约/默认值向后兼容、对 M1 回采零影响的四项点亮，详见 Active work「#55 续」与设计文档实施进度表。**G2.2** `c7beaea`：core `ErrorCode` 扩 `SCHEMA_VIOLATION`，engine 在唯一发包出口 `sendPackets` 开头加 `enforceContract` 闸门（finally 兜底末端节点），违例删产物+failed+拦截 flow 包、确定性失败不重试、error 边可 catch，9 测；Inspector 契约 hint 改「已生效」。**G1.2** 后端 `3621db7` + 前端 `8dc75aa`：`engine.fork()` 复用 fork 点及全部上游（零成本 `reused:true` 合成事件、不计费）、只重跑其 flow 下游，新 run 继承 `budget_usd`、`trigger="fork"`，`POST /api/runs/:id/fork`，时间线成功节点加「从此处重跑」按钮 + reused「复用」角标，后端 8 测/前端 3 测。**G3** `ae31c38`：核查确认后端 retry 策略与 run 预算 UI 早已端到端，真正缺口是前端配置；新增共享 `RetryField` 挂到 7 类节点（textGen/http/code/translate/search/notify/vcs），clamp [0,10]、文案区分 infra 重试与质检返工，2 测。**G4.4** `dfebcca`：Worker 加可选 `submitVideoJob`/`queryVideoJob` 接缝，videoGen 支持「提交→指数退避轮询→5min 超时」，缺一方法字节级回退同步；**当前无 provider 实现、生产仍走同步，跨 run 断点续跑随 G4.2**，5 测。验证：四包 typecheck 绿，core 20 文件 275 / server 150 文件 1232 / web 100 文件 1910 / mcp 3 文件 71 = **273 文件 3488 测全过**，i18n 守护绿。
- **feat(core,server,web) 竞品痛点 P0 安全子集：步级 run 时间线只读链路 + 契约/超时纯函数（2026-09-16，工作分支 feature/20260824，3 个原子 commit，已随 PR #319 合 dev，merge `4163efb`）**——竞品调研（Dify/Coze/n8n 等）头号痛点"不可观测、调试靠猜"的**只读侧**应对，详见待办 #55 与 `docs/design-step-trace-and-robustness.md`。core `04a1a55`：`buildTimeline(events)` 事件溯源投影（节点×attempt×variant 聚合状态/耗时/token/成本/score/gate 裁决/错误码/输出预览/工具产物，tokens/cost 只计每节点最后一次 attempt、重试不重复计费）+ `validateContract`/`coerceOutputObject`（G2.1，**纯函数未接线**）+ `isTimedOut`/`remainingMs`/`deadlineAt`（G4.1，**纯函数未接线**），共 24 单测。server `02f5b65`：只读 `GET /api/runs/:id/timeline`（viewer 授权、**无 DB 迁移**、从 run.snapshot best-effort 解析节点名/kind），3 HTTP 测（401/主投影/404 跨用户）。web `4aba58d`：运行历史每行"步骤/Steps"按钮内联只读时间线 `RunTimelineView`（每节点全部 attempt 含重试、状态徽章、耗时/model/token/成本/评分、gate ✓✕、错误码+信息、输出预览、工具/产物数、合计与预算熔断警告），zh/en i18n + 复用设计 token 的 CSS，组件 2 测、RunHistory 既有 40 测无回归。四包 `pnpm -r typecheck` 绿。**改 run 执行状态机的 G1.2 fork / G2.2 契约接线（待定是否扩 ErrorCode 加 SCHEMA_VIOLATION）/ G4.2 timeout+degraded 等高风险项明确留待，防打断 Hasee M1 回采。**
- **feat(web,server) 五项产品体验补强一口气落地（2026-09-16，工作分支 feature/20260824，5 个原子 commit，已随 PR #319 合 dev，merge `4163efb`）**——从真实使用缺口 grep 出并补齐：①**版本 diff 视图**（`99d2cfd`）：新纯函数 `lib/graph-diff.ts`（`diffGraphs` 按节点 id/边 from-to-kind 比对，输出 nodesAdded/Removed/Changed 含叶子级 FieldChange[]、edgesAdded/Removed、triggers/variables 变更、identical；`formatDiffValue` 紧凑展示），VersionPanel 加 A/B 双槽"版本对比"模式 + 新增（绿）/删除（红）/修改（黄）分组 overlay，x/y 聚合为"画布位置"、边用 id→name 显示，8 单测 + 组件 4 测。②**产线列表搜索 + 收藏置顶**（`73d5db8`）：GraphSwitcher Popover 顶部名称大小写不敏感搜索 + 每行 ★ 收藏，收藏 id 存 localStorage `aw-pinned-graphs`（try/catch 容错），收藏按收藏顺序钉顶、非收藏保持原序（不破坏既有顺序断言），11 测。③**run 历史全文搜索**（`175abaf`）：listRuns 加 `q`（graph 名 OR node_runs.error/output，PG ILIKE / SQLite LIKE，COUNT 查询同步补 LEFT JOIN graphs 否则计数崩），/api/runs 透传，RunHistory 加 300ms debounce 搜索框，server +4 / web +3 测。④**失败 run 智能诊断**（`2afe69a`）：新 `packages/server/src/diagnose.ts`（`buildFailureInfo` 从事件 + snapshot 蒸馏失败节点/错误码/生命周期轨迹、`buildDiagnosisPrompt` 中文根因+修复步骤 prompt、`diagnoseRun` 在 runAsUser 上下文用用户 defaultModel 调 worker），`POST /api/runs/:id/diagnose`（requireRun viewer，provider/配额失败返 503 不 500），RunHistory failed 行加"智能诊断"按钮 + 内联结果面板（再次点击收起、失败显提示），server 6 测 + web 4 测。⑤**Excel .xlsx 读取**（`1bf45f9`）：parseDocument 加 xl/ 分流与 parseXlsx（fflate 解包；sharedStrings 含富文本 r/t 拼接、inlineStr、数字/布尔、A1 坐标空列补齐、CSV 转义；workbook.xml + rels 按工作簿顺序取 sheet 名，缺 rels 回退 sheetN 数字序；多 sheet 复用 `===== Sheet: 名 =====` 分隔，表格转 CSV 可直接喂 table 节点），SourceFiles accept/白名单加 .xlsx，格式文案 zh/en 同步，server 5 测 + web 2 测。**验证**：四包 typecheck 绿、i18n 守护绿、server 全量 145 文件 **1202 全过**、web `--no-file-parallelism` 顺序 98 文件 **1898 全过**。**已随 PR #319 合 dev（merge `4163efb`，2026-09-16 16:44 UTC），Hasee 由 self-hosted runner 自动部署。**
