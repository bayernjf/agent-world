# Handoff

State of Agent World as of 2026-08-30.

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
- [docs/design-code-sandbox.md](docs/design-code-sandbox.md) — 代码节点运行沙箱（P0/P1/P2 + fs/net 策略 + net allowlist SSRF 校验代理全部落地；docker 容器后端待办）
- [docs/feedback-workflow.md](docs/feedback-workflow.md) — owner 怎么高效反馈给我（截图 / computer-use / 防丢）
- [docs/handoff-archive.md](docs/handoff-archive.md) — historical changes (pre-2026-08-27)
- [PRODUCT_STRATEGY.md](PRODUCT_STRATEGY.md) — 产品策略汇总（成本/部署/定价/商业化决策基线）

## Current state

- **Monorepo**：`packages/core` / `packages/server` (Node + sqlite, 端口 8791) / `apps/web` (Vite, 端口 5173)
- **核心能力**：4 类 AI 节点（agent / imageGen / videoGen / audioGen）+ **通用节点（HTTP 请求 / 代码执行 / 条件分支 / 映射 / 循环 / 并行聚合 / 表格处理 / 数据库查询 / 文件解析 / 翻译 / OCR / 文件转换 / 搜索 / 通知）**，**Phase 4 编排能力全部落地（2026-08-30 复核）：人工审批 human 节点 / subprocess 子流程调用 / graph 变量跨 run 持久化 / error 边 + catch 容错路径 / 失败级联 skip / 节点级重试基建（search/http/code/translate）/ 失败告警 + rerun；状态机按决策缓做**，**MCP Server（stdio + HTTP/SSE 双传输，15 工具 + resources + prompts + 实时 notifications 桥接 + Authorization Bearer 认证，P0-P2 全部落地）**，多产线管理，Inspector 模型下拉严格按 modality 过滤，多模态产出（Artifact 分层），流式 + SSE + 断线重连 + halt/resume，成本电表（token + 单价两种模式），评估体系雏形，产物落库归属流水线（artifacts 的 graph_id/role）
- **安全基线（本轮升级）**：settings 按用户隔离（迁移 16，provider key 互不可见）+ **HTTP 节点 SSRF 防护**（fetch 时解析 IP 校验，DNS-rebinding 免疫，`ALLOW_PRIVATE_NETWORK=1` 逃生口）+ 登录 cookie 按 `SECURE_COOKIES`/production 加 `Secure` 标志（localhost 豁免）+ webhook 触发器强制非空 secret（杜绝匿名触发）+ **代码节点沙箱全栈**（P0 env/cwd 隔离 → P1 rlimit+Node permission → P2 可插拔后端 bwrap/sandbox-exec/noop → fs/net 策略字段 → **net allowlist SSRF 校验代理**：`TOOL_NETWORK_ALLOW` 白名单 + 内网 IP 拒绝 + 一次性 run token + 逐请求审计，协作式边界见 design §10）
- **本轮已落地（2026-08-29，均已提交）**：
  - **账号系统 / 按用户隔离**（`5b81c74` + `73d3610`）：users 表 + JWT(HS256, bcrypt12) HttpOnly cookie 会话 + graphs/runs/artifacts/brand_terms/成本全部按 `user_id` 过滤 + 前端登录/注册/用户菜单 + `authFetch(credentials:include)`。旧库升级自动回填归属（迁移 14/15 幂等，无法归属的行 fail closed 不可见）
  - **产物统一渲染**：`artifact-renderers.tsx`（ArtifactCard 外壳 + 7 类渲染器注册表 + JSON 树 + 共享 renderMarkdown），Inspector/成品面板/画廊三处接入，画廊按流水线分组，节点缩略图
  - **UI 布局交互**：Inspector 可拖拽调宽（localStorage 持久化）、CanvasToolbar 置顶、Inspector 随节点选中自动开合、成品库改版
  - **安全加固**（`17dfbf9`/`299dc63`/`c0dd67d`）：删除死代码 SKIP_AUTH；artifacts 读写全部按用户归属（堵跨用户读取/下载）；`/api/proxy` 要求登录 + 拒绝内网地址 + 重定向逐跳复检（堵未认证 SSRF）。遗留决策项见"待办"第 4 条
  - **MCP Server P1 增强**：Streamable HTTP/SSE 传输（`POST /mcp` JSON 或 SSE 按 Accept、`GET /mcp` SSE 宣告 endpoint；`AGENT_WORLD_MCP_TRANSPORT=http` 切换）、Resources（`resources/list`/`templates`/`read`：graph:// run:// artifact:// 三类 URI 模板）、Prompts（3 个引导提示词，参数插值）、initialize 能力声明 tools+resources+prompts；协议级测试 22/22 + 真实 socket 冒烟
  - **代码节点沙箱 P0**（`6b2f92b`）：env 只透传 `SAFE_ENV_BASE` + 节点声明的 `env` 白名单；解释器用 `resolveInterpreter` 启动时解析绝对路径并缓存；每次运行独立 `/tmp/aw-code-<run>-<node>-<attempt>-*` 临时目录做 cwd，成功/失败/超时全部 `finally` 清理。测试 405 → 411 通过
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
  - `packages/server/src/code-sandbox.ts` — 代码节点沙箱工具（P0：解释器路径缓存 + 工作目录创建清理；P1：rlimit 包裹 + Node permission；P2：可插拔后端）
  - `packages/server/src/code-proxy.ts` — net allowlist 的 SSRF 校验代理（常驻单例 + 一次性 run token + allowlist/内网双重校验 + 审计日志）
  - `packages/server/src/ssrf.ts` — 出站请求 SSRF 防护（proxy + HTTP 节点共用，解析后 IP 校验）
  - `packages/server/src/user-context.ts` — AsyncLocalStorage 按异步上下文归属用户（运行期配置解析）
  - `packages/core/src/` — 领域模型、Provider 抽象、Artifact、节点契约
  - `packages/server/src/` — 持久化、events API、调度

## Active work / 待办

按优先级降序，标 `★` 的是当下要推的：

1. **沙箱后续（低优）**：docker/podman 容器后端（生产级隔离，net allowlist 的终极形态）

## Recently shipped (last 5)

按 commit 时间倒序，每条一行影响面 + commit hash：

1. `8f40a5e` — **feat(web)**: error 边画法支持——画布新增「容错线」连线模式（此前 server 支持但 UI 建不出来）、error 管道差异化渲染（暗红虚线芯）、通电逻辑失败感知（仅上游 failed 才点亮，与 flow 的 running/done 相区分）。web 19/19 通过。至此 Phase 4 错误处理在 UI 侧闭环。
2. `b1ad1af` — **docs(sandbox)**: docker 容器后端缓做决策记录（design §11：为什么低优——成本在外围不在接口；触发条件——部署形态明确后再决策）。
3. `1bdf8c2`+`5d4dfa3`+`1013dee` — **feat(sandbox)**: net allowlist 的 SSRF 校验代理落地。`code-proxy.ts` 常驻单例正向代理（127.0.0.1 随机端口）+ 一次性 run token 内嵌代理 URL 凭据（标准客户端自动转 `Proxy-Authorization: Basic`，无需用户代码配合）+ `matchDomain` 白名单 / `hostIsInternal` 内网双重校验（解析一次校验一次连接一次，rebinding 免疫）+ CONNECT 隧道（仅 80/443）+ 逐请求审计日志；engine 接线：`TOOL_NETWORK_ALLOW` 未配置 VALIDATION 报错、bwrap/sandbox-exec 硬断网后端 VALIDATION 拒绝、token 随 run finally 注销。诚实边界：协作式（约束走代理 env 的客户端），Node fetch 需 ≥ 24.5（注入 `NODE_USE_ENV_PROXY=1`）。server 测试 442→457 通过
4. `e507723` — **fix(sandbox)**: NPROC 测试根因修复——`ulimit -u` 在 Linux 上限的是**整个用户**的任务数，CI runner 上 vitest worker 已逼近 128，node 线程创建 EAGAIN → SIGABRT。引号测试改 `maxProcs: 4096` 覆盖。
5. `27b5a4b` — **fix(ci)**: tsx 声明为根 devDependency（mcp-server stdio 测试从根 `node_modules/.bin/tsx` 启动 CLI，pnpm 严格布局下不存在 → ENOENT）。

最近 5 条之前的全部在 [docs/handoff-archive.md](docs/handoff-archive.md) 的"阶段 4 收尾"与"Additions (post-2026-08-27)"系列章节里（含 MCP stdio 分帧修复 `a2482ba`、P2 外部沙箱后端 `0a22b13`、P1 rlimit `ddb2e03`、P0 `6b2f92b`、HTTP 节点第一闭环 `1856d81`、账号系统 `5b81c74`/`73d3610` 等）。

## Quality gate (current snapshot)

> 这里的 snapshot 是"今天跑过的"状态；archive 章节里的"质量门"是各 commit 当时的状态，不要混用。

- `pnpm -r typecheck`：全绿（2026-08-30 复核 web：tsc --noEmit 干净）
- `pnpm --filter @agent-world/core test`：142/142 通过（含 EdgeKind error / buildNodeContext error 前驱 / node.skipped event + HTTP file 模式用例）
- `pnpm --filter @agent-world/server test`：**457/457 通过**（Node 24 下跑）。SSRF 代理新增 13 个 code-proxy 单测（allow/deny、Basic/Bearer 双认证、跨 token 隔离、token 注销失效、内网拒绝、CONNECT 隧道透传/端口拒绝、resolveConnectAddress IP 固定 fail-closed）+ 3 个 engine e2e（TOOL_NETWORK_ALLOW 未配置 VALIDATION、Python urllib 经代理成功、allowlist 外 403）。此前 fs/net 策略 5 个测试（allowlist 只读实跑等）、P2 13 个（后端选择/形状/live seatbelt+bwrap）、P1 13 个（rlimit/permission 形状 + 实跑 + 引号 + NPROC/CPU 拦截）
- `pnpm --filter @agent-world/mcp-server test`：**50/50 通过**（新增 stdio 端到端冒烟 3 个：CLI 子进程真实回环 / parse error 容错 / 多字节 id 无分帧错位）
- `pnpm --filter @agent-world/web exec vitest run`：19/19 通过
- **注意**：依赖 `node:sqlite`，必须 Node ≥ 22（CI 用 Node 24；本地 shell 默认 Node 20 会误报 `No such built-in module: node:sqlite`，用 `fnm exec --using=24` 跑）。**P1 沙箱的实跑测试必须在 Node 24 下验证**——否则 `code-sandbox.test.ts` 的 spawnSync shell 脚本形状断言通过，但 `engine.code.test.ts` 中真正执行用户脚本时会因 `--permission` / `--experimental-permission` 形式与实际 Node 版本不一致而失败（`resolveInterpreter` 会对解释器路径做版本探针，跨版本跑会走不同分支）

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

### ⚠️ RLIMIT_NPROC 陷阱（2026-08-29 CI 排查半天才定位，务必记住）

`ulimit -u`（RLIMIT_NPROC）在 Linux 上限制的是**整个用户（UID）的进程+线程总数**，不是单个子进程。CI runner 上 vitest 多 worker 已让 runner 用户任务数逼近默认 128，代码节点子进程的 node 启动时创建平台线程 EAGAIN → 断言崩溃 → **SIGABRT（`r.status === null`、~200ms 秒挂）**。症状随并发负载波动，时好时坏，极易误判为 env/stdin/挂死问题。教训：验证 shell 行为（引号等）的测试不要叠加宿主敏感的 NPROC 小值限额，用 `maxProcs: 4096` 覆盖；NPROC 生产语义由 engine 集成测试覆盖。另一个相关坑：开发机 shell 里若有本地代理（如 `HTTP_PROXY=127.0.0.1:7897`），会污染"客户端是否走代理"类的手工验证，排查前先 `env | grep -i proxy`。

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

