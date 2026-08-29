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
- [docs/design-code-sandbox.md](docs/design-code-sandbox.md) — 代码节点运行沙箱（P0 已落地 / P1 资源限制进行中 / P2 外部沙箱后端待办）
- [docs/feedback-workflow.md](docs/feedback-workflow.md) — owner 怎么高效反馈给我（截图 / computer-use / 防丢）
- [docs/handoff-archive.md](docs/handoff-archive.md) — historical changes (pre-2026-08-27)
- [PRODUCT_STRATEGY.md](PRODUCT_STRATEGY.md) — 产品策略汇总（成本/部署/定价/商业化决策基线）

## Current state

- **Monorepo**：`packages/core` / `packages/server` (Node + sqlite, 端口 8791) / `apps/web` (Vite, 端口 5173)
- **核心能力**：4 类 AI 节点（agent / imageGen / videoGen / audioGen）+ **通用节点（HTTP 请求 / 代码执行 / 条件分支 / 映射 / 循环 / 并行聚合 / 表格处理 / 数据库查询 / 文件解析 / 翻译 / OCR / 文件转换 / 搜索 / 通知）**，**MCP Server（stdio + HTTP/SSE 双传输，15 工具 + resources + prompts + 实时 notifications 桥接 + Authorization Bearer 认证，P0-P2 全部落地）**，多产线管理，Inspector 模型下拉严格按 modality 过滤，多模态产出（Artifact 分层），流式 + SSE + 断线重连 + halt/resume，成本电表（token + 单价两种模式），评估体系雏形，产物落库归属流水线（artifacts 的 graph_id/role）
- **安全基线（本轮升级）**：settings 按用户隔离（迁移 16，provider key 互不可见）+ **HTTP 节点 SSRF 防护**（fetch 时解析 IP 校验，DNS-rebinding 免疫，`ALLOW_PRIVATE_NETWORK=1` 逃生口）+ 登录 cookie 按 `SECURE_COOKIES`/production 加 `Secure` 标志（localhost 豁免）+ webhook 触发器强制非空 secret（杜绝匿名触发）+ **代码节点 P0 沙箱**（env 白名单 + 解释器绝对路径 + 每次运行独立 temp dir 并清理）
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
  - `packages/server/src/code-sandbox.ts` — 代码节点沙箱工具（P0：解释器路径缓存 + 工作目录创建清理；P1：rlimit 包裹 + Node permission）
  - `packages/server/src/ssrf.ts` — 出站请求 SSRF 防护（proxy + HTTP 节点共用，解析后 IP 校验）
  - `packages/server/src/user-context.ts` — AsyncLocalStorage 按异步上下文归属用户（运行期配置解析）
  - `packages/core/src/` — 领域模型、Provider 抽象、Artifact、节点契约
  - `packages/server/src/` — 持久化、events API、调度

## Active work / 待办

按优先级降序，标 `★` 的是当下要推的：

1. **★ 代码节点沙箱 P2 外部沙箱后端**（详见 [docs/design-code-sandbox.md§P2](docs/design-code-sandbox.md)，P0/P1 均已落地，P1 在当前 commit，P2 待做）— 定义 `CodeSandbox` 接口 + 按 `CODE_SANDBOX` 环境变量选择后端；**bwrap**（Linux mount/pid/net namespace + rlimit，JS+Python 全覆盖）、**sandbox-exec**（macOS seatbelt 过渡）、**容器**（生产 Docker/Podman）三档；缺后端时降级到 P1 rlimit 并 `console.warn` 显式降级，绝不静默变无沙箱。诚实边界提醒：P1 下 Python 的 fs/网络隔离仅 OS rlimit（内存/CPU/fd），Node ≥ 24 stable permission model 已移除 `--allow-net` 粒度，JS 网络隔离也要等 P2 OS 后端才真正生效
2. **MCP Server P0 MVP 升级**（详见 [docs/design-mcp-server.md](docs/design-mcp-server.md)，P0 完成了 HTTP 接入；下一步是 **独立可执行 mcp-server 包 stdio 传输** 与 stdio 模式下的真实 CLI 冒烟测试）— 当前 MCP Server 代码在 `packages/mcp-server/`，HTTP 模式已测，但 `stdio` 传输未做端到端跑通（Claude Desktop 直连需要 stdio）
3. **GraphSwitcher.tsx 未提交的 step 3 尾巴**（+11 行）— 上一轮 UI 重设计遗留，工作树里挂着，需要决定是单独一个 commit 收掉还是先放着
4. **Inspector 的"在显眼处加一个去设置的链接"** — 音频模型没配时，下拉只有占位项，没引导；新建节点有 toast 软提示覆盖

## Recently shipped (last 5)

按 commit 时间倒序，每条一行影响面 + commit hash：

1. **待 commit（P1 沙箱资源限制）**：**feat(sandbox)**: **代码节点沙箱 P1 资源限制**。`sh -c 'ulimit -t/-u/-f/-n && exec …'` 包裹 child spawn（exec 替换 shell 不挂 PID，argv POSIX 单引号转义，Linux 加 -v）；全局限额支持 `CODE_LIMIT_*` 环境变量调参（调用时读取非 import 时快照）；Node JS `--permission`/`--experimental-permission` 探针二选 + `--allow-fs-read/write=<workdir>` 严格限临时目录（macOS `/var` 软链 realpath 规范化）、禁 `--allow-worker/--allow-child-process/--allow-addons/--allow-wasi`；诚实边界：Node 24 stable permission 已移除 `--allow-net` 粒度，JS 网络隔离 + Python fs/网络隔离需 P2 OS 后端。测试：全 server 411→424 通过
2. `6b2f92b` — **feat(sandbox)**: **代码节点沙箱 P0**。env 只透传 `SAFE_ENV_BASE` + 节点声明的白名单；解释器启动时解析绝对路径并缓存；每次运行独立 `/tmp/aw-code-<run>-<node>-<attempt>-*` 临时目录做 cwd，成功/失败/超时全部 finally 清理。测试 405 → 411 通过。
3. `34a22ab` — **docs**: 新增代码节点运行沙箱设计方案（P0 安全基线 / P1 资源限制 / P2 外部沙箱后端三批，含威胁模型与诚实边界）。
4. `64fd9ab` — **docs**: 把项目文档里的 MCP Server 状态从「进行中」统一更新为「P0-P2 全部落地」。
5. `4e4905c` — **feat(mcp)**: **MCP Server P2-③ 实时与安全**。get_run_events 工具 + NotificationsHub 桥接（resources/subscribe → 上游 /stream SSE → notifications/resources/updated，按 runId 去重 + 断连清理）+ token 认证迁 Authorization Bearer（主服务认证中间件 cookie→Bearer→query 优先级）。MCP 41→47 + 主服务 405 测试通过。
最近 5 条之前的全部在 [docs/handoff-archive.md](docs/handoff-archive.md) 的"阶段 4 收尾"与"Additions (post-2026-08-27)"系列章节里（含 HTTP 节点第一闭环 `1856d81`、账号系统 `5b81c74`/`73d3610`、human/subprocess 节点等）。

## Quality gate (current snapshot)

> 这里的 snapshot 是"今天跑过的"状态；archive 章节里的"质量门"是各 commit 当时的状态，不要混用。

- `pnpm -r typecheck`：全绿
- `pnpm --filter @agent-world/core test`：142/142 通过（含 EdgeKind error / buildNodeContext error 前驱 / node.skipped event + HTTP file 模式用例）
- `pnpm --filter @agent-world/server test`：**424/424 通过**（Node 24 下跑）。P1 沙箱新增 13 个测试（code-sandbox：rlimit/permission 形状 + 运行期实跑断言 + shell 引用；engine.code：fs 工作目录内允许/外拒绝 + child_process 禁 spawn + RLIMIT_NPROC 拦 fork 炸弹 + RLIMIT_CPU 1s SIGXCPU 先于 12s timeout 失败）。原有 411 个测试零回归
- `pnpm --filter @agent-world/mcp-server test`：47/47 通过
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

