# Handoff

State of Agent World as of 2026-08-31.

> **历史内容已归档**：2026-08-27 之前的全部变更记录、各阶段详细描述、质量门与已知 gap，已整体搬到 [docs/handoff-archive.md](docs/handoff-archive.md)。本文件只保留"项目当前状态 + 活跃任务 + 最近 5 个变更"。

## Project documents

完整索引（按读者分类 + 现行/历史/归档标注）见 [docs/README.md](docs/README.md)。核心文档直达：

* [PRD.md](PRD.md) — phased roadmap and architectural guardrails

* [README.md](README.md) — two core design decisions, layout, running instructions

* [docs/technical-design.md](docs/technical-design.md) — architecture, data models, API

* [docs/roadmap-generalization.md](docs/roadmap-generalization.md) — 通用化路线图（当前主线，5 阶段）

* [docs/deferred-items.md](docs/deferred-items.md) — 缓做/低优事项登记表（挂起项 + 触发条件的单一事实源）

* [docs/security-audit-2026-08-31.md](docs/security-audit-2026-08-31.md) — 安全审计报告 + 修复方案（3 Critical / 10 High / 8 Medium / 8 Low，**29 项全部修复**；含两条旧"已解决"结论的更正）★

* [docs/design-at-rest-encryption.md](docs/design-at-rest-encryption.md) — 静态加密设计（settings / webhook secret 落盘 AES-256-GCM；审计 L3，已落地）

* [docs/design-mcp-server.md](docs/design-mcp-server.md) — MCP Server 设计方案（让其他 AI 客户端接入 agent-world）

* [docs/design-artifact-display.md](docs/design-artifact-display.md) — 产物统一渲染卡设计（ArtifactCard + 渲染器注册表；已落地）

* [docs/design-artifact-attribution-repo.md](docs/design-artifact-attribution-repo.md) — 产物归属 + 按流水线分组成品仓库设计（已落地）

* [docs/design-code-sandbox.md](docs/design-code-sandbox.md) — 代码节点运行沙箱（P0/P1/P2 + fs/net 策略 + net allowlist SSRF 校验代理全部落地；docker 容器后端待办）

* [docs/design-templates.md](docs/design-templates.md) — 产线模板体系增强（老用户入口/覆盖面/参数化已落地，市场缓做；§6 = 分类分组展示与 `TEMPLATE_CATEGORIES` 单一事实源）

* [docs/design-versions.md](docs/design-versions.md) — 产线版本管理补强（自动快照/run 关联 hash/恢复预览已落地，diff 缓做；A/B 实验为独立特性已落地另见 design-ab-testing.md）

* [docs/phase4-design.md](docs/phase4-design.md) — Phase 4 高级编排落地方案（六项已落地，状态机缓做）

* [docs/feedback-workflow.md](docs/feedback-workflow.md) — owner 怎么高效反馈给我（截图 / computer-use / 防丢）

* [docs/template-checklist.md](docs/template-checklist.md) — 产线模板验证与评估待办表（逐模板真实狗粮验证状态，当前 27 个；**新增模板必登记**，与 core TEMPLATES 数对账）★

* [docs/handoff-archive.md](docs/handoff-archive.md) — historical changes (pre-2026-08-27)

* [PRODUCT\_STRATEGY.md](PRODUCT_STRATEGY.md) — 产品策略汇总（成本/部署/定价/商业化决策基线）

## Current state

* **Monorepo**：`packages/core` / `packages/server` (Node + sqlite, 端口 8791) / `apps/web` (Vite, 端口 5173)

* **核心能力**：4 类 AI 节点（agent / imageGen / videoGen / audioGen）+ **通用节点（HTTP 请求 / 代码执行 / 条件分支 / 映射 / 循环 / 并行聚合 / 表格处理 / 数据库查询 / 文件解析 / 翻译 / OCR / 文件转换 / 搜索 / 通知）**，节点类型共 25 种（`NodeKind`，按 `NODE_CATEGORIES` 五组：AI 加工 5 / 车间调度 6 / 物料处理 7 / 外接设备 5 / 投料出料 2），**Phase 4 编排能力全部落地（2026-08-30 复核）：人工审批 human 节点 / subprocess 子流程调用 / graph 变量跨 run 持久化 / error 边 + catch 容错路径 / 失败级联 skip / 节点级重试基建（search/http/code/translate）/ 失败告警 + rerun；状态机按决策缓做**，**MCP Server（stdio + HTTP/SSE 双传输，15 工具 + resources + prompts + 实时 notifications 桥接 + Authorization Bearer 认证，P0-P2 全部落地）**，多产线管理，Inspector 模型下拉严格按 modality 过滤，多模态产出（Artifact 分层），流式 + SSE + 断线重连 + halt/resume，成本电表（token + 单价两种模式），评估体系雏形，产物落库归属流水线（artifacts 的 graph\_id/role），**版本管理补强（2026-08-30）**：保存前自动快照（节流 + 每图滚动保留 30 条）+ 版本与最近 run 的 content hash 关联标记 + 只读恢复预览（结构摘要 + SVG 缩略图），**模板参数化全链路（2026-08-30）**：TemplateField 实例化应用（core）+ fieldValues API（server）+ TemplateFieldDialog 参数表单（web 双入口，4 个 HTTP 模板声明 URL 字段），**术语表弹窗（2026-08-30）**：GlossaryModal 标准术语 ⇄ Agent World 游戏化用词对照（design-glossary.md 单一事实源），**Inspector 交互修复（2026-08-30）**：面板改为显式**点击**节点才展开、拖拽节点不再误弹（store.inspectorOpen 信号驱动），**模板能力释放（2026-08-31）**：18 个实用模板覆盖主要节点能力（含 loop 批处理 / vcs / convert+ocr / search+TTS），现有模板容错加固（error 边兜底），routingWorker 补视频音频路由（此前 videoGen/audioGen 生产被静默跳过），**模板分类展示（2026-09-01）**：业务模板增至 27 个（覆盖 25 种节点类型中的 23 种），分类收口为 core `TEMPLATE_CATEGORIES` 有序 11 类，TemplatePicker 改为按分类分组滚动、空白画布钉在最前（design-templates §6）

* **安全基线（本轮升级）**：⚠️ **2026-08-31 全量审计推翻两条旧结论**——"DNS-rebinding 免疫"实际是 check-then-fetch 双解析（仍可绕），"webhook 强制 secret"只覆盖单条路由（图保存路径可绕过），另发现 3 Critical / 10 High。**29 项已全部修复**（含低优项），报告见 [docs/security-audit-2026-08-31.md](docs/security-audit-2026-08-31.md)。其中**静态加密（L3）**：settings（provider apiKey）与图文档 webhookSecret（graphs.doc / graph_versions.snapshot / runs.snapshot）落盘前 AES-256-GCM 加密（`enc:v1:` 前缀，密钥走 `AGENT_WORLD_ENCRYPTION_KEY` 或 0600 `.encryption-key` 文件，旧明文 lazy 迁移兼容），设计见 [docs/design-at-rest-encryption.md](docs/design-at-rest-encryption.md)。~~旧基线描述保留为历史记录~~：settings 按用户隔离 ✓、Secure cookie ✓、`ALLOW_PRIVATE_NETWORK` 逃生口 ✓、代码沙箱 P0-P2 基建 ✓（默认后端 fail-open 已改 fail-closed，审计 H8）

* **本轮已落地（2026-08-29，均已提交）**：

  * **账号系统 / 按用户隔离**（`5b81c74` + `73d3610`）：users 表 + JWT(HS256, bcrypt12) HttpOnly cookie 会话 + graphs/runs/artifacts/brand\_terms/成本全部按 `user_id` 过滤 + 前端登录/注册/用户菜单 + `authFetch(credentials:include)`。旧库升级自动回填归属（迁移 14/15 幂等，无法归属的行 fail closed 不可见）

  * **产物统一渲染**：`artifact-renderers.tsx`（ArtifactCard 外壳 + 7 类渲染器注册表 + JSON 树 + 共享 renderMarkdown），Inspector/成品面板/画廊三处接入，画廊按流水线分组，节点缩略图

  * **UI 布局交互**：Inspector 可拖拽调宽（localStorage 持久化）、CanvasToolbar 置顶、Inspector 随节点选中自动开合、成品库改版

  * **安全加固**（`17dfbf9`/`299dc63`/`c0dd67d`）：删除死代码 SKIP\_AUTH；artifacts 读写全部按用户归属（堵跨用户读取/下载）；`/api/proxy` 要求登录 + 拒绝内网地址 + 重定向逐跳复检（堵未认证 SSRF）。遗留决策项见"待办"第 4 条

  * **MCP Server P1 增强**：Streamable HTTP/SSE 传输（`POST /mcp` JSON 或 SSE 按 Accept、`GET /mcp` SSE 宣告 endpoint；`AGENT_WORLD_MCP_TRANSPORT=http` 切换）、Resources（`resources/list`/`templates`/`read`：graph:// run:// artifact:// 三类 URI 模板）、Prompts（3 个引导提示词，参数插值）、initialize 能力声明 tools+resources+prompts；协议级测试 22/22 + 真实 socket 冒烟

  * **代码节点沙箱 P0**（`6b2f92b`）：env 只透传 `SAFE_ENV_BASE` + 节点声明的 `env` 白名单；解释器用 `resolveInterpreter` 启动时解析绝对路径并缓存；每次运行独立 `/tmp/aw-code-<run>-<node>-<attempt>-*` 临时目录做 cwd，成功/失败/超时全部 `finally` 清理。测试 405 → 411 通过

* **关键文件**：

  * `apps/web/src/components/Inspector.tsx` — 节点详情面板（model select 严格按 modality 过滤；产物走 ArtifactCard）

  * `apps/web/src/lib/artifact-renderers.tsx` — 统一产物渲染

  * `apps/web/src/components/ProductGallery.tsx` — 成品库（kind 过滤 + 按流水线分组）

  * `apps/web/src/components/Settings.tsx` — 模型/provider/单价管理

  * `apps/web/src/components/Canvas.tsx` — 画布（undo/redo/缩略图/拖拽/对齐）

  * `apps/web/src/components/GraphSwitcher.tsx` — 多产线切换

  * `apps/web/src/components/Onboarding.tsx` — 首次启动引导

  * `packages/server/src/auth.ts` — JWT 签发/校验、密码哈希

  * `packages/server/src/db.ts` — 持久化（users 表 + 按 user\_id 隔离 + 迁移 1-16）

  * `packages/server/src/code-sandbox.ts` — 代码节点沙箱工具（P0：解释器路径缓存 + 工作目录创建清理；P1：rlimit 包裹 + Node permission；P2：可插拔后端）

  * `packages/server/src/code-proxy.ts` — net allowlist 的 SSRF 校验代理（常驻单例 + 一次性 run token + allowlist/内网双重校验 + 审计日志）

  * `packages/server/src/ssrf.ts` — 出站请求 SSRF 防护（proxy + HTTP 节点共用，解析后 IP 校验）

  * `packages/server/src/user-context.ts` — AsyncLocalStorage 按异步上下文归属用户（运行期配置解析）

  * `packages/core/src/` — 领域模型、Provider 抽象、Artifact、节点契约

  * `packages/server/src/` — 持久化、events API、调度

## Active work / 待办

按优先级降序，标 `★` 的是当下要推的：

1. ✅ **自动数据接入 Connector + 触发方式（2026-08-31 立项，2026-09-01 推进）**：file/http/form/manual 本已落地，本次补齐 **SQLite database connector**（`9657538`+`9003120`，见 design-connector-database.md）；4.6 webhook/cron/event/batch 本已全链路落地，本次挖出并修复 **event 成功状态契约 bug**（`e9b55ae`，引擎发 `done` 而触发层等 `completed`，见 design-triggers.md）。**两者组合已是无人值守产线**；剩余仅 PG/MySQL 驱动、多实例分布式锁（均 deferred）。整体进度基线见 [docs/project-progress.md](docs/project-progress.md)
2. ★ **跑通真实产线（狗粮验证，2026-08-31 立项）**：roadmap-tasks 1.7.1——用产品自己跑一条端到端真实产线（如模板"多源研究简报"或内容产线），验证"新用户路径 → 配置 provider → 建产线 → 运行 → 看产物 → 复盘"全链路真实可用。产出：一份真实运行记录 + 暴露的体验/功能缺口清单。紧接回归测试集。**逐模板验证状态跟踪见 [docs/template-checklist.md](docs/template-checklist.md)**
   - **2026-08-31 进展（文本链路已跑通）**：跑通「短视频广告工坊」真实产线（投料→文坊脚本→成品入库→全部出厂，run `e74cba65`），文本节点真实调用 agnes-2.5-flash 产出完整口播脚本（817/186 tokens）。**过程发现并修复关键 bug**：SSRF `pinnedAgent` 用 undici 8.x Agent 传给 Node 24 内置 7.x fetch 会报 `invalid onRequestStart method`，导致所有经 guardedFetch 的出站请求失败（产线 fetch failed 根因）——依赖降到 `undici@^7.8`（7.29）后对齐，server 557/557 回归通过。
   - **2026-08-31 进展（全链路打通）**：**影坊视频节点适配完成并真实产出**（run `49e60631`，文坊脚本→画坊 PNG 1.27MB→影坊 MP4 1.9MB→成品库汇总，耗时 5m50s，UI 回放 23/23 收工）。关键点：① 产线 video 节点模型从 `agnes-video-2.5-flash` 切回 `agnes-video-v2.0`（2.5-flash 视频 API 无公开文档且实测禁 `width`/`num_frames`/`mode:ti2vid`，不可适配；v2.0 是模板默认且文档齐全）；② config.ts 新增 `ProviderConfig.videoAdapter`（createBody/omitDuration/aspectToSize/resultUrlPath），AGNES 内置配置 `{mode:"ti2vid"}` + width/height 映射 + 顶层 `url` 解析；③ 完成 URL 在任务顶层 `url` 字段（非文档所说 metadata.url），worker 轮询解析带 fallback；④ 视频轮询超时 300s→900s（agn 排队+推理实测约 5 分钟）。**另修复 artifact 落库双 bug**：`artifacts.save()` 不认本地 `/api/artifacts/` 引用导致 image/video/audio 落成 inline 空壳（图片/视频显示不出的根因）→ 识别本地引用为 `local` 存储；engine Artifact.id 跨 run 重复触发 DB 主键 INSERT OR IGNORE 吞行（后 run 产物全部丢失）→ emit 统一加 `runId` 前缀 + reconstructState 两遍扫描修复合成去重。
   - **剩余缺口**：画坊图片节点曾偶发 503（agnes 图片队列满，临时，本次已恢复）；agnes 视频生成慢（约 5-6 分钟/段，含排队），属 API 固有耗时。
   - **2026-09-01 进展（tpl-news-podcast 播客工坊 🟡，首个待办表验证，见 template-checklist）**：① 🔴 **audioGen 失败被静默吞**（run `c870fd4d`）：engine audioGen catch 分支标节点 done + 发 node.finished（engine.ts "音频生成失败（已跳过）"路径，videoGen 同款），run 判 `done` 但**无任何音频产物**——对"音频即主产物"的模板是假成功；修复方向待定（modelWarnings 升阻断 / 核心产物节点 failed 而非软跳过）。② 🔴 **search 默认 duckduckgo 无代理不可达**（run `829d23af` fetch failed）——server 出站 fetch 不支持 HTTP(S)_PROXY（undici 默认不读代理环境变量），Tavily/SerpAPI 需 env 且要重启 server；模板未声明前置条件。③ 🟡 模板默认模型 `tts-1` 不在任何 provider 清单（agnes 无 TTS 模型）。④ 🟡 文档契约错：technical-design 误写 `templateId`（实为 `template`），传错时**静默创建空产线**而非 4xx（已修文档；API 健壮性待定）。验证状态逐模板跟踪见 [docs/template-checklist.md](docs/template-checklist.md)
   - **2026-09-01 复验（四条发现全部修复闭环，见 template-checklist 复验行）**：① media modality 错配 → **派发期阻断**（`7b7faf0`，validateModels 对 imageGen/videoGen/audioGen 节点升 error，textGen 保持 warning；实测派发被拒且报错可行动）；② mediaGen 静默跳过 → **诚实失败**（`b6de7d9`，无能力/生成失败改发 node.failed，自动接入 error 边 + 失败级联，不再假成功；server 590/590）；③ search 不可达 → **可行动报错 + opt-in 代理**（`b82f89a`，`AGENT_WORLD_PROXY=http://…` 启用 undici ProxyAgent，SSRF trade-off 见 design-code-sandbox §12；裸 "fetch failed" 包装为换源/代理双选项提示）；④ DDG 反爬 → **响亮报错**（复验新发现：代理后网络通但 DDG 返回 202 anomaly 验证页且 0 结果静默成功，已改为拋错提示换源（`530bfc5`）；复验 run `d57a1b43`）。**剩余阻塞（非产品缺陷，环境侧）**：需配 TAVILY_API_KEY 等换搜索源；agnes 无音频模型需另配 TTS 供应商，否则含 search/audioGen 的模板无法出真实成品
   - **2026-09-01 进展（tpl-product 淘宝商品详情 ✅，第二个待办表验证，run `8f205215`）**：真实投料“手工陶瓷马克杯”全链路跑通——3×textGen（卖点/文案/排版）+ **双 imageGen 真实出图**（1024×1024 PNG，场景图 1.57MB / 配图 1.10MB）+ gate 一次通过。🔴 **发现并修复产物服务 bug**（`c91f973`）：生成媒体的 run 产物行只存 `up-…` 本地引用、自身桶下无字节，`GET /api/artifacts/:id` 一律 404 “blob missing on disk”——UI 上历史所有生图/视频的 run 产物均为破图（根因：`2026-08-31` artifact 落库修复把 localRef 标为 storage=local 避开 uri 分支协议白名单，但路由仍只按本行桶键找字节）；修复为引用跟随（不继承所有权，跨用户仍 404），新增 `api.artifact-localref.test.ts` 2 用例，契约写入 design-artifact-display。同类受益：tpl-xiaohongshu 等含 imageGen 模板的产物展示
   - **2026-09-01 进展（tpl-xiaohongshu 小红书种草笔记 ✅，第三个待办表验证，run `904d6a05`）**：与 tpl-product 同构，真实投料“日系复古帆布托特包”全链路跑通（双图 1024×1024 PNG + gate 一次通过），**并复验 `c91f973`**：新生成图直接 `GET /api/artifacts/:id` 返回 200 与完整 PNG，产物不再破图。无新发现（同构模板边际价值低，后续优先覆盖未验证的节点类型）
   - **2026-09-01 进展（tpl-batch-content 批量内容工坊 ✅，第四个待办表验证，run `03924415`）**：真实投 4 行清单验证 **code + map 批处理**——`split` 正确拆出 4 项 JSON、`map` 展开“映射 4 项”逐项生成简报、`writer` 一次调用产出 4 篇成稿（四个标题均命中、尾段完整无截断）、gate 一次通过。无新发现
   - **2026-09-01 进展（tpl-contract-review 合同审查助手 ❌ 真实路径不可用，第五个待办表验证，run `9b42e591`）**：🔴 **产品能力缺口**——投料节点（source）在 UI 上只接受图片（`SourceImages.tsx` 过滤 `image/*`），engine 的 source 也只产 text/image artifact；而 fileParse 只认 `kind==="file"` → 真实用户无论输入什么，该模板必失败在“上游「合同文件」没有产出文件产物”。全库仅 tpl-contract-review 受波及（另一个 fileParse 模板 doc-ingest 走 http 拉取，可正常产 file）。**引擎冒烟 27/27 为何未拦住**：`engine.fileparse.test.ts` 直接合成 file artifact 作为输入，绕过了真实上传路径——属“测试与产品契约脱节”同类问题（同 event 状态契约 `e9b55ae`）。修复方向待定：① source 支持任意文件上传（`source.files` + engine 产 file artifact + UI 附件区）；② fileParse 允许退化解析上游 text（粘贴正文即可审）；③ 改模板走 http
3. ★ ~~**回归测试集**~~（已完成，2026-08-31）：把已知 flaky（bcrypt/计时敏感用例）与核心路径做成可重复的回归基线与安全网；roadmap-tasks 5.5 登记项。目标：全量测试稳定复跑，避免"复跑即绿"掩盖真回归
   - **做法**：① `vitest.setup.ts` 全局 mock `bcryptjs`（cost-12 哈希是纯 CPU 消耗，API 层被测的是 auth 流程而非 bcrypt 本身）——注册/登录类测试提速且稳定；② `vitest.config.ts` 全局 `testTimeout:20s / hookTimeout:30s`，给 wall-clock 敏感用例（engine.code 沙箱 CPU 限时、SSE 流、retry 退避）在并行负载下留足余量；③ `engine.search` 的 PROVIDER_ERROR 用例显式 `retry:{maxRetries:0}` 去掉默认退避的真实 sleep；④ 新增 `src/regression/core-path.test.ts` 核心回归基线（compile→execute→done + rework 回环 + resume 不重复上游 artifact + 二进制 artifact 落库 sizeBytes + auth 注册/登录/受保护路由 + SSRF fail-closed），`pnpm --filter @agent-world/server test:regression` 2.8s 可跑。**结果：全量 571/571 连续 2 次复跑稳定通过**（此前 flaky 偶发 1-6 超时）。
4. ★ **模板全量测试（已完成，2026-08-31）**：25 个业务模板 + 1 个空白产线入口，引擎级冒烟全跑通。**发现并修复**：① 7 个模板 code 节点裸引用 `inputs`（沙箱不注入，真实环境必挂）→ 改 stdin 读取（`01fad6c`）；② error 边兜底被 human 挂起饿死（review-publish notifyFallback 不触发）→ finally 即时触发（`8fa86c1`）；③ code 失败误标 PROVIDER_ERROR → 独立 `SCRIPT_ERROR`（`0cbce9d`）；④ 空白产线空图崩溃 → fail-closed（回归基线守护）。回归基线扩到 11 用例。**2026-09-01 架构修正**：blankGraph 从 TEMPLATES 数组移出，单独导出 BLANK_TEMPLATE，TEMPLATES.length 恒等于真实业务模板数，getTemplate() 兼容查找 blank。**2026-09-01 新增 7 个模板**：客服工单自动处理（branch+human+notify）、代码审查助手（http+code+gate）、数据报表生成（http+code+table）、合同审查助手（fileParse+gate+human）、课程大纲生成（教育）、旅游行程规划（生活）、菜谱生成（code营养估算）。新增后共 25 个业务模板，覆盖 25 种节点类型中的 23 种（database / subprocess 无模板），其中 branch/notify/vcs/table/fileParse 等 12 种节点从单点覆盖变为双点覆盖。**2026-09-01 再增「证据清单整理」（法律合规第二模板，共 26 个）**：证据材料 → code 拆条编号（空行切分 + 中文/斜杠日期归一化，永不抛）→ table 按日期索引 → 清单起草（证明目的）→ 缺口分析（要件拆解 + 补证建议）→ 质检 gate；零凭证纯 agnes，core 形状断言 + 回归基线引擎级执行用例（真实跑 code 节点与 table 排序）。**2026-09-01 再增「费用报销初审」（财务审计首个模板，共 27 个）**：报销明细 → code 规则校验（单笔超 1000 元 / 重复单号 / 日期缺失或在未来，永不抛、保证表格至少一行）→ table 异常清单按异常数降序 → 初审报告（统计 + 异常明细表 + 处理建议）→ 质检 gate；与证据清单同构（确定性归代码、判断归模型），零凭证纯 agnes，core 形状断言 + 回归基线引擎级执行用例（真实跑规则校验与 table 排序）。整体进度见 [docs/project-progress.md](docs/project-progress.md)
5. ★ **README 演示 GIF（已完成，2026-09-01）**：`docs/images/demo-run.gif`（5帧时间轴回放，960px宽，142KB）已放入 README，替换 TODO 注释位。commit `6df0fe7`。多屏幕录屏技术笔记：screencapture -R 指定区域跨屏幕会失败（不创建文件），超大区域截图 + Pillow 裁剪到目标屏幕是稳定方案；screencapture 无 -t 选项，必须 pkill -INT 停止才写入 moov atom
6. **git push（已完成，2026-08-31）**：安全审计批次已由用户 push 到 `origin/feature/20260824` 并观察 CI；**PR #90 title/description 已同步**到引擎稳健性主线（模板 code 节点 + error 边 + 空白画布）
7. **沙箱后续（低优）**：docker/podman 容器后端（生产级隔离，net allowlist 的终极形态）——与审计第四批"隔离诚实化"合并推进
8. **模板市场（缓做）**：用户发布/安装模板，触发条件见 design-templates §4

> 全部缓做/低优事项（含上述两条）已统一登记在 [docs/deferred-items.md](docs/deferred-items.md)——每条带触发条件与决策详情链接，触发条件满足时移回本区并标注重启日期。

## Recently shipped (last 5)

按 commit 时间倒序，每条一行影响面 + commit hash：

1. `c91f973` — **fix(server)**: **生成媒体产物 404 修复（狗粮 tpl-product 驱动）**——imageGen/videoGen/audioGen 的 run 产物行只携带 `up-…` 本地引用（字节在引用行桶下），`GET /api/artifacts/:id` 在本行 blob 缺失时改为跟随引用取字节；此前 UI 上历史所有生图 run 均为破图（“blob missing on disk”）。新增 `api.artifact-localref.test.ts`（跟随成功 + 跨用户仍 404），契约写入 [design-artifact-display.md](docs/design-artifact-display.md)。
2. `7b7faf0`…`530bfc5` — **狗粮验证四条修复系列（tpl-news-podcast 驱动）**：media 节点 modality 错配派发期阻断（`7b7faf0`）；audioGen/videoGen 静默跳过改诚实失败 node.failed 接入 error 边（`b6de7d9`）；search 不可达可行动报错（`bfc97dc`）+ `AGENT_WORLD_PROXY` opt-in 出站代理（`b82f89a`，SSRF trade-off 见 design-code-sandbox §12）；DDG 反爬页响亮报错不再静默 0 结果（`530bfc5`）。
3. `docs:` **文档-代码覆盖盘点（2026-09-01）**——补齐 [design-knowledge-memory.md](docs/design-knowledge-memory.md)（知识提取/FTS5/archive_search）与 [design-ab-testing.md](docs/design-ab-testing.md)（A/B 实验，此前四处文档误标"缓做"，实已落地）；technical-design 加时效注记并补 §3.1b/§4.1b 增量（25 节点/表/API 现状对齐）；docs-README 索引、project-progress、deferred-items 同步；handoff 最近 5 条 hash 经 git log 核实已全部回填。
4. `fb05d1a` — **feat(core)**: **费用报销初审模板（会计/审计场景，共 27 个业务模板，新增财务审计分类）**——报销明细 → code 规则校验（单笔超 1000 元 / 重复单号 / 日期缺失或在未来，永不抛、保证表格至少一行）→ table 异常清单按异常数降序 → 初审报告 → 质检 gate；与证据清单同构，零凭证纯 agnes，core 形状断言 + 回归基线引擎级执行用例。
5. `353dd21` — **fix(server)**: templates-api 测试对齐空白画布排除——`54a0ddb` 拆分后 `/api/templates` 不再返回 tpl-blank，陈旧断言一直靠未重建的 core dist 假绿；改断言为"不应出现"，空字段形状断言改挂新模板。

> 更早条目（证据清单整理模板 `8747649`、event 触发状态契约修复 `e9b55ae`、客服工单模板 webhookUrl 修复 `7b3e71e`、ConnectorEditor database 分支 `9003120`、SQLite database connector `9657538`、进度基线 `064b67e`、SCRIPT_ERROR `0cbce9d`、空白产线首卡片系列 `6dcce69`/`6f51eb1`/`b82c344`/`dbe260f`/`a6e1b52`、error 边即时触发 `8fa86c1`、模板 code 节点 stdin 读 inputs `01fad6c`、空白产线首卡片 `5cbc11d`、影坊视频适配 `1358753`、undici 对齐 `4bb6168`、静态加密 `9dc68ae` 等）见 [docs/handoff-archive.md](docs/handoff-archive.md) 与 [docs/security-audit-2026-08-31.md](docs/security-audit-2026-08-31.md)。

最近 5 条之前的全部在 [docs/handoff-archive.md](docs/handoff-archive.md) 的"阶段 4 收尾"与"Additions (post-2026-08-27)"系列章节里（含 MCP stdio 分帧修复 `a2482ba`、P2 外部沙箱后端 `0a22b13`、P1 rlimit `ddb2e03`、P0 `6b2f92b`、HTTP 节点第一闭环 `1856d81`、账号系统 `5b81c74`/`73d3610` 等）。

## Quality gate (current snapshot)

> 这里的 snapshot 是"今天跑过的"状态；archive 章节里的"质量门"是各 commit 当时的状态，不要混用。

* `pnpm -r typecheck`：全绿（2026-08-31 复核：core/server/mcp-server/web tsc --noEmit 全部干净）

* `pnpm --filter @agent-world/core test`：**157/157 通过**（2026-09-01：新增模板分类分组完整性断言——每个模板 category ∈ `TEMPLATE_CATEGORIES` / 每个分类至少 1 个模板（防空区块）/ 两处收并落位 / 空白仍为「基础」且不在分组列表；此前同日新增客服工单模板 webhookUrl 字段实例化落地断言、费用报销初审模板形状断言——三类规则族齐备 + issueCount 降序排序 + rework 指向 + stdin 契约 + 空输入兜底行、证据清单模板形状断言——code/table/textGen/gate 构成 + rework 指向 + stdin 契约；2026-08-31 新增 4 用例——四大能力模板 kind 覆盖 / loop items 引用重写到新 id / doc-ingest·review-publish·scan-ocr error 边兜底 / translation 专用 translate 节点）

* `pnpm --filter @agent-world/server test`：**596/596 通过**（83 文件；Node 24 下跑。2026-09-01：狗粮修复 +8 用例——validate-models media 节点 modality 错配升 error、search 裸网络失败可行动提示 + SearchAuthError 不重试 + DDG anomaly 反爬页响亮报错（search.test.ts 新建）、api.artifact-localref 本地引用跟随 2 用例（含跨用户 404）；engine.audiogen/videogen 断言从软跳过改为诚实失败（node.failed + 下游不执行）。回归基线再 +1 用例——费用报销初审模板引擎级执行（真实跑 code 规则校验：重复单号/超额/日期缺失三类异常全命中 + 表头跳过 + table 按 issueCount 降序）；此前同日 +1——证据清单模板引擎级执行（真实跑 code 拆条 + 中文日期归一化 + table 按日期排序）；修复 templates-api 陈旧断言——空白画布拆分（`54a0ddb`）后 API 不再返回 tpl-blank，旧断言一直靠未重建的 core dist 假绿。2026-08-31 新增：at-rest 静态加密 7 单测 + 4 db 集成——磁盘无明文断言 / version·run hash 匹配 / 旧明 文兼容；api.security 审计用例；routingWorker 视频音频委托；模板参数化全链路；videoAdapter 3 用例；artifact-store 本地引用 1 用例）。此前 571/571 连续复跑稳定（vitest.setup mock bcryptjs + timeout 20s/30s 消已知负载性 flaky）。

* `pnpm --filter @agent-world/mcp-server test`：**50/50 通过**（新增 stdio 端到端冒烟 3 个：CLI 子进程真实回环 / parse error 容错 / 多字节 id 无分帧错位）
  * **负载性 flaky**：`pnpm -r test` 并行跑时这 3 个 stdio 冒烟会超 5s 默认 timeout（多包并发拖慢 tsx 子进程冷启动）；单独跑 `pnpm --filter @agent-world/mcp-server test` 稳定 50/50。要根治需给该文件单独放宽 `testTimeout`。

* `pnpm --filter @agent-world/web exec vitest run`：32/32 通过

* **注意**：依赖 `node:sqlite`，必须 Node ≥ 22（CI 用 Node 24；本地 shell 默认 Node 20 会误报 `No such built-in module: node:sqlite`，用 `fnm exec --using=24` 跑）。**P1 沙箱的实跑测试必须在 Node 24 下验证**——否则 `code-sandbox.test.ts` 的 spawnSync shell 脚本形状断言通过，但 `engine.code.test.ts` 中真正执行用户脚本时会因 `--permission` / `--experimental-permission` 形式与实际 Node 版本不一致而失败（`resolveInterpreter` 会对解释器路径做版本探针，跨版本跑会走不同分支）

## Feedback workflow

* 看到不爽：**截图 + 6 字标签**发我。详细见 [docs/feedback-workflow.md](docs/feedback-workflow.md)

* 想让我看你的 Chrome：说"computer use 看一下 \[位置]"

* 防丢：我在 "Active feedback" 区块自动记，你不用管

### Active feedback

<!-- 自动维护：用户最近反馈的未解决问题，按时间倒序 -->

## How to run

```bash
# server (background, 8791)
cd packages/server && node dist/index.js
# 或 detach 版：python3 -c "import subprocess; subprocess.Popen(['node','dist/index.js'], start_new_session=True, cwd='packages/server')"

# web (foreground, 5173 — vite.config.ts 配的)
cd apps/web && pnpm dev
# → http://localhost:5173

# 沙箱里启动 server / vite 都会被 EPERM 拒（详见 Known issues）
```

## Known issues

* **沙箱不让 listen socket**：node `dist/index.js` / `pnpm dev` / `python3 start_new_session` 起服务全部 EPERM（IPv4/IPv6 loopback 都试过）

* **沙箱不让写** **`.git/index.lock`**：`git commit` 需要 escalated 权限；escalation 通道的 token 上限是整个调用包级别，即使 `-m x` 也会被 review 拒

* **"沙箱 EPERM"在 archive 章节里出现 12+ 次**：历史上每节都重复写"未在 8791 端到端复现"，现在归档后本文件只留一次

### ⚠️ RLIMIT\_NPROC 陷阱（2026-08-29 CI 排查半天才定位，务必记住）

`ulimit -u`（RLIMIT\_NPROC）在 Linux 上限制的是**整个用户（UID）的进程+线程总数**，不是单个子进程。CI runner 上 vitest 多 worker 已让 runner 用户任务数逼近默认 128，代码节点子进程的 node 启动时创建平台线程 EAGAIN → 断言崩溃 → **SIGABRT（`r.status === null`、\~200ms 秒挂）**。症状随并发负载波动，时好时坏，极易误判为 env/stdin/挂死问题。教训：验证 shell 行为（引号等）的测试不要叠加宿主敏感的 NPROC 小值限额，用 `maxProcs: 4096` 覆盖；NPROC 生产语义由 engine 集成测试覆盖。另一个相关坑：开发机 shell 里若有本地代理（如 `HTTP_PROXY=127.0.0.1:7897`），会污染"客户端是否走代理"类的手工验证，排查前先 `env | grep -i proxy`。

## Conventions (carry over from archive)

* **commit 消息**：英文、`<type>(<scope>): <subject>` 格式；不加 `Co-Authored-By: ...`；不 `push`（除非用户明确说）

* **commit 颗粒度**：原子提交；一次 commit 解决一件事（bug 修复 / 单一 feature / 单一迁移）

* **UI 文案**：中文，遵循 `--steel-*` / `--power` / `--ink*` / `--alert` 等设计 token，**不改主题样式**

* **新增功能必加 handoff 章节**：本文件只记最近 5 个 + 待办；超过 5 个的全部进 archive

### ⚠️ server 重启 bug（2026-08-27 14:40 踩过）

`start_new_session` 起 server 时 **cwd 必须是** **`packages/server`**，不能是仓库根：

```bash
# ✅ 对的
python3 -c "import subprocess; subprocess.Popen(['node','/Users/jiangfeng/000mycodes/agent-world/packages/server/dist/index.js'], start_new_session=True, cwd='/Users/jiangfeng/000mycodes/agent-world/packages/server')"

# ❌ 错的（cwd=仓库根 → server 打开仓库根的空 agent-world.sqlite，看不到任何产线）
python3 -c "import subprocess; subprocess.Popen(['node','packages/server/dist/index.js'], start_new_session=True, cwd='/Users/jiangfeng/000mycodes/agent-world')"
```

**两个 DB 文件**：

* `packages/server/agent-world.sqlite` 180KB — 真正的数据（产线、run、artifact）

* `agent-world.sqlite` 4KB — 仓库根的"幽灵"空 DB，server 在仓库根跑就用这个

**验证起对没**：

```bash
PID=$(lsof -ti :8791)
lsof -p $PID | grep "agent-world.sqlite "   # 应该指向 packages/server/agent-world.sqlite
```

**事故原因**：之前我帮用户重启时图省事把 cwd 写成绝对路径的仓库根（因为 dist/index.js 用了相对路径 `node 'packages/server/dist/index.js'`），但 server 进程内找 DB 用 `./agent-world.sqlite`——cwd 在仓库根就直接落到根的空 DB 上。**下次绝对不能用仓库根 cwd**。

### ⚠️ server 重启：用双 fork，不要用 `start_new_session`（2026-08-27 14:43）

**问题**：`subprocess.Popen(..., start_new_session=True, cwd=...)` 起的 server 进程在 exec 退出后会被 sandbox 带走（kill 老 server → 几秒后新 server 也死）。

**解决**：Python 双 fork + `os.setsid()`，彻底脱离 process group：

```python
import os, sys
pid = os.fork()
if pid > 0: sys.exit(0)
os.setsid()
pid2 = os.fork()
if pid2 > 0: sys.exit(0)
os.chdir('/Users/jiangfeng/000mycodes/agent-world/packages/server')
log = os.open('/tmp/aw-server.log', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
os.dup2(log, 1); os.dup2(log, 2)
devnull = os.open(os.devnull, os.O_RDONLY)
os.dup2(devnull, 0)
os.close(log); os.close(devnull)
os.execvp('node', ['node', '/Users/jiangfeng/000mycodes/agent-world/packages/server/dist/index.js'])
```

**macOS 没有** **`setsid`** **命令**，但 Python 的 `os.setsid()` 等价。

**验证**：

```bash
sleep 5 && lsof -i :8791    # 5 秒后还在 → 真独立
lsof -p $(lsof -ti :8791) | grep agent-world.sqlite  # 指向 packages/server/
```

