# i18n 国际化方案

> 状态：待实施 | 优先级：P0 | 创建日期：2026-09-03

## 1. 背景与现状

### 1.1 现状

当前 agent-world 项目：
- **无 i18n 基础设施**：没有引入任何国际化库
- **无语言包**：没有 locale 文件或翻译资源
- **无语言切换**：没有语言选择器或语言偏好设置
- **硬编码中文**：所有 UI 文本（按钮、标签、提示、标题等）均直接写死为中文字符串
- **无本地化格式**：日期、数字、货币等没有按语言区域格式化

### 1.2 为什么需要 i18n

1. **用户群体扩展**：产品面向全球用户，需要支持英文等多语言
2. **专业度提升**：国际化是成熟产品的标配
3. **可维护性**：集中管理文案，修改文案不需要改组件代码
4. **协作效率**：翻译人员可以独立维护语言包，不需要开发参与
5. **未来扩展**：为后续支持更多语言（日语、韩语等）打下基础

## 2. 目标

1. 引入 **i18next + react-i18next** 作为国际化基础设施
2. 建立完整的语言包结构（中文 + 英文）
3. 所有 UI 文本使用 `t()` 函数，消除硬编码中文
4. 支持语言切换 UI，语言偏好持久化
5. 支持日期、数字、货币等本地化格式
6. 支持插值、复数、上下文等复杂翻译场景
7. 建立翻译提取和校验工具链

## 3. 技术选型

### 3.1 方案对比

| 维度 | 自己实现 | i18next + react-i18next | react-intl |
|------|----------|--------------------------|------------|
| 依赖体积 | 0 | ~40KB | ~30KB |
| 插值 | 自己写 | 内置 | 内置 |
| 复数 | 自己处理 | 内置（count） | 内置 |
| 上下文 | 自己处理 | 内置（context） | 内置 |
| 嵌套翻译 | 自己处理 | 内置（$t()） | 不支持 |
| 语言包懒加载 | 自己写 | 内置（backend） | 需自己实现 |
| 翻译提取工具 | 无 | i18next-parser | 需自己实现 |
| React 集成 | 自己写 Context | useTranslation / Trans | FormattedMessage |
| TypeScript | 自己写 | 完善 | 完善 |
| 社区生态 | 无 | 最活跃 | 活跃 |
| 学习成本 | 低 | 中 | 中 |

### 3.2 选型结论

**使用 i18next + react-i18next**，原因：
1. React 生态最成熟的 i18n 方案，社区活跃，文档完善
2. 支持插值、复数、上下文、嵌套翻译等复杂场景
3. 有完善的工具链（翻译提取、校验、管理）
4. 支持语言包懒加载，不增加首屏体积
5. TypeScript 类型支持完善
6. 团队熟悉度高，维护成本低

### 3.3 依赖清单

```json
{
  "dependencies": {
    "i18next": "^23.0.0",
    "react-i18next": "^14.0.0"
  },
  "devDependencies": {
    "i18next-parser": "^8.0.0",
    "i18next-http-backend": "^2.0.0"
  }
}
```

## 4. 目录结构

```
apps/web/src/i18n/
├── index.ts                 # i18n 初始化配置
├── config.ts                # 配置（支持的语言、默认语言等）
├── utils.ts                 # 日期/数字/货币格式化工具
├── hooks/
│   └── useLanguage.ts       # 语言切换 hook
├── locales/
│   ├── zh/
│   │   ├── common.json      # 通用文案（保存/取消/删除等）
│   │   ├── canvas.json      # 画布相关（工具栏/缩放/节点等）
│   │   ├── nodes.json       # 节点类型名称和描述
│   │   ├── modals.json      # 弹窗相关（设置/历史/画廊等）
│   │   ├── settings.json    # 设置页文案
│   │   ├── run.json         # 运行相关（状态/控制/失败等）
│   │   └── errors.json      # 错误提示文案
│   └── en/
│       ├── common.json
│       ├── canvas.json
│       ├── nodes.json
│       ├── modals.json
│       ├── settings.json
│       ├── run.json
│       └── errors.json
└── README.md                # i18n 使用文档
```

## 5. 翻译 Key 命名规范

### 5.1 命名原则

1. **分层命名**：`模块.子模块.具体含义`，如 `canvas.toolbar.addNode`
2. **语义化**：key 描述含义而非内容，如 `common.save` 而非 `common.baoCun`
3. **一致性**：相同含义使用相同 key，避免重复定义
4. **可读性**：key 名称清晰易懂，不使用缩写（除通用缩写）

### 5.2 命名空间

按功能模块划分命名空间，避免 key 冲突：

| 命名空间 | 范围 | 示例 |
|----------|------|------|
| `common` | 通用文案 | `common.save`、`common.cancel`、`common.delete` |
| `canvas` | 画布相关 | `canvas.toolbar.zoomIn`、`canvas.node.textgen` |
| `nodes` | 节点类型 | `nodes.textgen.name`、`nodes.gate.description` |
| `modals` | 弹窗面板 | `modals.settings.title`、`modals.history.empty` |
| `settings` | 设置页 | `settings.model.add`、`settings.apiKey.placeholder` |
| `run` | 运行相关 | `run.status.running`、`run.control.dispatch` |
| `errors` | 错误提示 | `errors.network.timeout`、`errors.auth.failed` |

### 5.3 示例

```json
{
  "common": {
    "save": "保存",
    "cancel": "取消",
    "delete": "删除",
    "confirm": "确认",
    "close": "关闭",
    "search": "搜索",
    "loading": "加载中…",
    "empty": "暂无数据",
    "itemsCount": "共 {{count}} 项",
    "itemsCount_plural": "共 {{count}} 项"
  },
  "canvas": {
    "toolbar": {
      "addNode": "添加节点",
      "zoomIn": "放大",
      "zoomOut": "缩小",
      "fitView": "适应屏幕"
    },
    "node": {
      "textgen": "文坊",
      "imagegen": "画坊",
      "gate": "质检站"
    }
  }
}
```

## 6. 组件改造

### 6.1 基础用法

**改造前：**
```tsx
<button onClick={handleSave}>保存</button>
```

**改造后：**
```tsx
import { useTranslation } from "react-i18next";

function MyComponent() {
  const { t } = useTranslation();
  return <button onClick={handleSave}>{t("common.save")}</button>;
}
```

### 6.2 插值（Interpolation）

```tsx
// zh.json: { "itemsCount": "共 {{count}} 项" }
// en.json: { "itemsCount": "{{count}} items" }

<p>{t("common.itemsCount", { count: 5 })}</p>
// zh: 共 5 项
// en: 5 items
```

### 6.3 复数（Pluralization）

```tsx
// zh.json
// {
//   "nodeCount": "{{count}} 个节点",
//   "nodeCount_other": "{{count}} 个节点"
// }
//
// en.json
// {
//   "nodeCount_one": "{{count}} node",
//   "nodeCount_other": "{{count}} nodes"
// }

<p>{t("common.nodeCount", { count: 1 })}</p>
// zh: 1 个节点
// en: 1 node

<p>{t("common.nodeCount", { count: 2 })}</p>
// zh: 2 个节点
// en: 2 nodes
```

### 6.4 上下文（Context）

```tsx
// zh.json
// {
//   "status": "{{context}}",
//   "status_running": "运行中",
//   "status_done": "已完成",
//   "status_failed": "失败"
// }

<p>{t("run.status", { context: status })}</p>
```

### 6.5 富文本翻译（Trans 组件）

对于包含链接或样式的复杂文本，使用 `Trans` 组件：

```tsx
import { Trans } from "react-i18next";

// zh.json: { "welcome": "欢迎使用 <0>agent-world</0>，点击<1>这里</1>开始" }
<Trans i18nKey="common.welcome">
  欢迎使用 <strong>agent-world</strong>，点击<a href="/start">这里</a>开始
</Trans>
```

### 6.6 命名空间

```tsx
// 使用指定命名空间
const { t } = useTranslation("canvas");
return <button>{t("toolbar.addNode")}</button>;

// 或使用完整 key
const { t } = useTranslation();
return <button>{t("canvas:toolbar.addNode")}</button>;
```

## 7. i18n 初始化

### 7.1 基础配置

```ts
// apps/web/src/i18n/index.ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import zhCommon from "./locales/zh/common.json";
import zhCanvas from "./locales/zh/canvas.json";
import enCommon from "./locales/en/common.json";
import enCanvas from "./locales/en/canvas.json";

i18n.use(initReactI18next).init({
  resources: {
    zh: {
      common: zhCommon,
      canvas: zhCanvas,
    },
    en: {
      common: enCommon,
      canvas: enCanvas,
    },
  },
  lng: "zh", // 默认语言
  fallbackLng: "zh", // 缺失翻译时的回退语言
  defaultNS: "common", // 默认命名空间
  interpolation: {
    escapeValue: false, // React 已经自动转义
  },
  returnNull: false, // 缺失 key 时返回 key 而非 null
});

export default i18n;
```

### 7.2 语言包懒加载（可选优化）

对于大项目，使用 `i18next-http-backend` 按需加载语言包：

```ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import HttpBackend from "i18next-http-backend";

i18n
  .use(HttpBackend)
  .use(initReactI18next)
  .init({
    backend: {
      loadPath: "/locales/{{lng}}/{{ns}}.json",
    },
    lng: "zh",
    fallbackLng: "zh",
  });
```

## 8. 语言切换

### 8.1 语言切换 Hook

```ts
// apps/web/src/i18n/hooks/useLanguage.ts
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from "../config";

export type Language = "zh" | "en";

const STORAGE_KEY = "agent-world-language";

export function useLanguage() {
  const { i18n } = useTranslation();

  const currentLanguage = (i18n.language || DEFAULT_LANGUAGE) as Language;

  const changeLanguage = useCallback(
    (lang: Language) => {
      i18n.changeLanguage(lang);
      localStorage.setItem(STORAGE_KEY, lang);
      document.documentElement.setAttribute("lang", lang);
    },
    [i18n],
  );

  return {
    currentLanguage,
    changeLanguage,
    supportedLanguages: SUPPORTED_LANGUAGES,
  };
}

export function getSavedLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "zh" || saved === "en") return saved;
  // 跟随浏览器语言
  const browserLang = navigator.language.toLowerCase();
  return browserLang.startsWith("zh") ? "zh" : "en";
}
```

### 8.2 语言切换器组件

```tsx
// apps/web/src/components/LanguageSwitcher.tsx
import { useLanguage } from "../i18n/hooks/useLanguage";

export default function LanguageSwitcher() {
  const { currentLanguage, changeLanguage, supportedLanguages } = useLanguage();

  return (
    <select
      value={currentLanguage}
      onChange={(e) => changeLanguage(e.target.value as any)}
      aria-label="Language"
    >
      {supportedLanguages.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.label}
        </option>
      ))}
    </select>
  );
}
```

### 8.3 放置位置

- **设置页**：在设置页添加语言选择区域
- **用户菜单**：在用户下拉菜单中添加语言切换
- **首次启动引导**：在 Onboarding 流程中让用户选择语言

## 9. 本地化格式

### 9.1 日期格式化

```ts
// apps/web/src/i18n/utils.ts
export function formatDate(date: Date | number, lang: string = "zh"): string {
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

export function formatDateTime(date: Date | number, lang: string = "zh"): string {
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

// 使用
formatDate(new Date(), "zh"); // "2026年9月3日"
formatDate(new Date(), "en"); // "Sep 3, 2026"
```

### 9.2 数字格式化

```ts
export function formatNumber(num: number, lang: string = "zh"): string {
  return new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US").format(num);
}

formatNumber(1234567, "zh"); // "1,234,567"
formatNumber(1234567, "en"); // "1,234,567"
```

### 9.3 货币格式化

```ts
export function formatCurrency(
  amount: number,
  lang: string = "zh",
  currency: string = "CNY",
): string {
  return new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

formatCurrency(99.9, "zh", "CNY"); // "¥99.90"
formatCurrency(99.9, "en", "USD"); // "$99.90"
```

### 9.4 相对时间

```ts
export function formatRelativeTime(date: Date | number, lang: string = "zh"): string {
  const diff = Date.now() - new Date(date).getTime();
  const rtf = new Intl.RelativeTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    numeric: "auto",
  });

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return rtf.format(-days, "day");
  if (hours > 0) return rtf.format(-hours, "hour");
  if (minutes > 0) return rtf.format(-minutes, "minute");
  return rtf.format(-seconds, "second");
}

formatRelativeTime(Date.now() - 3600000, "zh"); // "1小时前"
formatRelativeTime(Date.now() - 3600000, "en"); // "1 hour ago"
```

## 10. 工具链

### 10.1 翻译提取（i18next-parser）

配置 `i18next-parser.config.js`：

```js
module.exports = {
  input: ["src/**/*.{ts,tsx}"],
  output: "src/i18n/locales/$LOCALE/$NAMESPACE.json",
  locales: ["zh", "en"],
  defaultNamespace: "common",
  keySeparator: ".",
  namespaceSeparator: ":",
  interpolation: {
    prefix: "{{",
    suffix: "}}",
  },
  sort: true,
  createOldCatalogs: false,
};
```

使用：

```bash
# 提取翻译 key
npx i18next-parser

# 或添加到 package.json scripts
# "i18n:extract": "i18next-parser"
```

### 10.2 翻译校验

自定义脚本检查：
1. 缺失的翻译 key（zh 有但 en 没有）
2. 未使用的翻译 key（语言包中有但代码中没用到）
3. 插值变量一致性（zh 和 en 的插值变量是否一致）

```bash
node scripts/check-i18n.cjs
```

### 10.3 TypeScript 类型支持

为翻译 key 添加类型提示：

```ts
// apps/web/src/i18n/type.d.ts
import "react-i18next";
import zhCommon from "./locales/zh/common.json";

declare module "react-i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: typeof zhCommon;
    };
  }
}
```

## 11. 迁移策略

### 11.1 迁移原则

1. **渐进式迁移**：按模块逐步改造，不一次性重构
2. **中文作为基准**：先完成中文语言包，再翻译英文
3. **新组件用 i18n**：所有新组件必须使用 `t()` 函数
4. **自动化检查**：通过 ESLint 规则禁止硬编码中文

### 11.2 迁移顺序

| 阶段 | 范围 | 预估文本数 | 说明 |
|------|------|-----------|------|
| Phase 1 | 基础设施 | - | i18n 初始化、语言包结构、工具链 |
| Phase 2 | 通用组件 | ~30 | Button、Input、Modal 等基础组件 |
| Phase 3 | 画布相关 | ~50 | Canvas、Toolbar、Inspector、ControlPanel |
| Phase 4 | 弹窗面板 | ~80 | Settings、RunHistory、ProductGallery 等 |
| Phase 5 | 节点组件 | ~40 | 各类型节点的渲染组件 |
| Phase 6 | 英文翻译 | ~200 | 所有中文翻译为英文 |
| Phase 7 | 语言切换 UI | - | 语言切换器、持久化、首次引导 |
| Phase 8 | 本地化格式 | - | 日期、数字、货币格式化 |
| Phase 9 | 清理 | - | 移除硬编码中文、添加 ESLint 规则 |

### 11.3 迁移示例

**改造前：**
```tsx
function Toolbar() {
  return (
    <div>
      <button>添加节点</button>
      <button>放大</button>
      <button>缩小</button>
      <span>共 5 个节点</span>
    </div>
  );
}
```

**改造后：**
```tsx
import { useTranslation } from "react-i18next";

function Toolbar() {
  const { t } = useTranslation("canvas");
  return (
    <div>
      <button>{t("toolbar.addNode")}</button>
      <button>{t("toolbar.zoomIn")}</button>
      <button>{t("toolbar.zoomOut")}</button>
      <span>{t("toolbar.nodeCount", { count: 5 })}</span>
    </div>
  );
}
```

## 12. 组件测试适配

i18n 改造后，组件测试需要 mock `useTranslation`：

```tsx
// apps/web/src/test/utils.tsx
import { render } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      // 简单的 mock，返回 key 或插值后的字符串
      if (options) {
        return key.replace(/\{\{(\w+)\}\}/g, (_, k) => options[k] ?? "");
      }
      return key;
    },
    i18n: {
      changeLanguage: vi.fn(),
      language: "zh",
    },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
```

或使用 `react-i18next` 官方提供的测试工具：

```tsx
import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n";

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}
```

## 13. 验收标准

1. ✅ i18next + react-i18next 基础设施搭建完成
2. ✅ 中文语言包完整（所有 UI 文本抽取）
3. ✅ 英文语言包完整（所有中文翻译为英文）
4. ✅ 所有组件使用 `t()` 函数，无硬编码中文
5. ✅ 支持语言切换 UI，切换后立即生效
6. ✅ 语言偏好持久化到 localStorage
7. ✅ 日期、数字、货币按语言区域格式化
8. ✅ 翻译提取工具可用（`npm run i18n:extract`）
9. ✅ 翻译校验工具可用（缺失 key、未使用 key 检查）
10. ✅ TypeScript 类型提示完善
11. ✅ 组件测试适配 i18n
12. ✅ i18n 使用文档完善

## 14. 风险与注意事项

1. **迁移范围大**：预计有 200+ 处硬编码中文，需要逐个改造，工作量大
2. **翻译质量**：英文翻译需要专业校对，机器翻译可能不准确，建议人工审核
3. **组件测试**：i18n 改造后需要更新所有组件测试，mock useTranslation
4. **插值一致性**：确保 zh 和 en 的插值变量一致，避免运行时报错
5. **复数规则**：不同语言的复数规则不同（英语有 one/other，中文只有 other），需要正确配置
6. **字符串拼接**：代码中避免字符串拼接（如 `"共" + count + "项"`），改用插值
7. **第三方组件**：如果使用第三方 UI 库，需要确保其支持 i18n 或单独处理
8. **SEO**：如果是 SSR 应用，需要考虑 hreflang 标签和语言路由

## 15. 相关文档

- [设计 Token 体系完善方案](./design-design-tokens.md)
- [组件测试方案](./web-component-testing-plan.md)
- [项目进度](./project-progress.md)
- [i18next 官方文档](https://www.i18next.com/)
- [react-i18next 官方文档](https://react.i18next.com/)
