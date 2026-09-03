# Agent Instructions

Agent World 项目的 AI 编码规范。写任何代码前先读本节，尤其是「UI 文案」和「设计 token」两条——这是本项目最常被违反的约定。

## UI 文案 —— 必须走 i18n，禁止硬编码中文

所有用户可见文案（按钮、标签、placeholder、提示、弹窗标题、错误信息、下拉选项）必须通过 `t()` 输出，**禁止在组件里直接写中文字符串**。

**新增/修改文案的流程（顺序不能反）：**

1. 在 `apps/web/src/i18n/locales/zh/<namespace>.json` 加中文 key
2. 在 `apps/web/src/i18n/locales/en/<namespace>.json` 加对应英文 key（key 结构与 zh 完全一致）
3. 组件里 `const { t } = useTranslation()`，用 `t("namespace:key")` 引用

**命名空间**：`common` / `canvas` / `nodes` / `modals` / `settings` / `run` / `errors` / `auth` / `reviews`

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
