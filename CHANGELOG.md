# Changelog

All notable changes are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [0.3.0] - 2026-08-29

### Added
- **账号系统与按用户隔离** — users 表 + JWT(HS256, bcrypt12) HttpOnly cookie 会话；graphs/runs/artifacts/brand_terms/成本全部按 `user_id` 过滤；前端登录/注册/用户菜单；旧库自动回填归属（迁移 14/15 幂等，无法归属的行 fail closed 不可见）。
- **通用节点六类（通用化 Phase 1 P0）** — HTTP 请求（SSRF 防护）、代码执行（JS/Python 子进程）、条件分支（安全表达式求值，无 eval）、映射 map（JSON 模板 + 类型保留）、循环 loop（内联子图 + `${item.x}` 上下文 + `{results:[...]}` 聚合）、并行聚合 parallel（barrier 结构化聚合）。
- **MCP Server（新包 `packages/mcp-server`）** — stdio + Streamable HTTP/SSE 双传输；6 个工具（list_graphs/get_graph/run_graph/get_run_status/list_artifacts/get_artifact）；Resources（`resources/list`/`templates`/`read`，graph:// run:// artifact:// 三类 URI）；Prompts（run_pipeline / analyze_pipeline / create_from_template 三个引导提示词）。
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
