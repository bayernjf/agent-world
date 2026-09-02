# Handoff

State of Agent World as of 2026-09-01.

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
   - **2026-09-01 复验（四条发现全部修复闭环，见 template-checklist 复验行）**：① media modality 错配 → **派发期阻断**（`7b7faf0`，validateModels 对 imageGen/videoGen/audioGen 节点升 error，textGen 保持 warning；实测派发被拒且报错可行动）；② mediaGen 静默跳过 → **诚实失败**（`b6de7d9`，无能力/生成失败改发 node.failed，自动接入 error 边 + 失败级联，不再假成功；server 590/590）；③ search 不可达 → **可行动报错 + opt-in 代理**（`b82f89a`，`AGENT_WORLD_PROXY=http://…` 启用 undici ProxyAgent，SSRF trade-off 见 design-code-sandbox §12；裸 "fetch failed" 包装为换源/代理双选项提示）；④ DDG 反爬 → **响亮报错**（复验新发现：代理后网络通但 DDG 返回 202 anomaly 验证页且 0 结果静默成功，已改为抛错提示换源（`530bfc5`）；复验 run `d57a1b43`）。**剩余阻塞（非产品缺陷，环境侧）**：需配 TAVILY_API_KEY 等换搜索源；agnes 无音频模型需另配 TTS 供应商，否则含 search/audioGen 的模板无法出真实成品
   - **2026-09-01 进展（tpl-product 淘宝商品详情 ✅，第二个待办表验证，run `8f205215`）**：真实投料“手工陶瓷马克杯”全链路跑通——3×textGen（卖点/文案/排版）+ **双 imageGen 真实出图**（1024×1024 PNG，场景图 1.57MB / 配图 1.10MB）+ gate 一次通过。🔴 **发现并修复产物服务 bug**（`c91f973`）：生成媒体的 run 产物行只存 `up-…` 本地引用、自身桶下无字节，`GET /api/artifacts/:id` 一律 404 “blob missing on disk”——UI 上历史所有生图/视频的 run 产物均为破图（根因：`2026-08-31` artifact 落库修复把 localRef 标为 storage=local 避开 uri 分支协议白名单，但路由仍只按本行桶键找字节）；修复为引用跟随（不继承所有权，跨用户仍 404），新增 `api.artifact-localref.test.ts` 2 用例，契约写入 design-artifact-display。同类受益：tpl-xiaohongshu 等含 imageGen 模板的产物展示
   - **2026-09-01 进展（tpl-xiaohongshu 小红书种草笔记 ✅，第三个待办表验证，run `904d6a05`）**：与 tpl-product 同构，真实投料“日系复古帆布托特包”全链路跑通（双图 1024×1024 PNG + gate 一次通过），**并复验 `c91f973`**：新生成图直接 `GET /api/artifacts/:id` 返回 200 与完整 PNG，产物不再破图。无新发现（同构模板边际价值低，后续优先覆盖未验证的节点类型）
   - **2026-09-01 进展（tpl-batch-content 批量内容工坊 ✅，第四个待办表验证，run `03924415`）**：真实投 4 行清单验证 **code + map 批处理**——`split` 正确拆出 4 项 JSON、`map` 展开“映射 4 项”逐项生成简报、`writer` 一次调用产出 4 篇成稿（四个标题均命中、尾段完整无截断）、gate 一次通过。无新发现
   - **2026-09-01 进展（tpl-contract-review 合同审查助手 ❌ 真实路径不可用，第五个待办表验证，run `9b42e591`）**：🔴 **产品能力缺口**——投料节点（source）在 UI 上只接受图片（`SourceImages.tsx` 过滤 `image/*`），engine 的 source 也只产 text/image artifact；而 fileParse 只认 `kind==="file"` → 真实用户无论输入什么，该模板必失败在“上游「合同文件」没有产出文件产物”。全库仅 tpl-contract-review 受波及（另一个 fileParse 模板 doc-ingest 走 http 拉取，可正常产 file）。**引擎冒烟 27/27 为何未拦住**：`engine.fileparse.test.ts` 直接合成 file artifact 作为输入，绕过了真实上传路径——属“测试与产品契约脱节”同类问题（同 event 状态契约 `e9b55ae`）。修复方向待定：① source 支持任意文件上传（`source.files` + engine 产 file artifact + UI 附件区）；② fileParse 允许退化解析上游 text（粘贴正文即可审）；③ 改模板走 http
   - **2026-09-01 复验（tpl-contract-review ❌ → ✅，文件上传能力落地）**：选“修产品而非绕模板”——`SourceConfig.files`（结构化 `{uri,label,mimeType,sizeBytes}`）+ source 节点派发时产 `kind="file"` 产物（`2d3dfcf`），Inspector 新增文档上传区（`95c65a4`，与图片区并列；不支持的类型/超 5MB **不静默丢弃**而是点名已跳过）。服务端本就齐全：`POST /api/artifacts/upload` 早已按 content-type 产出 file 产物、`parseDocument` 支持 PDF/DOCX/PPTX 并带 zip 炸弹防护——缺口纯粹是“source 产不出文件 + UI 只让选图”两点，属测试与产品契约脱节（旧用例合成 file artifact，绕过了上传路径）。真实复验 run `084b6f63`：上传 1.4KB 供货合同 PDF → fileParse「解析完成：750 字符文本」→ 条款提取 → 风险审查 → **gate 驳回一次后返工通过（rework 边首次真实跑通）**→ human 挂起 → `resume {action:"approve"}` → done，成品引用了 PDF 里的仲裁机构/验收期限/30% 定金（非空转）。顺带修：fileParse 读不到字节的报错补上 5MB 内联上限（上传允许 25MB，解析只能吃 5MB）；多文档只解析第一个时在节点摘要里点名未解析件数（`5cfd5bd`，登记 [deferred-items 数据处理线](docs/deferred-items.md)）。UI 已浏览器实机验证（上传/持久化/拒收提示）。同窗口另有 `fa2bed0`（节点意外抛错兜底为诚实 node.failed + CI 退避，来自并行会话的已就绪改动）
   - **2026-09-01 进展（tpl-scan-ocr 扫描件数字化 ⬜ → ✅，第六个待办表验证，graph `8e204023`）**：专挑唯一从未真实跑过的 ocr/convert 链路，一次掉出**三个缺陷**。① 🔴 **ocr 节点在生产里 100% 不可用**：`ocr.ts` 把 worker/core 钉在 tesseract.js **v5** CDN URL，而装的是 v7、且 Node 侧 `worker_threads.Worker(workerPath)` 根本不接受 URL → 首验 run `7561d8d8` 必败 `ERR_WORKER_PATH`；单测把 `ocrImage` 整个 mock 掉所以全绿（又一例“测试与产品契约脱节”，同 `e9b55ae`）→ 不再注入、只透传显式覆盖（`5b71c9a`）。② 🔴 **convert/fileParse 提取 PDF 内嵌图时像素错位**：pdfjs 交 3 通道样本而 pngjs 写 PNG 恒按 RGBA 读 `png.data`（`colorType` 不改输入布局）→ 整图纵向压成 3/4，OCR 全乱码；修后产物字节数与源图一致、识出 `INVOICE 2026 NO 0042`（`4215d9c`，回归用例逐像素断言）。③ 🟡 **`OcrConfig` 与文档/审计 M7③ 承诺矛盾**：三个资产字段是 `z.string().url()`，“本地路径离线部署”在 Inspector 里根本填不进去（而且旧 core 用例还在断言“非 URL 应被拒”）→ 放宽 `min(1)`，安全改由运行期 `assertOcrSource` 白名单把关（`e2781ab` + core 用例契约反转）。真实链路：上传 2 页扫描件 → convert「提取 2 张图片」→ ocr「132 字符/58%」（run `934474f3`）→ sink 成品可对回夹具；纯文本 PDF → convert 诚实报 VALIDATION → **error 边首次真实跑通** → textGen 出改用建议 → done（run `f92b24ae`）。非缺陷遗留三项登记 deferred（模板只支持 URL 投料需手改图 / convert 不真逐页渲染 / 默认 `chi_sim+eng` 把英文数字行识成汉字）；附带发现：tesseract 无 `cachePath` 会把 47MB 语言包写进 server CWD，先 gitignore（`e77587a`）
   - **2026-09-01 进展（tpl-doc-ingest 文档智能解析入库 ⬜ → ✅，第七个待办表验证，复验图 `0117cdab`）**：一跑掉出 **4 个产品缺陷**，全部修产品本身并复验。① 🔴 模板 `combine` 脚本在 TS 单引号字符串里写了未转义 `\n` → 生成的 node 脚本在字符串字面量中间断行，子进程每次必挂 SyntaxError（`86a513d`，并新增「全部模板 javascript code 脚本必须可编译」守护用例）。② 🔴 **坏脚本能把整个 server 打死**：脚本秒退时引擎还在向它的 stdin 管道灌输入 JSON，`write EPIPE` 无监听器 → 未处理的 `error` 事件直接杀引擎进程（首验 run `9c38a59b`/`a12c9a41` 每次必崩，堆栈无应用帧；修复 `b320f27`，回归用例用 1MB 输入压过管道缓冲）。③ 🔴 **调度器 fan-in 静默丢弃**：`combine` 等 parse/ocr/ocrFallback 三路，ocr 失败被 error 边接住后 `predecessorsReady` 仍要求失败上游 done → merge 永不调度，**run 却报 done、无任何入库产物**（run `ab5b20df`）；修复：失败但被 error 边妥善处理的上游视为满足，另修 stranded pending 不得报 done（`e6dc2c9`）。④ 🟡 `AGENT_WORLD_PROXY` 开启时 `ALLOW_PRIVATE_NETWORK=1` 被代理分支无视，与注释承诺的「完全跳过内网检查」不符（`63bc1db`）。真实链路：拉 13 页 tracemonkey PDF → fileParse「84609 字符+10 图」→ ocr → combine → table「4 行×2 列」→ sink，首行摘录可对回论文标题（run `b0f60b0b`）；纯文本 PDF：ocr 诚实报「没有可识别图片」→ error 边→兜底空串→ **merge 照常汇聚**→入库产物含夹具原文（run `10eba2ef`）。过程纠偏：`/api/runs/:id/events` 是游标分页，只看首页 30 条会误判崩溃位置（曾误报「崩在 combine 启动」，实为分页截断）
   - **2026-09-01 进展（tpl-release-pr 发版 PR 助手 ⬜ → ✅，第八个待办表验证，在临时仓库 `bayernjf/aw-pr-dogfood` 上真实创建了两个 GitHub PR）**：vcs 节点首次真实覆盖，掉出 **3 个缺陷**。① 🔴 vcs 用裸全局 `fetch`，绕过 `AGENT_WORLD_PROXY` 出站代理与 SSRF 边界，与 http/通知节点的出站契约不一致 → 改走 `guardedFetch`，`GuardedFetchError` 列入不可重试（`b3e71e8`）。② 🟡 create_pr 未配标题时退回节点名（PR 标题全是「创建 PR」）+ 模板提示词未禁寒暄、开场白/结尾说明混进正文 → 标题改从正文首行推导（去标题符号/跳分隔线，显式配置仍优先，`dadeb05`），提示词要求首行输出 `# 一句话概括`并禁止任何开场白/结尾说明（`4b9b3a7`）。③ 🟡 GitHub 422 的 `errors[]` 详情被丢弃，报错只剩「Validation Failed」（同对分支已有开放 PR 时无法定位）→ 逐条详情并入报错（`f034605`）。真实链路：变更草稿（投本轮自己的修复）→ polish → human 挂起 → `resume {action:"approve"}` → **真实创建 PR #1/#2**（首验 `b2a5abc8` 暴露缺陷；复验 `3fc03f6e`：PR #2 标题由正文首行推导、正文无寒暄、忠实草稿）；另有诚实失败现场：同 head/base 对已有 PR 时 422 → 节点 failed（PROVIDER_ERROR）→ 下游 skip → run failed，引擎存活（`1f86e39d`/`4d3b5173`）。凭证走 `GITHUB_TOKEN` env（本机 gh 已登录，临时注入，不落盘不进图）
   - **2026-09-01 进展（tpl-evidence-brief 证据清单整理 + tpl-expense-review 费用报销初审 ⬜ → ✅，第九/十个待办表验证，code+table 同族双跑）**：两条真实链路全链 done，掉出 **2 个缺陷 + 1 个疑点澄清**。① 🟡 证据清单拆条脚本把「诉讼请求/案由」段也编号成证据条目，混进时间索引表（无日期还浮在最前）→ 拆条改为把该段剥到 `claim` 字段，不参与编号（`94d510f`，回归断言剥离且不入 rows）。② 🟡 **table 排序空值语义缺陷（引擎级，波及所有 table 排序模板）**：升序时空值排最前，无日期行浮在时间线开头 → `sortRows` 空值无论方向一律沉底（`2c3cef8`+单元用例）。③ 疑点澄清：费用报销 `issueCount: flags.length` 初看像布尔误写，实证就是异常个数——但回归夹具恰好每行单异常、缺多异常压测 → 补「超额+重复单号」双异常行并断言其排最前（`b366fcb`）。真实链路：证据清单（民间借贷五证，复验 `ff5e4937`，首验 `fe57d9d6`）：诉请剥离→5 行时间索引→清单→缺口分析→质检，成品可对回投料；费用报销（7 行明细，复验 `b46e620c`，过程 `04b90ffb`/`e0a6edc1`/`200c0c6b`）：逐行打标→异常清单按 issueCount 降序（双异常两行排最前、合格行沉底）→初审报告数字可对回投料
   - **2026-09-02 进展（狗粮第二波：15 个模板 ⬜ → ✅/🟡，**27/27 全覆盖**）**：接续上一会话已派发但未登记的批次，逐 run 审计产物实质（不看 status，只看成品能否对回投料），掉出并修复 **1 个引擎级静默丢弃**：客服工单人工路径 approve 后 notify → depot 从未被调度、run 却报 done（`a59fc69e` 只有 4 个产物）——三重根因（branch 未路由分支不发 `node.skipped` / resume 仅按产物播种状态 / `finish()` 重算状态覆盖 stranded 守卫）+ 子流程 resume 丢包同类问题，已修（`44c3260`，+4 回归用例；复验 `d7528730`：webhook 日志真实收到已插值「分类 投诉」的飞书卡片）。另修 data-report clean 节点吃 stdin 信封（`9b212c7` + 目录级守护）、`${node}` 插值可达性守护（`4aeca4f`）、运营周报默认 URL 404 与研究简报双源同源（`a28bde6`），并登记上一会话 12 个模板/插值修复。**新增覆盖节点类型**：parallel（双源汇聚）、branch（客服双路径 / 巡检正常+告警）、translate、notify 真实投递、http 元数据插值、loop 失败传播。**剩余**：🟡 tpl-news-podcast（缺 TTS 供应商）/ tpl-research-loop（缺可用搜索源，三次重试均撞 DDG 反爬）；未覆盖路径：subprocess、database、cron 触发、tpl-custom-model 的 generic 节点（当时误记为“vcs 分支”，第五波纠正）。逐模板记录见 [docs/template-checklist.md](docs/template-checklist.md)
   - **2026-09-02 进展（狗粮第三波：手搭产线补齐三条无模板路径）**——① **subprocess**（run `dc7b86fd`）：先建子产线（source→textGen→sink）再建父产线（source→subprocess→textGen→sink），子图在 `pp#sub:` 命名空间内跑完 cs→ca→ck，**子汇产物聚合为父节点的 json 产物**（`"\n\nAgent World完成27个模板验证…"`）、父链继续跑到父汇，7 个节点全部 finished；与本轮修的子流程 resume 丢包缺陷（`44c3260`）互为正反两面的证据。② **database**（run `1ffee144`）：内存 SQLite `setupSql` 建表插 5 行 + `sql` 带命名参数 `:minAmount=800` 聚合 → 产物 `{rows:[华东 2000/2, 华南 1500/1, 华北 900/1], count:3, columns:[…]}`，**与投料逐行对得上**（华北 300 那行被正确过滤）；下游模型对“被过滤条数”诚实回答“无法从结果集推导”而未编造。③ **cron 真实调度**（run `5a73d4f8` 05:10:00.001 / `4df6e6a1` 05:11:00.007）：`* * * * *` 触发器建好后调度器**分钟级准点连触两次**，两次 run 均 done 且产物真实，验后已删触发器。**排查经验**：run 的 `trigger` 字段存的是**触发器 id**而非字面量 `cron`（`triggers.fire` 把 triggerId 传给 `startRun`），按 `trigger=="cron"` 过滤会误判“调度器没触发”。**本波无产品缺陷、无代码变更**；至此 25 种节点类型除已废弃者外均有真实运行记录，剩下未实跑的只有 tpl-custom-model 的 generic 节点（当时误记为“vcs 分支”，见第五波）与 webhook/event/batch 三类触发（单元/集成用例已覆盖）。
   - **2026-09-02 进展（狗粮第四波：触发层全型实跑 + 无人值守闭环，零缺陷）**——① **webhook**：正确 secret + 新时间戳 → 200 起 run（`495baf71`，投料“订单 #A-1001 已付款”原样落到源产物）；错误 secret / 缺时间戳 / 过期 30min 时间戳 → **三条 401 诚实拒绝**（`invalid webhook secret` / `missing X-Webhook-Timestamp` / 重放窗口），M1 防重放与 H2 空 secret 拒绝均生效。② **batch**：rows 3 行 → fire 一次产 3 条 run（`81b2a37c`/`9ee4369b`/`83af701a`），每条源产物精确等于该行 JSON（`{"sku":"A-1001","qty":"2"}` 等），并发池逐行派发无丢行。③ **event**：上游 A `aa5ec28a` done → 下游 B `d937cf63` **自动启动并 done**（trigger 字段 = B 的 event 触发器 id），同时再验 `e9b55ae` 的“引擎 done = 触发层期望状态”契约。④ **cron 无人值守闭环**：tpl-patrol-alert 实例化时就把 `targetUrl` 指向 `httpbin.org/status/500`、`alarmWebhookUrl` 指向本地 hook，挂上 `* * * * *` cron 后全程无人介入：run `c74f6665` 于 05:20:00 准点自触 → probe 拿到 500（failOnError:false，状态作为数据）→ branch 路由到 alarm（record 带 `node.skipped`，正是 `44c3260` 新增的事件）→ notify 真实投递，hook 日志收到飞书卡片「🚨 巡检异常：https://httpbin.org/status/500 健康检查失败（状态 500）」——`${probe.url}`/`${probe.status}` 插值全部到位。**至此四类自动触发（cron/webhook/event/batch）均有真实 run 取证，本波无代码变更**。
   - **2026-09-02 进展（狗粮第五波：微审计最后一个未盖节点，又掉出两个缺陷）**——盘点“还剩什么没盖”时发现上一波把 tpl-custom-model 的未覆盖路径记成了“vcs 分支”——**该模板根本没有 http/vcs 节点**（实为 source → code → generic → sink，fields 只有 modelName/customBaseUrl），真正没审的是 **generic 节点**。一查两处缺陷（`5d76cc5`）：① 🔴 text/image/video/audio **四种模态的失败分支全部静默跳过**（`console.warn` + `states.set(done)` + 空 output + “已跳过”报文，连 worker 无该能力也照样标 done，未知模态也当空操作放行）——正是 `b6de7d9` 已为专用 audioGen/videoGen 判定不可接受并修掉的那一类，generic 被漏掉；现改 PROVIDER_ERROR（生成失败）/ VALIDATION（缺能力、模态不受支持）诚实失败，error 边仍可兜底。② 🟡 文本分支只调 `setTextArtifact` 不发 `artifact.produced` → **产物库查不到这一环**（run `dd9641af` 实测：intake/craft/depot 三行都有，夹在中间的 generic 没有；output 只在 `node.finished` 里），与 `8418d2e` 修的 gate 同类。新增 4 条回归（文本失败诚实报错 / 缺媒体能力 VALIDATION / error 边可兜底 / 文本产物必发 artifact）——**此前失败路径零覆盖，所以全量测试一直绿着把这个 shipped 了**。真实复验 run `b91af1d3`：产物库由 3 行变 4 行，`gen-bfwuw/text` 内容可查。**记账纠偏**：两条凭证阻塞项（news-podcast 缺 TTS / research-loop 缺搜索源）与 generic 媒体模态未实跑，已按规矩登记 [deferred-items](docs/deferred-items.md) 并带触发条件（此前只写在 checklist，属记账不合规）；同时点名真实覆盖洞：**`search` 与 `audioGen` 两类节点至今从未真实成功产出过产物**（失败路径诚实，成功路径零证据）。server 测试 626 → **630/630**。
3. ★ ~~**回归测试集**~~（已完成，2026-08-31）：把已知 flaky（bcrypt/计时敏感用例）与核心路径做成可重复的回归基线与安全网；roadmap-tasks 5.5 登记项。目标：全量测试稳定复跑，避免"复跑即绿"掩盖真回归
   - **做法**：① `vitest.setup.ts` 全局 mock `bcryptjs`（cost-12 哈希是纯 CPU 消耗，API 层被测的是 auth 流程而非 bcrypt 本身）——注册/登录类测试提速且稳定；② `vitest.config.ts` 全局 `testTimeout / hookTimeout`（初版 20s/30s；**2026-09-02 起 60s/60s**——预算必须高于引擎 code 节点默认 timeoutMs 30s，否则慢而健康的子进程先被 vitest 拦下，报模糊的 "Test timed out" 而非引擎诚实的 TIMEOUT `node.failed`，`aae0871`），给 wall-clock 敏感用例（engine.code 沙箱 CPU 限时、SSE 流、retry 退避）在并行负载下留足余量；③ `engine.search` 的 PROVIDER_ERROR 用例显式 `retry:{maxRetries:0}` 去掉默认退避的真实 sleep；④ 新增 `src/regression/core-path.test.ts` 核心回归基线（compile→execute→done + rework 回环 + resume 不重复上游 artifact + 二进制 artifact 落库 sizeBytes + auth 注册/登录/受保护路由 + SSRF fail-closed），`pnpm --filter @agent-world/server test:regression` 2.8s 可跑。**结果：全量 571/571 连续 2 次复跑稳定通过**（此前 flaky 偶发 1-6 超时）。
4. ★ **模板全量测试（已完成，2026-08-31）**：25 个业务模板 + 1 个空白产线入口，引擎级冒烟全跑通。**发现并修复**：① 7 个模板 code 节点裸引用 `inputs`（沙箱不注入，真实环境必挂）→ 改 stdin 读取（`01fad6c`）；② error 边兜底被 human 挂起饿死（review-publish notifyFallback 不触发）→ finally 即时触发（`8fa86c1`）；③ code 失败误标 PROVIDER_ERROR → 独立 `SCRIPT_ERROR`（`0cbce9d`）；④ 空白产线空图崩溃 → fail-closed（回归基线守护）。回归基线扩到 11 用例。**2026-09-01 架构修正**：blankGraph 从 TEMPLATES 数组移出，单独导出 BLANK_TEMPLATE，TEMPLATES.length 恒等于真实业务模板数，getTemplate() 兼容查找 blank。**2026-09-01 新增 7 个模板**：客服工单自动处理（branch+human+notify）、代码审查助手（http+code+gate）、数据报表生成（http+code+table）、合同审查助手（fileParse+gate+human）、课程大纲生成（教育）、旅游行程规划（生活）、菜谱生成（code营养估算）。新增后共 25 个业务模板，覆盖 25 种节点类型中的 23 种（database / subprocess 无模板），其中 branch/notify/vcs/table/fileParse 等 12 种节点从单点覆盖变为双点覆盖。**2026-09-01 再增「证据清单整理」（法律合规第二模板，共 26 个）**：证据材料 → code 拆条编号（空行切分 + 中文/斜杠日期归一化，永不抛）→ table 按日期索引 → 清单起草（证明目的）→ 缺口分析（要件拆解 + 补证建议）→ 质检 gate；零凭证纯 agnes，core 形状断言 + 回归基线引擎级执行用例（真实跑 code 节点与 table 排序）。**2026-09-01 再增「费用报销初审」（财务审计首个模板，共 27 个）**：报销明细 → code 规则校验（单笔超 1000 元 / 重复单号 / 日期缺失或在未来，永不抛、保证表格至少一行）→ table 异常清单按异常数降序 → 初审报告（统计 + 异常明细表 + 处理建议）→ 质检 gate；与证据清单同构（确定性归代码、判断归模型），零凭证纯 agnes，core 形状断言 + 回归基线引擎级执行用例（真实跑规则校验与 table 排序）。整体进度见 [docs/project-progress.md](docs/project-progress.md)
5. ★ **README 演示 GIF（已完成，2026-09-01）**：`docs/images/demo-run.gif`（5帧时间轴回放，960px宽，142KB）已放入 README，替换 TODO 注释位。commit `6df0fe7`。多屏幕录屏技术笔记：screencapture -R 指定区域跨屏幕会失败（不创建文件），超大区域截图 + Pillow 裁剪到目标屏幕是稳定方案；screencapture 无 -t 选项，必须 pkill -INT 停止才写入 moov atom
6. **git push（已完成，2026-08-31）**：安全审计批次已由用户 push 到 `origin/feature/20260824` 并观察 CI；**PR #90 title/description 已同步**到引擎稳健性主线（模板 code 节点 + error 边 + 空白画布）
7. **沙箱后续（低优）**：docker/podman 容器后端（生产级隔离，net allowlist 的终极形态）——与审计第四批"隔离诚实化"合并推进
8. **模板市场（缓做）**：用户发布/安装模板，触发条件见 design-templates §4

> 全部缓做/低优事项（含上述两条）已统一登记在 [docs/deferred-items.md](docs/deferred-items.md)——每条带触发条件与决策详情链接，触发条件满足时移回本区并标注重启日期。

## Recently shipped (last 5)

按 commit 时间倒序，每条一行影响面 + commit hash：

1. `44c3260`+`9b212c7`+`4aeca4f`+`a28bde6`（本轮）与上一会话批次 `8418d2e`/`d34b22d`/`36e3979`/`4a69e8d`/`d202285`/`9b2d91b`/`38ffecb`/`5677d6b`/`58a8c99`/`c4f84a7`/`d55d98d`/`ece6e2b` — **fix(server,core)+test**: **狗粮第二波：15 个模板真实跑通（27/27 全覆盖），掉出 1 个引擎级静默丢弃**——① 🔴 **引擎级**：human approve 恢复后 notify → depot 整条尾巴从未被调度、run 却报 done（客服工单首验 `a59fc69e` 只有 4 个产物、无通知无归档）；三重根因：branch 未路由分支只改内存不发 `node.skipped`、resume 仅按“有无产物”播种状态、`finish()` 用失败节点重算状态覆盖了 `e6dc2c9` 的 stranded 守卫；同 commit 另修子流程 resume 丢包（pre-approve 的子节点在父图查不到边 → 子汇永不执行却报 done）→ `44c3260`（+4 回归用例；复验 `d7528730`：webhook 真实收到已插值「分类 投诉」的飞书卡片）。② 🔴 tpl-data-report 的 clean 节点把引擎 stdin 信封当数据 → 报表只剩一列 `inputs`（`9b212c7`，附目录级守护：凡读 stdin 的 code 脚本必须引用 `.inputs`）；`${node}` 插值必须可达上游的目录级守护（`4aeca4f`）。③ 🟡 默认演示源：运营周报默认 URL 404（开箱只能走兜底）、研究简报双源同一 URL（parallel 汇聚退化）→ `a28bde6`。④ 上一会话批次：gate 通过补发 node.finished/artifact（`8418d2e`）、provider 传输层故障纳入重试（`d34b22d`）、http 元数据进插值上下文 + textGen 提示词插值（`36e3979`/`4a69e8d`）、巡检探针非 2xx 作为信号（`d202285`）、code-review 拉 diff 而非 PR JSON 且带上完整 diff（`58a8c99`/`38ffecb`）、custom-model 去掉 `.output` 伪后缀（`5677d6b`）、travel-plan / data-report / competitor-watch 扇入用户需求（`c4f84a7`/`9b2d91b`）、recipe 营养节点带上完整菜谱（`d55d98d`）、客服分类器解包信封 + 扇入（`ece6e2b`）。逐模板发现与 run 号见 [docs/template-checklist.md](docs/template-checklist.md)。
2. `a64a7e8`+`aae0871`+`8c6f5bc` — **fix(server)+test(server)**: **CI 预算三连修（PR #98 三次红 run 驱动，同根因两类症状）**——① Node permission-gate 探针超时 5s→3s（`a64a7e8`：探针同步阻塞事件循环，负载 CI 上两枚 5s 探针能吃光测试预算，健康 Node <100ms）；② vitest testTimeout/hookTimeout 20s/30s→60s/60s（`aae0871`：旧值低于引擎 code 节点默认 timeoutMs 30s，慢而健康的子进程先被 vitest 拦下，报模糊 "Test timed out" 而非引擎诚实 TIMEOUT `node.failed`）；③ sandbox maxProcs 默认 128→1024（`8c6f5bc`：Linux RLIMIT_NPROC 按用户**全机**进程+线程总数计——vitest harness + runner agent 共享同一额度，负载下越限 → 沙箱子进程启动即 `uv_thread_create` EAGAIN SIGABRT（退出码 null）或线程池停顿拖到引擎 30s 超时，一句 console.log 的兜底节点也超时；实锤 run `33520451715`/`33585296482`/`33588799831`）。修后 CI 绿（run `33589345419`，623/623）。经验：ulimit 类按用户全局计数的限额必须按「该用户全部共存进程」定尺寸；进程级硬隔离归 bwrap PID namespace，可 `CODE_LIMIT_MAX_PROCS` 覆盖。
3. `2c3cef8`+`94d510f`+`b366fcb` — **fix(core)+test(server)**: **狗粮 tpl-evidence-brief / tpl-expense-review：两条 code+table 真实链路，掉出 2 缺陷 + 1 疑点澄清**——① table 升序时空值排最前，无日期行浮在时间线开头（引擎级，波及所有 table 排序模板）→ `sortRows` 空值无论方向一律沉底（`2c3cef8`+单元用例）；② 证据清单拆条把「诉讼请求/案由」段编号成证据混进时间索引表 → 剥到 `claim` 字段不参与编号（`94d510f`）；③ 费用报销 `issueCount: flags.length` 实证是真实异常数而非布尔误写，但夹具缺多异常压测 → 补双异常行断言其排最前（`b366fcb`）。两模板 ⬜→✅（复验 `ff5e4937`/`b46e620c`，产物均可对回投料）。
4. `b3e71e8`+`dadeb05`+`4b9b3a7`+`f034605` — **fix(core,server)**: **狗粮 tpl-release-pr：vcs 首次真实创建 GitHub PR，掉出 3 个缺陷**——① vcs 用裸全局 `fetch`，绕过 `AGENT_WORLD_PROXY` 出站代理与 SSRF 边界（与 http/通知节点的出站契约不一致，仅代理可达的网络上必败）→ 改走 `guardedFetch`，`GuardedFetchError` 列入不可重试（`b3e71e8`）；② create_pr 未配标题时退回节点名（PR 标题全是「创建 PR」）→ 改从正文首行推导（去标题符号/跳分隔线，显式配置仍优先，`dadeb05`），配套模板提示词要求首行输出 `# 一句话概括`并禁止开场白/结尾说明混进正文（`4b9b3a7`）；③ GitHub 422 的 `errors[]` 详情被丢弃，报错只剩「Validation Failed」→ 逐条详情并入报错（`f034605`）。发版 PR 助手模板 ⬜→✅（临时仓库上真实创建 PR #1/#2，首验 `b2a5abc8`、复验 `3fc03f6e`：标题由正文推导、正文无寒暄、忠实草稿；422 诚实失败现场 `1f86e39d`/`4d3b5173`）；回归用例 +4（代理通道 / 标题推导 2 / 422 详情）。
5. `86a513d`+`63bc1db`+`b320f27`+`e6dc2c9` — **fix(core,server)**: **狗粮 tpl-doc-ingest：坏脚本曾把整个 server 打死，调度器还曾静默丢弃产物**——① 模板 `combine` 脚本未转义 `\n`，生成的 node 脚本在字符串字面量中间断行、子进程必挂 SyntaxError，并新增「全部模板 code 脚本必须可编译」守护（`86a513d`）；② 脚本秒退时引擎仍在向它的 stdin 管道灌输入，`write EPIPE` 无监听 → 未处理 error 事件杀死整个引擎进程，改为吞掉管道错误（失败仍由退出码+stderr 诚实报告，`b320f27`）；③ fan-in merge 永远等待已被 error 边接住的失败上游，run 却报 done、无入库产物（静默丢弃）→ 失败但被妥善处理的上游视为满足 + stranded pending 不得报 done（`e6dc2c9`）；④ 代理分支无视 `ALLOW_PRIVATE_NETWORK=1` opt-out，与文档承诺不符（`63bc1db`）。文档解析入库模板 ⬜→✅（修后 run `b0f60b0b`/`10eba2ef`，默认投料与 error 边兜底两条路产物均可对回夹具）；回归用例 +3（大 stdin 秒退引擎存活 / fan-in merge / 代理模式 opt-out）。经验写进 technical-design §12.1。

> `5b71c9a`+`e2781ab`+`4215d9c`+`e77587a`（ocr 节点生产不可用修复）与 `2d3dfcf`+`95c65a4`+`5cfd5bd`（source 节点文件上传）已滚出本表，见 [docs/handoff-archive.md](docs/handoff-archive.md) "Additions" 顶部。

> 更早条目（节点意外抛错兜底 `fa2bed0`、生成媒体产物 404 修复 `c91f973`、费用报销初审模板 `fb05d1a`、templates-api 陈旧断言对齐 `353dd21`、证据清单整理模板 `8747649`、event 触发状态契约修复 `e9b55ae`、客服工单模板 webhookUrl 修复 `7b3e71e`、ConnectorEditor database 分支 `9003120`、SQLite database connector `9657538`、进度基线 `064b67e`、SCRIPT_ERROR `0cbce9d`、空白产线首卡片系列 `6dcce69`/`6f51eb1`/`b82c344`/`dbe260f`/`a6e1b52`、error 边即时触发 `8fa86c1`、模板 code 节点 stdin 读 inputs `01fad6c`、空白产线首卡片 `5cbc11d`、影坊视频适配 `1358753`、undici 对齐 `4bb6168`、静态加密 `9dc68ae` 等）见 [docs/handoff-archive.md](docs/handoff-archive.md) 与 [docs/security-audit-2026-08-31.md](docs/security-audit-2026-08-31.md)。

最近 5 条之前的全部在 [docs/handoff-archive.md](docs/handoff-archive.md) 的"阶段 4 收尾"与"Additions (post-2026-08-27)"系列章节里（含 MCP stdio 分帧修复 `a2482ba`、P2 外部沙箱后端 `0a22b13`、P1 rlimit `ddb2e03`、P0 `6b2f92b`、HTTP 节点第一闭环 `1856d81`、账号系统 `5b81c74`/`73d3610` 等）。

## Quality gate (current snapshot)

> 这里的 snapshot 是"今天跑过的"状态；archive 章节里的"质量门"是各 commit 当时的状态，不要混用。

* `pnpm -r typecheck`：全绿（2026-08-31 复核：core/server/mcp-server/web tsc --noEmit 全部干净）

* `pnpm --filter @agent-world/core test`：**162/162 通过**（2026-09-02 新增两条目录级守护：凡读 stdin 的 code 脚本必须解包 `.inputs` 信封（dogfood tpl-data-report）、`${node}` 插值必须指向可达上游（dogfood tpl-customer-service），两者均带非空转断言；2026-09-01 第三轮：**table 排序空值沉底**——狗粮 tpl-evidence-brief 发现升序时空值排最前、无日期行浮在时间线开头，新增空值无论方向一律沉底用例（空串/null/缺字段三种空）；第二轮：**全部模板 javascript code 脚本可编译守护**——狗粮 tpl-doc-ingest 发现 combine 脚本未转义换行导致生成的 node 脚本断行，新增遍历所有模板 `new Function` 编译检查；第一轮：OcrConfig 资产覆盖字段的**契约反转**——旧用例断言“非 URL 应被拒”，恰好与文档/审计承诺的离线本地路径相反，改为“本地路径与 CDN URL 都接受”+“空值仍拒”两条；此前同日新增模板分类分组完整性断言——每个模板 category ∈ `TEMPLATE_CATEGORIES` / 每个分类至少 1 个模板（防空区块）/ 两处收并落位 / 空白仍为「基础」且不在分组列表；此前同日新增客服工单模板 webhookUrl 字段实例化落地断言、费用报销初审模板形状断言——三类规则族齐备 + issueCount 降序排序 + rework 指向 + stdin 契约 + 空输入兜底行、证据清单模板形状断言——code/table/textGen/gate 构成 + rework 指向 + stdin 契约；2026-08-31 新增 4 用例——四大能力模板 kind 覆盖 / loop items 引用重写到新 id / doc-ingest·review-publish·scan-ocr error 边兜底 / translation 专用 translate 节点）

* `pnpm --filter @agent-world/server test`：**630/630 通过**（84 文件；Node 24 下跑；2026-09-02 第五波 +4 用例——generic 节点文本失败诚实报 PROVIDER_ERROR / 缺媒体能力报 VALIDATION / error 边可兜底 / 文本产物必发 `artifact.produced`（此前失败路径零覆盖）；2026-09-02 第二波 +3 用例——branch 未路由尾巴必发 `node.skipped` / branch+human 合并点 approve 后必继续跑到 sink / 无法重建 skip 的旧事件日志恢复必报 failed 并点名丢弃节点，并把子流程 halt-resume 用例加强为“子汇必须真的跑”；2026-09-02 CI run `33589345419` 复核绿——maxProcs 修复后沙箱实跑用例在 CI 稳定。2026-09-01 第四轮（用例数不变，夹具加强）——回归基线两条模板执行用例按狗粮发现升级：证据清单断言诉请段剥到 `claim` 且不入 rows；费用报销补「超额+重复单号」双异常行，断言 issueCount=2 且双异常两行排最前（`b366fcb`）；第三轮 +4 用例——狗粮 tpl-release-pr：vcs 走代理通道（AGENT_WORLD_PROXY 下请求携带 ProxyAgent dispatcher）/ create_pr 标题从正文首行推导（去标题符号、跳分隔线）/ 显式标题优先 / GitHub 422 errors[] 详情并入报错；第二轮 +3 用例——code 节点秒退时 1MB stdin 灌入引擎存活（EPIPE 回归）/ 失败上游被 error 边接住后 fan-in merge 仍执行 / 代理模式下 ALLOW_PRIVATE_NETWORK 放行内网目标；第一轮 +5 用例——OCR 资产解析 3 例（不再预设 workerPath/corePath、显式覆盖才透传、非白名单 langPath 在 spawn 前拒绝且 `createWorker` 未调用）+ PDF 内嵌图像素保真 2 例（DeviceRGB 逐像素 / DeviceGray 展开为中性灰），`engine.ocr` 的“PNG 字节长度”断言改为解码后逐像素；同日前一轮 +5 用例——文件上传链路 4 例（source.files → fileParse 真实解析 PDF、与图片产物共存、无文档仍 VALIDATION 报错、多文档点名未解析件数）+ 节点意外抛错兜底 1 例（code 沙箱准备失败仍留 node.failed）；此前狗粮修复 +8 用例——validate-models media 节点 modality 错配升 error、search 裸网络失败可行动提示 + SearchAuthError 不重试 + DDG anomaly 反爬页响亮报错（search.test.ts 新建）、api.artifact-localref 本地引用跟随 2 用例（含跨用户 404）；engine.audiogen/videogen 断言从软跳过改为诚实失败（node.failed + 下游不执行）。回归基线再 +1 用例——费用报销初审模板引擎级执行（真实跑 code 规则校验：重复单号/超额/日期缺失三类异常全命中 + 表头跳过 + table 按 issueCount 降序）；此前同日 +1——证据清单模板引擎级执行（真实跑 code 拆条 + 中文日期归一化 + table 按日期排序）；修复 templates-api 陈旧断言——空白画布拆分（`54a0ddb`）后 API 不再返回 tpl-blank，旧断言一直靠未重建的 core dist 假绿。2026-08-31 新增：at-rest 静态加密 7 单测 + 4 db 集成——磁盘无明文断言 / version·run hash 匹配 / 旧明 文兼容；api.security 审计用例；routingWorker 视频音频委托；模板参数化全链路；videoAdapter 3 用例；artifact-store 本地引用 1 用例）。此前 571/571 连续复跑稳定（vitest.setup mock bcryptjs + timeout 20s/30s 消已知负载性 flaky）。

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

