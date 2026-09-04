# Changelog

All notable changes are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- **专业服务方向 6 个新模板**（第 28–33 个业务模板，全部复用现有节点、零新引擎能力；逐一真实狗粮验证）：
  - 银行流水对账（`tpl-reconciliation`）：两段流水投料 → code 逐笔配对（date+amount）→ table 差异清单按金额降序 → 对账报告
  - 隐私政策合规审查（`tpl-privacy-review`）：fileParse → 11 维度合规盘点 → 整改建议 + 风险分级 → 人工确认
  - 发票批量 OCR 台账（`tpl-invoice-ocr`）：发票图片 → OCR（chi_sim+eng）→ 字段提取 → 台账按日期排序
  - 批量合同审查（`tpl-batch-contract-review`）：多份合同文本（`=====` 分隔）→ 拆条 → 逐份 8 维度风险审查 → 风险汇总表
  - 审计抽样底稿（`tpl-audit-sampling`）：账目明细 → 抽样规则（大额/重复/非工作日）→ 审计底稿
  - 尽调清单（`tpl-due-diligence`）：多份尽调材料 → 解析 → 7 事项盘点 → 缺口清单
- **fileParse 多文档能力** — fileParse 从「只解析第一个文档」改为「解析所有文档」，多文档 text 用 `===== 文件名 =====` 头分隔，单文档路径字节不变（向后兼容）；解锁批量 PDF 合同审查、尽调等场景
- **行业 ROI 评估文档**（`docs/product-industry-roi.md`）— 多 agent 流水编排的行业切入方向排序 + 专业服务垂直模板候选清单

### Changed
- 模板总数从 27 增至 33（覆盖 29 种节点类型中的 23 种）

## [0.3.0] - 2026-08-29

### Added
- **账号系统与按用户隔离** — users 表 + JWT(HS256, bcrypt12) HttpOnly cookie 会话；graphs/runs/artifacts/brand_terms/成本全部按 `user_id` 过滤；前端登录/注册/用户菜单；旧库自动回填归属（迁移 14/15 幂等，无法归属的行 fail closed 不可见）。
- **通用节点六类（通用化 Phase 1 P0）** — HTTP 请求（SSRF 防护）、代码执行（JS/Python 子进程）、条件分支（安全表达式求值，无 eval）、映射 map（JSON 模板 + 类型保留）、循环 loop（内联子图 + `${item.x}` 上下文 + `{results:[...]}` 聚合）、并行聚合 parallel（barrier 结构化聚合）。
- **MCP Server（新包 `packages/mcp-server`，P0-P2 全部落地）** — stdio + Streamable HTTP/SSE 双传输；15 个工具（6 个核心 + 6 个管理类 create/update/delete graph、cancel_run、download_artifact、search_knowledge + batch_run/compare_runs + get_run_events）；Resources（`resources/list`/`templates`/`read` + `resources/subscribe`，graph:// run:// artifact:// 三类 URI）；Prompts（run_pipeline / analyze_pipeline / create_from_template 三个引导提示词）；实时 notifications 桥接（`notifications/resources/updated`）+ `AGENT_WORLD_MCP_READONLY` 只读模式 + Authorization Bearer 认证。详见 [docs/design-mcp-server.md](docs/design-mcp-server.md)。
- **产物统一渲染** — `ArtifactCard` 外壳 + 7 类渲染器注册表 + JSON 树 + 共享 `renderMarkdown`；Inspector / 成品面板 / 画廊三处接入；画廊按流水线分组；节点缩略图。
- **产物归属** — artifacts 表加 `graph_id` / `role`（source/intermediate/final）+ `label` + `mimeType: text/markdown`，落库归属流水线。
- **Canvas 交互增强** — Shift 多选 + 框选；批量移动 / 批量删除；首载自适应；视口 pan/zoom 持久化；节点执行时长展示；Inspector 可拖拽调宽。
- **Multi-select on canvas** — Shift+click plants/pipes to toggle selection; Shift+drag on empty backdrop draws a marquee box to select all plants inside; ⌘/Ctrl+A selects all plants.
- **Batch operations** — drag any selected plant to move the whole selection together (relative positions preserved); Delete/Backspace removes all selected plants and pipes at once.
- **First-load auto-fit** — the canvas auto-fits to all plants on first load so new users never see a blank board.
- **Viewport persistence** — pan/zoom state persists per graph in localStorage; refreshing or dispatching a new run no longer resets the viewport.
- **Node execution duration** — the Inspector shows how long each node ran (startedAt/finishedAt, formatted as ms/s/m/h/d).

### Changed
- 引擎 `setTextArtifact` 现在为文本产物填 `label`（首行 H1）与 `mimeType: text/markdown`。
- Left-drag on empty backdrop in select mode now pans the canvas (was marquee); marquee selection moved to Shift+drag.
- Removed unused `reset()` method from canvas store (the "适应" button's fit-to-bounds replaces it).
- Vite dev server port restored to 5173.

### Security
- **settings 按用户隔离** — settings 表（迁移 16），provider key 互不可见；运行期配置解析用 AsyncLocalStorage（runAsUser，并发 run 互不串）。
- **SSRF 防护** — HTTP 节点与 `/api/proxy` 共享 `ssrf.ts`（DNS 解析后按 IP 校验，DNS-rebinding 免疫），`ALLOW_PRIVATE_NETWORK=1` 逃生口；`/api/proxy` 要求登录 + 重定向逐跳复检。
- **cookie Secure** — 登录 cookie 按 `SECURE_COOKIES` / production 默认加 `Secure`（localhost 豁免）。
- **webhook 触发器强制非空 secret** — 空 secret 返回 400，杜绝匿名触发。

### Fixed
- Marquee selection coordinates now convert from viewport (SVG viewBox) space to content (graph) space, matching node x/y.
- Multi-select drag now snapshots selected node IDs at drag start, avoiding stale React closure state after a Shift+click toggle.
- Marquee selection now uses window-level pointer events (instead of React synthetic events + pointer capture on inner `<rect>`), preventing the selection rectangle from sticking to the cursor when pointerup is dropped.
- Added `pointercancel` listener so macOS trackpad gestures / system interruptions clean up the marquee instead of leaving it stuck.
- product-json parsing now tolerates a blocks-only array, and long-image export has end-to-end timeout protection (previously could hang on "生成中...").
- Removed the `max-height` on `product__body` so the sink content scrolls with the Inspector (previously nested scrolling made content unreachable).
- Inspector and Control Panel bodies now scroll internally.
- Upstream prohibited terms / brand words are now injected into every agent node's input (previously omitted).
- A `node.failed` event is emitted when a gate exhausts its rework attempts, so the failure reason is visible.
- Upstream image URIs are included in agent text input so product-json can reference real images.
- Bare media extraction now skips URLs inside fenced code blocks.

## [0.2.0] - 2026-08-26

### Added
- **4.5 Multimodal** — `ContentPart` (text + image) across engine, providers, and canvas.
- **4.7 Human-in-the-loop** — gate approve / edit / reject / scrap with run-halt webhook.
- **4C.7 Plugin process isolation** — `child_process.fork` with env trimming and fetch/fs proxy allowlists.
- **4D.7 MCP remote transports** — `stdio` / `http` / `sse` servers and tool-call permission governance.
- **4.9 Engineering**
  - GitHub Actions CI (typecheck + build + test) and gitleaks secret-leak scan.
  - CORS restricted to `CORS_ORIGINS` (was allow-all) plus basic security response headers.
  - Dockerfile + `docker-compose.yml` deployment.
  - MIT `LICENSE`.

### Changed
- CORS now requires `CORS_ORIGINS` in shared deployments; local dev keeps allow-all when unset.

## [0.1.0] - 2026-08-01

### Added
- Initial agent-world event-sourced pipeline engine, worker plugin system, triggers, MCP integration, and web canvas.
