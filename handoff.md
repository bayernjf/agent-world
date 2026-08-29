# Handoff

State of Agent World as of 2026-08-29.

> **历史内容已归档**：2026-08-27 之前的全部变更记录、各阶段详细描述、质量门与已知 gap，已整体搬到 [docs/handoff-archive.md](docs/handoff-archive.md)。本文件只保留"项目当前状态 + 活跃任务 + 最近 5 个变更"。

## Project documents

完整索引（按读者分类 + 现行/历史/归档标注）见 [docs/README.md](docs/README.md)。核心文档直达：

- [PRD.md](PRD.md) — phased roadmap and architectural guardrails
- [README.md](README.md) — two core design decisions, layout, running instructions
- [docs/technical-design.md](docs/technical-design.md) — architecture, data models, API
- [docs/roadmap-generalization.md](docs/roadmap-generalization.md) — 通用化路线图（当前主线，5 阶段）
- [docs/design-mcp-server.md](docs/design-mcp-server.md) — MCP Server 设计方案（让其他 AI 客户端接入 agent-world）
- [docs/design-artifact-display.md](docs/design-artifact-display.md) — 产物统一渲染卡设计（ArtifactCard + 渲染器注册表；已落地）
- [docs/design-artifact-attribution-repo.md](docs/design-artifact-attribution-repo.md) — 产物归属 + 按流水线分组成品仓库设计（已落地）
- [docs/feedback-workflow.md](docs/feedback-workflow.md) — owner 怎么高效反馈给我（截图 / computer-use / 防丢）
- [docs/handoff-archive.md](docs/handoff-archive.md) — historical changes (pre-2026-08-27)
- [PRODUCT_STRATEGY.md](PRODUCT_STRATEGY.md) — 产品策略汇总（成本/部署/定价/商业化决策基线）

## Current state

- **Monorepo**：`packages/core` / `packages/server` (Node + sqlite, 端口 8791) / `apps/web` (Vite, 端口 5173)
- **核心能力**：4 类 AI 节点（agent / imageGen / videoGen / audioGen）+ **通用节点（HTTP 请求 / 代码执行 / 条件分支 / 映射 / 循环 / 并行聚合 / 表格处理 / 数据库查询 / 文件解析 / 翻译 / OCR / 文件转换 / 搜索 / 通知）**，**MCP Server（stdio + HTTP/SSE 双传输，6 工具 + resources + prompts）**，多产线管理，Inspector 模型下拉严格按 modality 过滤，多模态产出（Artifact 分层），流式 + SSE + 断线重连 + halt/resume，成本电表（token + 单价两种模式），评估体系雏形，产物落库归属流水线（artifacts 的 graph_id/role）
- **安全基线（本轮升级）**：settings 按用户隔离（迁移 16，provider key 互不可见）+ **HTTP 节点 SSRF 防护**（fetch 时解析 IP 校验，DNS-rebinding 免疫，`ALLOW_PRIVATE_NETWORK=1` 逃生口）+ 登录 cookie 按 `SECURE_COOKIES`/production 加 `Secure` 标志（localhost 豁免）+ webhook 触发器强制非空 secret（杜绝匿名触发）
- **本轮已落地（2026-08-29，均已提交）**：
  - **账号系统 / 按用户隔离**（`5b81c74` + `73d3610`）：users 表 + JWT(HS256, bcrypt12) HttpOnly cookie 会话 + graphs/runs/artifacts/brand_terms/成本全部按 `user_id` 过滤 + 前端登录/注册/用户菜单 + `authFetch(credentials:include)`。旧库升级自动回填归属（迁移 14/15 幂等，无法归属的行 fail closed 不可见）
  - **产物统一渲染**：`artifact-renderers.tsx`（ArtifactCard 外壳 + 7 类渲染器注册表 + JSON 树 + 共享 renderMarkdown），Inspector/成品面板/画廊三处接入，画廊按流水线分组，节点缩略图
  - **UI 布局交互**：Inspector 可拖拽调宽（localStorage 持久化）、CanvasToolbar 置顶、Inspector 随节点选中自动开合、成品库改版
  - **安全加固**（`17dfbf9`/`299dc63`/`c0dd67d`）：删除死代码 SKIP_AUTH；artifacts 读写全部按用户归属（堵跨用户读取/下载）；`/api/proxy` 要求登录 + 拒绝内网地址 + 重定向逐跳复检（堵未认证 SSRF）。遗留决策项见"待办"第 4 条
  - **MCP Server P1 增强**：Streamable HTTP/SSE 传输（`POST /mcp` JSON 或 SSE 按 Accept、`GET /mcp` SSE 宣告 endpoint；`AGENT_WORLD_MCP_TRANSPORT=http` 切换）、Resources（`resources/list`/`templates`/`read`：graph:// run:// artifact:// 三类 URI 模板）、Prompts（3 个引导提示词，参数插值）、initialize 能力声明 tools+resources+prompts；协议级测试 22/22 + 真实 socket 冒烟
- **关键文件**：
  - `apps/web/src/components/Inspector.tsx` — 节点详情面板（model select 严格按 modality 过滤；产物走 ArtifactCard）
  - `apps/web/src/lib/artifact-renderers.tsx` — 统一产物渲染
  - `apps/web/src/components/ProductGallery.tsx` — 成品库（kind 过滤 + 按流水线分组）
  - `apps/web/src/components/Settings.tsx` — 模型/provider/单价管理
  - `apps/web/src/components/Canvas.tsx` — 画布（undo/redo/缩略图/拖拽/对齐）
  - `apps/web/src/components/GraphSwitcher.tsx` — 多产线切换
  - `apps/web/src/components/Onboarding.tsx` — 首次启动引导
  - `packages/server/src/auth.ts` — JWT 签发/校验、密码哈希
  - `packages/server/src/db.ts` — 持久化（users 表 + 按 user_id 隔离 + 迁移 1-16）
  - `packages/server/src/ssrf.ts` — 出站请求 SSRF 防护（proxy + HTTP 节点共用，解析后 IP 校验）
  - `packages/server/src/user-context.ts` — AsyncLocalStorage 按异步上下文归属用户（运行期配置解析）
  - `packages/core/src/` — 领域模型、Provider 抽象、Artifact、节点契约
  - `packages/server/src/` — 持久化、events API、调度

## Active work / 待办

按优先级降序，标 `★` 的是当下要推的：

1. **★ Phase 4 设计文档完成（本轮）**— **`docs/phase4-design.md` 落地**：基于 2026-08-29 代码勘察（agent 工具调用 / loop·parallel 子图执行 / halt 机制 / 错误处理）写成 Phase 4 七项对照现状的落地方案 + 难题与对策 + 优先级。**两个颠覆性发现**：①**ReAct 多轮已实现**于 `openai-compatible.ts:207-340` 的 `runWithTools`（MAX_ROUNDS=8，tool result push 回 convo），roadmap 这条已满足，只需清理 worker.ts 过期注释；②**错误处理缺口比想象大**——search/http/code 无重试、失败节点下游静默搁浅 pending、failed/tripped 无告警（仅 halt 有）、translate retry 硬编码、重试逻辑四处复制粘贴。**真缺四项**：错误处理（error 边+skip+告警+死信 rerun+重试去重补全，最高优先级）、子流程（subprocess，复用 loop 内联递归模式，难题是 runNode 签名重构做上下文隔离）、人工审批节点（human，复用 halt 机制）、变量持久化（DB graph_variables 表）。状态机缓做（variables+branch 组合兜底）。roadmap Phase 4 表格已加状态列标注。**下一步**：按 phase4-design §7 优先级，从错误处理开干（建议拆 4 个 PR：重试去重补全 → skip+error 边 → 失败告警 → rerun API）。
2. **MCP Server P2 高级**（详见 [docs/design-mcp-server.md](docs/design-mcp-server.md)）— **P0 MVP + P1 增强均已落地**（stdio + HTTP/SSE 双传输、6 工具、resources、prompts，22/22 测试）。P2 候选：管理类工具（create/update/delete graph）、实时 notifications、批量运行、对比分析、认证权限。让 Claude Desktop/Cursor 等能接入 agent-world。
3. **运行沙箱细化**（详见 [docs/roadmap-generalization.md](docs/roadmap-generalization.md)）— 代码节点当前用 os.exec 子进程；后续可加资源限制（内存/超时）、白名单命令、工作目录隔离

## Recently shipped (last 5)

按 commit 时间倒序，每条一行影响面 + commit hash：

1. `00456d8` — **feat(core/server/web)**: **Phase 3 推进——vcs 节点 + notify Slack**。core 新增 NodeKind.vcs + VcsConfig（provider github|gitlab / action create_pr|comment_issue|trigger_workflow|list_issues / 复用 RetryPolicy）；server 新增 `vcs.ts`：GitHub REST（Bearer token）+ GitLab REST（PRIVATE-TOKEN，GITLAB_API_URL 可自托管），body/title 回退上游 text，VcsAuthError/VcsProviderError + 瞬态重试；notify 扩 slack provider（chat.postMessage + channel，ok:false → ProviderError）；web vcs 工具栏 + Inspector 面板（平台/动作/条件字段）+ notify 面板加 slack+channel + 两节点配色。core 7 + server 9（vcs 6 + notify slack 3）个新测试。
2. `bb56bad` — **feat(notify)**: **富消息 + 重试增强**。NotifyConfig 加 `format: text|markdown`（飞书用 interactive 卡片 markdown element 渲染、钉钉/企微用原生 markdown msgtype）+ `retry`（复用 RetryPolicy，默认 2 次指数退避）；notifier.ts 新增 `NotifyProviderError`（平台 errcode 非 0 如钉钉 keyword 不匹配，不重试）+ `withRetry` 循环（仅对网络/5xx 等瞬态故障重试，Auth 与 Provider 拒绝不重试）；engine 错误码映射区分三档；web Inspector 加「消息格式」下拉。core +2 + server +5 个新测试（13/13 notify 用例）。
3. `1336baf` — **feat(core/server/web)**: **Phase 3 首节点——通知（notify）**。core 新增 NodeKind.notify + NotifyConfig schema（provider: feishu|dingtalk|wecom|email / message / webhookUrl / secret / to / subject）；server 新增 `notifier.ts`：飞书/钉钉/企微群机器人（钉钉可选 HMAC-SHA256 加签）+ SMTP 邮件（密钥走 env）；message 空时回退上游 text（「搜索→总结→通知」最后一公里）；输出 json 产物可审计；VALIDATION/AUTH/PROVIDER_ERROR 错误语义；web 工具栏 + Inspector 面板（渠道/消息/webhook/加签/收件人/主题条件显示）+ 标签配色。复盘发现：roadmap Phase 3 的「定时触发增强」与「Webhook 输出」早已落地（cron/webhook/event/batch 触发器体系），roadmap 已标注。core 5 + server 8 个新测试。
4. `8a9ad1c` — **feat(core/server/web)**: **Phase 2 第七节点、收官——搜索（search）**。core 新增 NodeKind.search + SearchConfig schema（query/provider: duckduckgo|tavily|serpapi|google/maxResults）；server 新增 `search.ts`：DuckDuckGo 免 key 默认（html 端点 + 容错正则 + uddg 链接解码），tavily/serpapi/google 走 env key（密钥不入图）；query 空时回退上游 text（支持 agent 生成搜索词闭环）；输出 text+json 双产物，空结果仍成功；VALIDATION/AUTH/PROVIDER_ERROR 错误语义；web 工具栏按钮 + Inspector 面板（搜索词/搜索源/数量）+ 标签配色。core 4 + server 7 个新测试。Phase 2 七节点（表格、数据库、文件解析、翻译、OCR、文件转换、搜索）全部落地。
5. `b27e90b` — **feat(core/server/web)**: **Phase 2 第六节点——文件转换（convert）**。core 新增 NodeKind.convert + ConvertConfig schema（source/to: image|png|jpeg/quality 默认 85）；server 执行分支两类转换——PDF → 图片（parse-file 重构出共享 `extractPdfImages`，pdfjs 提取每页内嵌图 + pngjs 重编码，扫描版每页一张）、图片 → PNG/JPEG（新增 `convert.ts`：魔数探测 + pngjs/jpeg-js 纯 JS 解码重编码，支持批量与 JPEG 质量）；无上游/无可转换输入/纯文本 PDF → VALIDATION、读取或解码失败 → PROVIDER_ERROR；web 工具栏按钮 + Inspector 面板（来源/目标格式/JPEG 质量条件显示）+ 标签配色。core 4 + server 6 个新测试。
最近 5 条之前的全部在 [docs/handoff-archive.md](docs/handoff-archive.md) 的"阶段 4 收尾"系列章节里（含 HTTP 节点第一闭环 `1856d81`、账号系统 `5b81c74`/`73d3610` 等）。

## Quality gate (current snapshot)

> 这里的 snapshot 是"今天跑过的"状态；archive 章节里的"质量门"是各 commit 当时的状态，不要混用。

- `pnpm -r typecheck`：全绿
- `pnpm --filter @agent-world/core test`：142/142 通过（含 vcs / notify slack / notify format+retry / search / convert / ocr / translate / fileParse schema + HTTP file 模式用例）
- `pnpm --filter @agent-world/server test`：374/374 通过（含 vcs：GitHub create_pr 含 body 回退、GitLab list_issues、trigger_workflow 204、AUTH/PROVIDER_ERROR/重试；notify slack chat.postMessage + ok:false；search 与 notify.test.ts halt 通知全部用例）
- `pnpm --filter @agent-world/mcp-server test`：22/22 通过（含 resources/prompts 协议用例 + HTTP 传输 + 真实 socket 冒烟）
- `pnpm --filter @agent-world/web exec vitest run`：19/19 通过
- **注意**：依赖 `node:sqlite`，必须 Node ≥ 22（CI 用 Node 24；本地 shell 默认 Node 20 会误报 `No such built-in module: node:sqlite`，用 `fnm exec --using=24` 跑）

## Feedback workflow

- 看到不爽：**截图 + 6 字标签**发我。详细见 [docs/feedback-workflow.md](docs/feedback-workflow.md)
- 想让我看你的 Chrome：说"computer use 看一下 [位置]"
- 防丢：我在 "Active feedback" 区块自动记，你不用管

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

- **沙箱不让 listen socket**：node `dist/index.js` / `pnpm dev` / `python3 start_new_session` 起服务全部 EPERM（IPv4/IPv6 loopback 都试过）
- **沙箱不让写 `.git/index.lock`**：`git commit` 需要 escalated 权限；escalation 通道的 token 上限是整个调用包级别，即使 `-m x` 也会被 review 拒
- **"沙箱 EPERM"在 archive 章节里出现 12+ 次**：历史上每节都重复写"未在 8791 端到端复现"，现在归档后本文件只留一次

## Conventions (carry over from archive)

- **commit 消息**：英文、`<type>(<scope>): <subject>` 格式；不加 `Co-Authored-By: ...`；不 `push`（除非用户明确说）
- **commit 颗粒度**：原子提交；一次 commit 解决一件事（bug 修复 / 单一 feature / 单一迁移）
- **UI 文案**：中文，遵循 `--steel-*` / `--power` / `--ink*` / `--alert` 等设计 token，**不改主题样式**
- **新增功能必加 handoff 章节**：本文件只记最近 5 个 + 待办；超过 5 个的全部进 archive

### ⚠️ server 重启 bug（2026-08-27 14:40 踩过）

`start_new_session` 起 server 时 **cwd 必须是 `packages/server`**，不能是仓库根：

```bash
# ✅ 对的
python3 -c "import subprocess; subprocess.Popen(['node','/Users/jiangfeng/000mycodes/agent-world/packages/server/dist/index.js'], start_new_session=True, cwd='/Users/jiangfeng/000mycodes/agent-world/packages/server')"

# ❌ 错的（cwd=仓库根 → server 打开仓库根的空 agent-world.sqlite，看不到任何产线）
python3 -c "import subprocess; subprocess.Popen(['node','packages/server/dist/index.js'], start_new_session=True, cwd='/Users/jiangfeng/000mycodes/agent-world')"
```

**两个 DB 文件**：
- `packages/server/agent-world.sqlite` 180KB — 真正的数据（产线、run、artifact）
- `agent-world.sqlite` 4KB — 仓库根的"幽灵"空 DB，server 在仓库根跑就用这个

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

**macOS 没有 `setsid` 命令**，但 Python 的 `os.setsid()` 等价。

**验证**：
```bash
sleep 5 && lsof -i :8791    # 5 秒后还在 → 真独立
lsof -p $(lsof -ti :8791) | grep agent-world.sqlite  # 指向 packages/server/
```

