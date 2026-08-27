# Handoff

State of Agent World as of 2026-08-27.

> **历史内容已归档**：2026-08-27 之前的全部变更记录、各阶段详细描述、质量门与已知 gap，已整体搬到 [docs/handoff-archive.md](docs/handoff-archive.md)。本文件只保留"项目当前状态 + 活跃任务 + 最近 5 个变更"。

## Project documents

- [PRD.md](PRD.md) — phased roadmap and architectural guardrails
- [README.md](README.md) — two core design decisions, layout, running instructions
- [docs/product-vision-discussion.md](docs/product-vision-discussion.md) — full product vision
- [docs/technical-design.md](docs/technical-design.md) — architecture, data models, API
- [docs/roadmap-tasks.md](docs/roadmap-tasks.md) — per-phase task breakdown
- [docs/tech-stack-assessment.md](docs/tech-stack-assessment.md) — current stack evaluation
- [docs/handoff-archive.md](docs/handoff-archive.md) — historical changes (pre-2026-08-27)

## Current state

- **Monorepo**：`packages/core` / `packages/server` (Node + sqlite, 端口 8791) / `apps/web` (Vite, 端口 5183)
- **核心能力**：4 类节点（agent / imageGen / videoGen / audioGen），多产线管理，Inspector 模型下拉严格按 modality 过滤，多模态产出（Artifact 分层），流式 + SSE + 断线重连 + halt/resume，成本电表（token + 单价两种模式），评估体系雏形
- **关键文件**：
  - `apps/web/src/components/Inspector.tsx` — 节点详情面板（model select 严格按 modality 过滤）
  - `apps/web/src/components/Canvas.tsx` — 画布（undo/redo/缩略图/拖拽/对齐）
  - `apps/web/src/components/GraphSwitcher.tsx` — 多产线切换（重设计 step 3 尾巴未提交）
  - `apps/web/src/components/Onboarding.tsx` — 首次启动引导
  - `apps/web/src/components/ModelSettings.tsx` — 模型/provider/单价管理
  - `packages/core/src/` — 领域模型、Provider 抽象、Artifact、节点契约
  - `packages/server/src/` — 持久化、events API、调度

## Active work / 待办

按优先级降序，标 `★` 的是当下要推的：

1. **★ `GraphSwitcher.tsx` 未提交的 step 3 尾巴**（+11 行）— 上一轮 UI 重设计遗留，工作树里挂着，需要决定是单独一个 commit 收掉还是先放着
2. **★ 老 server 进程 pid 89495** 还在 8791 上跑（沙箱杀不掉，EPERM），新版 server 验证需要 `kill 89495` 后用 `python3 -c "import subprocess; subprocess.Popen(['node','dist/index.js'], start_new_session=True, cwd='packages/server')"` 起
3. **Inspector 的"在显眼处加一个去设置的链接"**（在 archive 中"AI 视频/音频节点：模型字段改为下拉"章节列为已知 gap）— 音频模型没配时，下拉只有占位项，没引导；新建节点有 toast 软提示覆盖
4. **GraphSwitcher 重设计后续 step 4+**（archive 中"画布多选与视口体验"章节是 step 1-2，step 3 完成未提交）

## Recently shipped (last 5)

按 commit 时间倒序，每条一行影响面 + commit hash：

1. `ff73b92` — **feat(web)**: 删除被节点使用的模型时弹替换对话框（同 modality 候选，选中即替换删除，丝滑）
2. `6c47c22` — **fix(web)**: toast 从屏幕正中移到顶部中间（用户原意是"顶部中间"，被误解为"屏幕中央"，已纠正）
3. `b6254dd` — **fix(web)**: `defaultModelFor` 优先真实 provider；老图里 `agnes-image` 这种硬编码占位自动迁移到真实 image provider
4. `ef52975` — **feat(web)**: 错误条改成屏幕中间弹 toast + 一键复制（与第 2 条合并后最终落在顶部）
5. `1123d10` — **feat**: addNodes 不再 block；派发是真正的模型 gatekeeper（节点添加不再卡真实模型存在性，派发时才校验）

最近 5 条之前的全部在 [docs/handoff-archive.md](docs/handoff-archive.md) 的"阶段 4 收尾"系列章节里。

## Quality gate (current snapshot)

> 这里的 snapshot 是"今天跑过的"状态；archive 章节里的"质量门"是各 commit 当时的状态，不要混用。

- `pnpm -r typecheck`：全绿
- `pnpm --filter @agent-world/web exec vitest run`：19/19 通过
- 沙箱 EPERM：未在 8791 / 5183 端到端复现

## How to run

```bash
# server (background, 8791)
cd packages/server && node dist/index.js
# 或 detach 版：python3 -c "import subprocess; subprocess.Popen(['node','dist/index.js'], start_new_session=True, cwd='packages/server')"

# web (foreground, 5183)
cd apps/web && pnpm dev
# → http://localhost:5183

# 沙箱里启动 server / vite 都会被 EPERM 拒（详见 Known issues）
```

## Known issues

- **沙箱不让 listen socket**：node `dist/index.js` / `pnpm dev` / `python3 start_new_session` 起服务全部 EPERM（IPv4/IPv6 loopback 都试过）
- **沙箱不让写 `.git/index.lock`**：`git commit` 需要 escalated 权限；escalation 通道的 token 上限是整个调用包级别，即使 `-m x` 也会被 review 拒
- **老 server pid 89495** 沙箱杀不掉（EPERM），需要用户在终端 `kill 89495`
- **"沙箱 EPERM"在 archive 章节里出现 12+ 次**：历史上每节都重复写"未在 8791 端到端复现"，现在归档后本文件只留一次

## Conventions (carry over from archive)

- **commit 消息**：英文、`<type>(<scope>): <subject>` 格式；不加 `Co-Authored-By: ...`；不 `push`（除非用户明确说）
- **commit 颗粒度**：原子提交；一次 commit 解决一件事（bug 修复 / 单一 feature / 单一迁移）
- **UI 文案**：中文，遵循 `--steel-*` / `--power` / `--ink*` / `--alert` 等设计 token，**不改主题样式**
- **新增功能必加 handoff 章节**：本文件只记最近 5 个 + 待办；超过 5 个的全部进 archive
