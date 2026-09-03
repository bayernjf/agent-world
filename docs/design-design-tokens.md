# 设计 Token 体系完善方案

> 状态：待实施 | 优先级：P0 | 创建日期：2026-09-03

## 1. 背景与现状

### 1.1 现有 Token

当前 `apps/web/src/styles.css` 中定义了 **26 个 CSS 变量**：

| 类别 | Token | 数量 |
|------|-------|------|
| 中性色 | `--steel-950` ~ `--steel-400` | 8 个色阶 |
| 功能色 | `--power`、`--power-dim`、`--data`、`--ok`、`--warn`、`--alert`、`--plasma` | 7 个 |
| 文字色 | `--ink`、`--ink-dim`、`--ink-faint` | 3 个 |
| 字体 | `--mono`、`--sans` | 2 个 |
| 效果 | `--bevel`（斜面高光）、`--hair`（细线边框） | 2 个 |
| 层级 | `--z-canvas-chrome`、`--z-toast`、`--z-modal`、`--z-popover` | 4 个 |

### 1.2 存在的问题

1. **缺失基础 Token**：没有间距、圆角、阴影、动画、字号、行高、字重等设计系统基础变量
2. **无语义化层**：组件直接使用原始色值（如 `var(--steel-800)`），而非语义 token（如 `var(--bg-panel)`），导致主题切换困难
3. **无明暗主题**：只有暗色主题，无法切换亮色主题
4. **无 Token 源文件**：只有 CSS 变量，没有 JSON/TS 格式的单一数据源，无法跨平台复用
5. **硬编码值散落**：组件中大量硬编码 `14px`、`8px`、`4px` 等值，缺乏统一规范

## 2. 目标

1. 建立完整的 **三层 Token 架构**（Primitive → Semantic → Component）
2. 补充缺失的基础 Token（间距、圆角、阴影、动画、字号、行高、字重）
3. 建立语义化 Token 层，组件统一使用语义 token
4. 支持明暗主题切换
5. 建立 Token 源文件（JSON），作为单一数据源
6. 现有组件逐步迁移到新 Token 体系

## 3. Token 分层架构

### 3.1 Primitive Tokens（原始值层）

不可再分的基础设计变量，不绑定任何语义。

#### 3.1.1 颜色

```css
/* 中性色 - 扩展到 12 个色阶 */
--color-steel-50: #f5f7f8;
--color-steel-100: #e8edf0;
--color-steel-200: #d1dbe0;
--color-steel-300: #a8b8c2;
--color-steel-400: #7c909d;
--color-steel-500: #5d7280;
--color-steel-600: #4a5c69;
--color-steel-700: #3d4c57;
--color-steel-800: #344049;
--color-steel-900: #2d373f;
--color-steel-950: #1a2127;

/* 功能色 */
--color-power: #ffb020;
--color-power-dim: #7a5310;
--color-data: #35e0f0;
--color-ok: #66e07a;
--color-warn: #ff9d2e;
--color-alert: #ff4a3d;
--color-plasma: #b467ff;
```

#### 3.1.2 间距（4px 基准）

```css
--space-0: 0;
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
```

#### 3.1.3 圆角

```css
--radius-none: 0;
--radius-sm: 4px;
--radius-md: 8px;
--radius-lg: 12px;
--radius-xl: 16px;
--radius-2xl: 24px;
--radius-full: 9999px;
```

#### 3.1.4 阴影

```css
--shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.3);
--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.4), 0 1px 2px rgba(0, 0, 0, 0.3);
--shadow-md: 0 4px 6px rgba(0, 0, 0, 0.4), 0 2px 4px rgba(0, 0, 0, 0.3);
--shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.4), 0 4px 6px rgba(0, 0, 0, 0.3);
--shadow-xl: 0 20px 25px rgba(0, 0, 0, 0.4), 0 10px 10px rgba(0, 0, 0, 0.3);
--shadow-2xl: 0 25px 50px rgba(0, 0, 0, 0.5);
```

#### 3.1.5 字号

```css
--font-size-xs: 12px;
--font-size-sm: 13px;
--font-size-base: 14px;
--font-size-lg: 16px;
--font-size-xl: 18px;
--font-size-2xl: 20px;
--font-size-3xl: 24px;
--font-size-4xl: 30px;
```

#### 3.1.6 行高

```css
--line-height-tight: 1.25;
--line-height-normal: 1.5;
--line-height-relaxed: 1.625;
--line-height-loose: 2;
```

#### 3.1.7 字重

```css
--font-weight-normal: 400;
--font-weight-medium: 500;
--font-weight-semibold: 600;
--font-weight-bold: 700;
```

#### 3.1.8 动画

```css
--duration-fast: 100ms;
--duration-normal: 200ms;
--duration-slow: 300ms;
--ease-default: cubic-bezier(0.4, 0, 0.2, 1);
--ease-in: cubic-bezier(0.4, 0, 1, 1);
--ease-out: cubic-bezier(0, 0, 0.2, 1);
```

#### 3.1.9 层级

```css
--z-canvas: 0;
--z-canvas-chrome: 5;
--z-dropdown: 100;
--z-sticky: 200;
--z-drawer: 400;
--z-toast: 600;
--z-modal: 800;
--z-popover: 1000;
```

### 3.2 Semantic Tokens（语义层）

绑定使用场景的 token，引用 primitive token。支持主题切换。

#### 3.2.1 背景

```css
/* 暗色主题（默认） */
:root {
  --bg-canvas: var(--color-steel-950);
  --bg-panel: var(--color-steel-900);
  --bg-elevated: var(--color-steel-800);
  --bg-hover: rgba(255, 255, 255, 0.05);
  --bg-active: rgba(255, 255, 255, 0.08);
  --bg-input: var(--color-steel-850);
  --bg-disabled: var(--color-steel-800);
}

/* 亮色主题 */
[data-theme="light"] {
  --bg-canvas: #f5f7f8;
  --bg-panel: #ffffff;
  --bg-elevated: #ffffff;
  --bg-hover: rgba(0, 0, 0, 0.04);
  --bg-active: rgba(0, 0, 0, 0.06);
  --bg-input: #f0f3f5;
  --bg-disabled: #e8edf0;
}
```

#### 3.2.2 文字

```css
:root {
  --text-primary: var(--color-ink);
  --text-secondary: var(--color-ink-dim);
  --text-tertiary: var(--color-ink-faint);
  --text-inverse: var(--color-steel-950);
  --text-disabled: var(--color-steel-600);
}

[data-theme="light"] {
  --text-primary: var(--color-steel-900);
  --text-secondary: var(--color-steel-600);
  --text-tertiary: var(--color-steel-400);
  --text-inverse: #ffffff;
  --text-disabled: var(--color-steel-300);
}
```

#### 3.2.3 边框

```css
:root {
  --border-default: var(--color-steel-700);
  --border-strong: var(--color-steel-600);
  --border-subtle: var(--color-steel-800);
}

[data-theme="light"] {
  --border-default: var(--color-steel-200);
  --border-strong: var(--color-steel-300);
  --border-subtle: var(--color-steel-100);
}
```

#### 3.2.4 功能色（语义）

```css
:root {
  --color-power-bg: rgba(255, 176, 32, 0.1);
  --color-power-text: var(--color-power);
  --color-ok-bg: rgba(102, 224, 122, 0.1);
  --color-ok-text: var(--color-ok);
  --color-warn-bg: rgba(255, 157, 46, 0.1);
  --color-warn-text: var(--color-warn);
  --color-alert-bg: rgba(255, 74, 61, 0.1);
  --color-alert-text: var(--color-alert);
}
```

### 3.3 Component Tokens（组件层，可选）

特定组件的 token 覆盖，用于组件级定制。

```css
:root {
  --btn-primary-bg: var(--color-power);
  --btn-primary-text: var(--color-steel-950);
  --btn-primary-hover-bg: #ffc040;
  --btn-secondary-bg: var(--bg-elevated);
  --btn-secondary-text: var(--text-primary);
  --input-height: 32px;
  --modal-border-radius: var(--radius-lg);
}
```

## 4. 目录结构

```
apps/web/src/design-tokens/
├── tokens.json              # Primitive tokens 定义（单一数据源）
├── semantic.json            # Semantic tokens 定义
├── themes/
│   ├── dark.json            # 暗色主题语义映射
│   └── light.json           # 亮色主题语义映射
├── index.ts                 # TS 导出，供 JS 使用
└── README.md                # Token 使用文档
```

### 4.1 tokens.json 示例

```json
{
  "color": {
    "steel": {
      "50": "#f5f7f8",
      "100": "#e8edf0",
      "950": "#1a2127"
    },
    "power": "#ffb020",
    "ok": "#66e07a"
  },
  "space": {
    "0": "0",
    "1": "4px",
    "2": "8px"
  },
  "radius": {
    "sm": "4px",
    "md": "8px"
  }
}
```

### 4.2 构建生成

通过构建脚本将 JSON 转换为 CSS 变量：

```bash
# 生成 CSS 变量
node scripts/generate-tokens.cjs
```

输出 `apps/web/src/styles/tokens.css`，在 `main.tsx` 中引入。

## 5. 迁移策略

### 5.1 迁移原则

1. **渐进式迁移**：不一次性重构所有组件，按模块逐步迁移
2. **向后兼容**：保留旧 token 变量名一段时间，标记为 deprecated
3. **新组件用新 token**：所有新组件必须使用语义 token
4. **自动化检查**：通过 ESLint 规则禁止使用硬编码色值和旧 token

### 5.2 迁移顺序

| 阶段 | 范围 | 说明 |
|------|------|------|
| Phase 1 | 基础设施 | 建立 token 源文件、生成脚本、CSS 变量 |
| Phase 2 | 基础组件 | Button、Input、Modal、Tooltip 等基础组件 |
| Phase 3 | 画布相关 | Canvas、Toolbar、Inspector、ControlPanel |
| Phase 4 | 弹窗面板 | Settings、RunHistory、ProductGallery 等 |
| Phase 5 | 节点组件 | 各类型节点的渲染组件 |
| Phase 6 | 清理 | 移除旧 token、硬编码值，添加 ESLint 规则 |

### 5.3 迁移示例

**改造前：**
```css
.panel {
  background: var(--steel-800);
  color: var(--ink);
  border: 1px solid var(--steel-700);
  border-radius: 8px;
  padding: 16px;
}
```

**改造后：**
```css
.panel {
  background: var(--bg-panel);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: var(--space-4);
}
```

## 6. 明暗主题切换

### 6.1 实现方式

```ts
// theme.ts
export type Theme = "dark" | "light";

export function setTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
}

export function getTheme(): Theme {
  const saved = localStorage.getItem("theme");
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
```

### 6.2 主题切换 UI

在设置页或用户菜单添加主题切换器：
- 暗色 / 亮色 / 跟随系统 三个选项
- 切换后立即生效，持久化到 localStorage

## 7. 验收标准

1. ✅ Primitive tokens 完整（颜色、间距、圆角、阴影、字号、行高、字重、动画、层级）
2. ✅ Semantic tokens 完整（背景、文字、边框、功能色）
3. ✅ 支持明暗主题切换
4. ✅ Token 源文件（JSON）作为单一数据源
5. ✅ 基础组件全部迁移到语义 token
6. ✅ 无硬编码色值（通过 ESLint 检查）
7. ✅ 旧 token 标记为 deprecated 或移除
8. ✅ Token 使用文档完善

## 8. 风险与注意事项

1. **迁移范围大**：现有组件较多，需要逐步迁移，避免一次性重构引入 bug
2. **颜色对比度**：亮色主题需要确保文字与背景的对比度符合 WCAG AA 标准
3. **组件测试**：迁移后需要更新现有组件测试，确保样式类名正确
4. **第三方组件**：如果使用第三方 UI 库，需要确保其支持主题定制
5. **图片资源**：暗色/亮色主题下的图片资源可能需要不同版本

## 9. 相关文档

- [i18n 国际化方案](./design-i18n.md)
- [组件测试方案](./web-component-testing-plan.md)
- [项目进度](./project-progress.md)
