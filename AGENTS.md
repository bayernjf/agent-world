# Agent Instructions

Agent World 项目的 AI 编码规范。写任何代码前先读本节，尤其是「UI 文案」和「设计 token」两条——这是本项目最常被违反的约定。

## 任务追踪与文档分层

**任务追踪与待办的主入口是 `handoff.md`**（状态、进度、待办、文档索引都在这里）；**方案/设计/规格的全文放 `docs/`（或根目录）的独立文档**，handoff 只索引、不复制全文。

- 活跃待办 → `handoff.md`「Active work」区
- 缓做/低优项 → `docs/deferred-items.md`（每条带触发条件；handoff 只给索引）
- 方案/设计/规格 → `docs/design-*.md`、`docs/PRD.md`、`docs/technical-design.md` 等，一个主题一份（单一事实源）
- 触发条件满足 → 从 deferred-items 移回 handoff 待办区并标注重启日期

**新增文档后**：在 `handoff.md`「Project documents」区补一行索引（`docs/README.md` 文档地图同步）。

一句话：handoff = 索引 + 状态 + 待办，docs = 方案 + 设计 + 明细。接手先读 handoff，再按索引跳转。

## UI 文案 —— 必须走 i18n，禁止硬编码中文

所有用户可见文案（按钮、标签、placeholder、提示、弹窗标题、错误信息、下拉选项）必须通过 `t()` 输出，**禁止在组件里直接写中文字符串**。

**新增/修改文案的流程（顺序不能反）：**

1. 在 `apps/web/src/i18n/locales/zh/<namespace>.json` 加中文 key
2. 在 `apps/web/src/i18n/locales/en/<namespace>.json` 加对应英文 key（key 结构与 zh 完全一致）
3. 组件里 `const { t } = useTranslation()`，用 `t("namespace:key")` 引用

**命名空间**：`common` / `canvas` / `nodes` / `modals` / `settings` / `run` / `errors` / `auth` / `reviews` / `announcements` / `feedback`

**允许硬编码中文的场景（仅限以下四类）：**

- 代码注释
- 术语对照数据（`GlossaryModal.tsx` 的 `GROUPS`）
- 代码示例 placeholder（如 code 节点的脚本示例）
- 语言切换器显示目标语言名（`LanguageSwitcher.tsx` 的「中文」/「English」）

**守护**：`apps/web/src/i18n/keys.test.ts` 会检查 ① `t()` 引用的 key 在 zh/en 都存在 ② zh/en key 结构一致 ③ 源码无硬编码中文 JSX。改完文案必须跑：
`pnpm --filter @agent-world/web exec vitest run src/i18n/keys.test.ts`

## 设计 token —— 颜色/间距/圆角/阴影必须走 CSS 变量

**颜色禁止硬编码** `#hex` / `rgb()` / `hsl()`，必须用 `var(--xxx)`。

- 语义色优先：`--bg-*` `--text-*`（文字） `--border-*` `--success` `--warning` `--error` `--info` `--accent` `--accent-hover` `--accent-active` `--accent-bg`
- 原始 token：`--steel-*` `--power` `--ink` `--ink-dim` `--ink-faint` `--ok` `--warn` `--alert` `--data` `--plasma`
- 间距 `--space-*`（8pt grid）、圆角 `--radius-*`、阴影 `--shadow-*`、字号 `--text-xs/sm/base/lg/...`

> 注意：`--text-*` 有两套——颜色是 `--text-primary/secondary/tertiary/disabled/inverse`，字号是 `--text-xs/sm/base/lg/xl/2xl/3xl/4xl`，别混用。

**禁止（本项目最常被违反，2026-09-04 又踩一次）：**

1. **用不存在的 token 名**——`--danger`、`--border`、`--surface-2`、`--font-mono` 都不存在，会静默失效或 fallback 到裸色。真实名字是 `--error`、`--border-primary`、`--bg-*`、`--mono`。写 `var(--xxx)` 前先 `grep` 确认它在 `:root` / `[data-theme]` 里定义过。
2. **带硬编码 fallback**——`var(--xxx, #hex)` 里的 `#hex` 是藏在 token 后的硬编码，token 不存在时就会生效。禁止写 fallback，token 名必须本身存在。
3. **间距/字号/圆角硬编码 px**——`gap: 8px` / `font-size: 12px` / `border-radius: 8px` 都是违规，必须用 `--gap-*` / `--text-*` / `--radius-*` / `--space-*`。

**允许硬编码颜色的场景（仅限）：**

- token 定义本身（`:root` 和 `[data-theme="light"]` 里的 `--xxx: #hex`）
- SVG 画布节点色（节点类型语义色）
- JSON 语法高亮色
- rgba 透明度变体（功能色的不同透明度，无对应 token）

## Commit 规范

- 英文 `<type>(<scope>): <subject>`，如 `feat(web): migrate X to i18n`
- 原子提交：一次只做一件事
- 不 push（除非用户明确说）
- 作者保持用户身份，不加 AI co-author

## 验证命令

- 类型检查：`pnpm -r typecheck`
- i18n 守护：`pnpm --filter @agent-world/web exec vitest run src/i18n/keys.test.ts`
- web 全量：`pnpm --filter @agent-world/web exec vitest run`

git commit message 规范，看 [git-commit-message.md](git-commit-message.md)
