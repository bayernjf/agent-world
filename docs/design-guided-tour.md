# 新用户分步引导（Guided Tour）设计（design-guided-tour）

> 定位：新用户**创建第一条产线、进入工作区之后**的分步教学引导（聚光灯高亮 + 「上一步 / 下一步 / 跳过」卡片），解决"进了画布不知道先点哪"的问题。创建：2026-09-11。
>
> 状态：**方案设计（未实施）**。架构已升级为**多引导可扩展注册中心**（见 §十二）：引擎通用、引导即数据，首次引导只是 Registry 第一条，未来新版本/新功能引导零引擎改动。延续项目约定：i18n zh/en 全 `t()`、设计 token、组件必有测试、原子提交英文 message、不 push。
>
> 关联：现有空态选模板见 `components/Onboarding.tsx`；常驻上下文提示见 `store/tips.ts` + `canvas/Plants.tsx`；命令面板见 `App.tsx`；i18n 约定见 [design-i18n.md](design-i18n.md)；设计 token 见 [design-design-tokens.md](design-design-tokens.md)。

---

## 一、目标与非目标

### 目标
1. 新用户建好第一条产线、进入工作区后，**自动**开始一次 6-7 步的分步引导：聚光灯圈出当前讲解的界面区域，旁边一张卡片给一句话标题 + 一两句说明。
2. 卡片提供 **上一步 / 下一步 / 跳过**，显示「第 x 步 / 共 n 步」，最后一步按钮变「开始使用 / 完成」。
3. 可**随时手动重看**：⌘K 命令面板「重新观看新手引导」。
4. 看过一次不再自动弹（localStorage 版本化标记）；不强制、不阻塞，Esc / 跳过随时退出。

### 非目标（本期不做）
- **不做"必须操作才能下一步"的交互式引导**（不要求用户真的拖出一个节点 / 真的派发一次才放行）——容易在异常状态下卡死，本期只做"讲解 + 高亮"，用户可纯点下一步看完。
- 不做界面上常驻的功能脉冲点（pulse beacon）/ 待办清单式 onboarding checklist。
- 不做引导视频、不做示例数据自动注入（空态选模板已承担"给一个起点"）。
- 不改造现有 `Onboarding.tsx`（空态选模板页）与 `tips`（hover 铭牌），三者分工见 §三。

---

## 待决策点（评审拍板，括号内为推荐默认；未确认则全部按默认执行）

| # | 决策点 | 选项 | 推荐默认 | 落点 |
| --- | --- | --- | --- | --- |
| D1 | 首次引导步数 | 7 步（含首尾）/ 5 步精简 | **7 步**；步骤纯配置化，评审后可一键切 5 步精简版 | §六 |
| D2 | 存量老用户首次升级是否自动弹 | 都自动弹一次 / 老用户不自动弹 | **不自动弹**：自动触发只挂在「会话内 0→1 建首条产线」时刻（§五/§12.4），老用户不再经历该时刻，仅帮助中心 / ⌘K 可手动看 | §12.4 |
| D3 | 点遮罩是否等于「下一步」 | 是 / 否 | **否**，仅按钮 / Esc 可控，防误触 | §八 |
| D4 | 是否 v1 就按多引导注册中心架构实现 | 先单引导后重构 / v1 直接多引导 | **v1 直接多引导**（约 +15% 工作量，换未来零成本加引导） | §12.13 |
| D5 | 「What's new」帮助中心本期做到什么程度 | 完整 / 最小版 / 只做 ⌘K | **最小版**：账户菜单列引导清单（已看 ✓ / 重看）；⌘K 按 Registry 动态注册为必做 | §12.9 |
| D6 | 引导埋点本期是否实现 | 实现 / 仅预留接口 | **仅预留接口**（tour:start/step/complete/skip），不接 metrics | §12.11 |

---

## 二、现状盘点（2026-09-11 代码核对）

| 现状 | 事实 | 对本方案的影响 |
| --- | --- | --- |
| `components/Onboarding.tsx` | 仅在 `graphsReady && graphs.length === 0` 时整页渲染（`App.tsx` L904），本质是**空态模板选择器**（hero 文案 + TemplatePicker + 引擎探活），不是分步 tour | 保留不动；它负责"从 0 到 1 建产线"，本方案负责"建好之后认识工作区" |
| `store/tips.ts` + 顶栏「提示」chip + `canvas/Plants.tsx` | `aw.tips` 开关，控制画布节点 hover 时的 nameplate（类型/模型等），是**常驻、被动**的上下文提示 | 与 tour 互补：tour 是一次性主动教学，tips 是长期被动提示；tour 第 4 步可引导用户"hover 节点会看到说明，可用顶栏「提示」关闭" |
| 工作区 DOM 骨架 | `.hud` 顶栏（`.hud__brand` / `.hud__meta` 产线选择器 / `.hud__actions`）、左侧控制面板、`.canvas-toolbar-row`（2D / +原料台/+文坊/+质检站/+画坊/+API口岸/+成品库）、画布、右侧 Inspector（`.inspector-drag-handle`） | 这些 class 是 tour 的锚点候选；但**不直接用 class 定位**，统一加 `data-tour` 专用属性（见 §六） |
| `store/view-mode.ts` | `viewMode: "2d" \| "3d" \| "park"`，`setViewMode`，zustand persist 持久化 | tour 只在 2D 有稳定 DOM 锚点；开始时强制切 2d、记住原值、结束恢复 |
| 持久化约定 | tips 用 `localStorage["aw.tips"]`；主题用 `agent-world-theme`；view-mode 用 zustand persist | tour seen 最终按 `aw.tour.seen:{tourId}:{version}` 隔离（见 §12.5）；首次引导即 `aw.tour.seen:first-run:1.0.0`，版本 bump 后老用户可重看 |
| i18n | 命名空间在 `i18n/index.ts` 三处注册（import / resources.zh/en / ns 数组），locale 在 `i18n/locales/{zh,en}/<ns>.json`；`keys.test` 四校验（zh/en 同 key、值非空且不等于 key、源码无硬编码中文） | 新建 `tour` 命名空间，zh/en 同构；卡片所有可见文案走 `t()` |
| z-index 层级 | 全仓最高 `z-index:1000`（`.onboarding` 整页 / 模态层），其余 2/3/4/5/20/60 | tour 遮罩层取 **`z-index:1100`**，保证压过模态与 onboarding（实际不会同时出现） |
| 组件测试约定 | `components/*.tsx` 基本配 `.test.tsx`，vitest + @testing-library/react + jsdom，`test/setup.ts` 已全局 mock ResizeObserver/IntersectionObserver、强制 i18n zh | 新增 `GuidedTour.test.tsx`；getBoundingClientRect 在 jsdom 全 0，定位逻辑要抽纯函数便于单测 |

---

## 三、三个"引导类"机制的分工（避免重复造轮子）

```
新用户旅程：
  注册/登录
    └─ 0 条产线 → Onboarding.tsx 整页选模板（已有，保留）
         └─ 选模板/空白 → createGraph → 进入工作区
              └─ 首次进入 → GuidedTour 自动开始（本方案，一次性，6-7 步）
                   └─ 日常使用 → tips hover 铭牌（已有，常驻开关）+ ⌘K 随时重看 tour
```

- **Onboarding（空态选模板）**：解决"建什么"。
- **GuidedTour（本方案）**：解决"建好后怎么用"，一次性、分步、可重看。
- **tips（hover 铭牌 + 提示开关）**：解决"忘了的时候随时看"，长期被动。

三者状态独立、互不依赖，不合并。

---

## 四、自建 vs 引库

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| **react-joyride** | React 原生、spotlight/步骤/回调齐全、star 多 | ~30kb+，自带样式与定位魔法，深度定制工业风/明暗主题成本高；i18n 要全量覆盖其内置字符串；与自定义 canvas 视图切换仍要自己处理 | 不推荐 |
| **driver.js** | 轻量（~5kb）、spotlight 效果好、框架无关 | 非 React，需要自己包一层生命周期；样式仍要覆盖以贴合 token；DOM 锚点在面板折叠/视图切换时同样要自己兜底 | 可作为"想最快出效果"的备选 |
| **自建轻量 GuidedTour** | 原生贴合设计 token / 明暗主题 / i18n；定位与降级完全可控（本应用画布是自定义 SVG/WebGL，第三方库反而处处要适配）；体量小（单组件 + store + 步骤表，预计 ~350 行）；可测性最好 | 聚光灯/定位/边界翻转要自己写（逻辑不复杂） | **推荐** |

**推荐自建**：本项目已有强约束（token、i18n keys.test、组件必测、明暗双主题、2d/3d/park 三视图），第三方库省下的代码会在覆盖样式、接入 i18n、处理视图切换上加倍还回来；聚光灯用一个 fixed 遮罩 + `box-shadow: 0 0 0 9999px rgba(0,0,0,.55)` 挖洞即可，定位是标准 `getBoundingClientRect()`，没有技术难点。

---

## 五、触发时机与生命周期

> 本节描述**首次引导（first-run）**的生命周期；通用的多引导 targeting 求值、每会话 1 个 + 24h 冷却调度见 §12.4 / §12.6，持久化按 §12.5 的 `tourId:version`。

### 自动触发（仅首次）
1. 触发时刻：**会话内从 0 条产线创建出首条产线**（`createGraph` 前 `graphs.length===0`），进入工作区首帧后延迟 ~400ms（等面板/画布布局稳定）再 `start("first-run")`；且 `aw.tour.seen:first-run:1.0.0` 不存在、24h 自动冷却未命中。
2. 该机制天然只命中新用户：存量老用户升级后不会再经历 0→1，**绝不会被自动打扰**（落实 D2），只在帮助中心 / ⌘K 提供手动入口；无需为 targeting 额外拉取 run 历史（详见 §12.4）。
3. 边界：若新用户建完首条产线后、看完引导前刷新页面，本次不会再自动弹（非 0→1），可由 ⌘K/帮助中心手动重看——v1 接受该边界。

### 手动重看
- ⌘K 命令面板按 Registry **动态生成**每个引导的重看命令 `replay-tour:{id}`（first-run 即「重新观看新手引导」），执行 `start(id)`，无需逐个手写（见 §12.9）。
- 账户菜单「引导与新功能」最小版（D5）列出全部引导及已看状态。

### 结束
- 点「跳过」「完成」或按 Esc：写 `aw.tour.seen:{tourId}:{version}`、`active=false`、恢复进入前的 viewMode。
- 「上一步」在第 0 步禁用；「下一步」到最后一步变为「完成」。

### 视图与互斥
- `start()` 时记录当前 viewMode 并强制 `setViewMode("2d")`；`finish/skip` 时恢复。
- tour 激活期间：屏蔽 2D/3D/park 切换、屏蔽可能改变布局的快捷键（删节点/铺管等），命令面板/其他模态不响应打开（或直接被 z-index 1100 盖住）。
- tour 激活期间不轮询触发会改变 DOM 的操作（如自动选中节点），保证锚点稳定。

---

## 六、分步脚本（核心）

> 主引导控制在 **7 步（含首尾）**，每步一句话标题 + 最多两句说明，避免说教。锚点统一用新增的 `data-tour="<id>"` 属性（比 class 稳定，重构 class 不影响引导）。

| # | data-tour 锚点 | 卡片方位 | 讲什么（要点，最终文案走 i18n） | 进入前动作 |
| --- | --- | --- | --- | --- |
| 0 | 无（居中欢迎卡 `placement:center`） | center | 欢迎：Agent World 是把 LLM/工具/质检编排成"能跑完的 AI 产线"的画布；用工厂隐喻——原料台投料、文坊生产、质检站把关、成品库出货 | — |
| 1 | `raw-material`（左侧原料 textarea + 派发区容器） | right | **原料台**：把素材或任务写在这里，是产线的输入口 | 确保左侧面板展开 |
| 2 | `node-toolbar`（`.canvas-toolbar-row`） | bottom | **工位工具条**：文坊=LLM 生成、质检站=规则/AI 把关、画坊=生图、API 口岸=外部工具、成品库=产出；点一下就在画布加一个工位 | — |
| 3 | `canvas-stage`（整个画布容器） | center（框住画布） | **画布与管道**：工位之间拉线就是物料流动方向；hover 工位会显示它的类型/模型（顶栏「提示」可开关铭牌） | viewMode 已强制 2d |
| 4 | `dispatch`（左侧「派发任务」按钮） | right | **派发任务**：在「设置 / 模型分配」里给文坊选好模型后，点这里整条产线就跑起来 | — |
| 5 | `inspector`（右侧节点详情面板） | left | **节点配置**：点选任意工位，在这里改 prompt、模型、参数；质检站在这里设禁用词/规则 | 若右侧折叠则展开；无选中节点时自动选中第一个节点，失败则降级居中 |
| 6 | `hud-actions`（`.hud__actions`：运行历史/待审核/成品库/运营工作台/⌘K） | bottom | **看结果与全局**：运行历史看每次运行与成本，待审核处理被拦下的产出，⌘K 命令面板能快速做任何事；引导可随时在 ⌘K 重看 | — |
| 7 | 无（居中完成卡） | center | 就绪：你已经认识整条产线了，去投料跑一次吧 | 恢复 viewMode、写 seen |

**精简备选（5 步版）**：0 欢迎 → 1 原料台 → 2 工具条+画布合并 → 4 派发 → 6 顶栏/完成。若评审觉得 7 步偏长，用这版；默认先实现 7 步，步骤表是配置化的，删减只改步骤数组。

### 锚点缺失降级（关键，不能卡死）
- 每步渲染前查 `document.querySelector([data-tour=id])`：
  - 存在 → 聚光灯圈住，卡片按方位贴边。
  - 不存在（面板被折叠/节点没选中/视图异常）→ 先执行该步 `before()`（展开面板/选中首节点）再查一次；仍无 → **降级为居中卡片**（无聚光灯），保证流程可继续。
- 等待锚点：目标可能在视图切换后一帧才出现，用最多 ~500ms 的 rAF 轮询等目标，超时即降级，不无限等。

---

## 七、技术设计

### 7.1 文件清单（新增 / 修改）

> 最终目录以 §12.2 的多引导结构为准（`store/guided-tour.ts` 通用 store + `tours/` 注册中心与各引导定义 + `components/GuidedTour.tsx` 通用引擎）。下列为职责清单：

**新增**
- `apps/web/src/store/guided-tour.ts` — 通用 zustand store（见 7.2，按 activeTourId 渲染，不绑定 first-run）
- `apps/web/src/tours/tour-types.ts` — TourDef / StepDef / Targeting / TourContext 类型
- `apps/web/src/tours/index.ts` — TourRegistry（`TOURS`），含 first-run，未来引导在此注册
- `apps/web/src/tours/first-run.tour.ts` — 首次引导步骤配置（§六），纯数据 + 可选 before 标识
- `apps/web/src/tours/primitives.ts` — welcomeStep/commandPaletteStep/hudActionsStep/finishStep 复用原语
- `apps/web/src/components/GuidedTour.tsx` — 通用引擎：遮罩 + 聚光灯 + 卡片 + 定位
- `apps/web/src/components/guided-tour-engine.ts` — placeCard 等定位/聚光灯纯函数
- `apps/web/src/components/GuidedTour.test.tsx`、引擎纯函数测试
- `apps/web/src/i18n/locales/zh/tour.json`、`.../en/tour.json` — tour 命名空间（按 tour id 前缀分 key，见 §12.10）

**修改**
- `apps/web/src/i18n/index.ts` — 三处注册 `tour` 命名空间
- `apps/web/src/App.tsx` — 挂载 `<GuidedTour/>`；首条产线自动触发（过 targeting + 调度）；⌘K 按 Registry 动态生成重看命令；账户菜单加最小版「引导与新功能」
- 现有工作区 JSX：给原料区/工具条/画布/派发按钮/Inspector/`.hud__actions` 加 `data-tour` 锚点（命名见 §12.7）
- `apps/web/src/styles.css` — `.guided-tour*` 样式 + 新增 `--color-scrim` token（全部走设计 token）

### 7.2 Store（`store/guided-tour.ts`，通用，不绑定具体引导）

```ts
type Placement = "top" | "bottom" | "left" | "right" | "center";
interface GuidedTourState {
  activeTourId: string | null;
  index: number;
  total: number;
  start: (tourId: string, at?: number) => void;  // 过 targeting、切 2d、置 active、index=0
  next: () => void;                              // 最后一步 -> finish()
  back: () => void;
  goTo: (i: number) => void;
  skip: () => void;                              // markSeen、恢复视图、active=null
  finish: () => void;                            // 同 skip 但语义为完成
}
```
- seen 不用 zustand persist，自己读写，通用 helper `hasSeen(tourId, version)` / `markSeen(tourId, version)`，key 形如 `aw.tour.seen:first-run:1.0.0`（§12.5）；另导出 `canShowTour(tour, ctx)` 做 targeting 求值（§12.4）与 `pickAutoTour(ctx)` 做每会话 1 个 + 24h 冷却调度（§12.6）。
- 视图切换不写进 store（store 保持纯 UI 状态），由当前 TourDef 的 `onStart/onFinish` 钩子或组件在 start/finish 时调 `useViewMode`。

### 7.3 定位引擎（抽纯函数，便于 jsdom 单测）
- `placeCard(targetRect, placement, cardSize, viewport): {top,left,arrow}`：纯函数，输入目标矩形/方位/卡片尺寸/视口，输出卡片坐标；含**视口边界翻转**（右边放不下翻 left、下边放不下翻 top）与最小边距（用 `--space-*` 数值常量）。
- 组件侧：`useLayoutEffect` 依据当前步骤 `querySelector` 拿 `getBoundingClientRect()`，调 `placeCard`；`window` 的 `resize`/`scroll` 用 rAF 节流重算；步骤切换时重算。
- jsdom 下 `getBoundingClientRect` 全 0：纯函数用假 rect 单测；组件测试只验证流程与降级，不断言像素位置。

### 7.4 聚光灯与遮罩
- 一个 `position:fixed; inset:0; z-index:1100` 的容器，分两层：
  - **挖洞框**：一个绝对定位 div 贴住目标 rect（带 6-8px padding、圆角用 `--radius-lg`、2px `--accent` 描边），其 `box-shadow: 0 0 0 9999px var(--color-scrim, rgba(0,0,0,.55))` 用大阴影把框外压暗 = 聚光灯效果（比 SVG path 挖洞简单、无滚动条问题）。
  - **卡片**：另一绝对定位 div，`--bg-elevated` 背景、`--shadow-modal`、`--radius-lg`、`--space-*` 内边距；含步骤标题、说明、进度（「第 x / n 步」或进度点）、`上一步 / 下一步（完成）/ 跳过`。
- center 步：不画挖洞框，卡片水平垂直居中、scrim 全屏。
- 过渡：透明度/位移 150-200ms（用 `--duration-fast/normal` + `--ease-default/out` token），并尊重 `prefers-reduced-motion`（媒体查询下关动画）。

### 7.5 可访问性（a11y）
- 卡片容器 `role="dialog" aria-modal="true" aria-labelledby aria-describedby`。
- **焦点陷阱**：打开时焦点落到「下一步」，Tab/Shift+Tab 在卡片内三个按钮间循环，关闭后焦点回到触发前元素。
- `Esc` 键 = skip；`→` 下一步、`←` 上一步（可选增强，先实现 Esc）。
- 按钮有明确 aria-label；进度对读屏器用 `aria-live="polite"` 报当前步骤。

### 7.6 视觉与主题（token 名已按 styles.css 实测核对）
- 全部走真实 semantic token：背景 `--bg-elevated`、正文 `--text`、次级文字 `--text-muted/--text-secondary`、边框 `--border-primary/--border-secondary`、主色 `--accent`（hover `--accent-hover`、其上文字 `--accent-contrast`）、间距 `--space-*`、圆角 `--radius-lg`、阴影 `--shadow-modal`、动效 `--duration-*` + `--ease-default`，不写死色值，暗色与 `[data-theme=light]` 都验证。
- scrim 颜色：已核对（2026-09-11）token 体系里**没有**现成遮罩/scrim 变量（现有模态背景是各组件内联 rgba），因此在 primitive/semantic 层新增 `--color-scrim`（暗色 `rgba(0,0,0,.55)`、亮色 `rgba(15,23,42,.45)`），同时供后续模态统一复用。

---

## 八、边界与异常清单

| 场景 | 处理 |
| --- | --- |
| 0 产线（空态） | 不触发 tour（此时是 Onboarding 选模板页，无工作区锚点） |
| 当前在 3D / park 视图 | start 强制切 2d 并记原值，finish/skip 恢复 |
| 左/右面板被折叠 | 相关步骤 before 展开面板；展不开则该步降级居中卡 |
| 第 5 步无选中节点 | before 自动选中第一个节点；无节点（空白产线）则降级居中，不报错 |
| 锚点渲染延迟 | ≤500ms rAF 等待，超时降级居中 |
| 窗口 resize / 滚动 | rAF 节流重新定位；目标滚出视口时 `scrollIntoView({block:"center"})`（本应用工作区基本不滚动，主要兜底） |
| 窄屏 | 桌面优先产品；视口宽度 < 960px 不自动触发，手动重看时卡片改居中布局（不贴边） |
| tour 中用户点遮罩 | 默认点 scrim 不推进也不关闭（防误触），仅按钮/Esc 可控；是否"点遮罩=下一步"留评审，默认否 |
| 与公告/命令面板/其他模态同时 | tour 激活时不打开其他浮层；tour z-index 最高兜底 |
| 步骤文案改版 | bump 该 TourDef 的 `version`（如 first-run 1.0.0→1.1.0），seen key 变化后用户再自动看一次；存量账号是否弹由 targeting 决定（§12.4/12.5） |
| 语言切换 | 卡片文案实时随 i18n 语言变化（本来就是 t()），无需特殊处理 |

---

## 九、测试与验收

### 9.1 单元 / 组件测试（`GuidedTour.test.tsx` + 引擎/targeting 纯函数测试）
1. 无 seen 标记 + 首条产线 + targeting 通过 → 自动 `start("first-run")`，显示第 0 步欢迎卡。
2. 「下一步」步进、「上一步」回退（第 0 步上一步禁用）；到最后一步主按钮文案为「完成」。
3. 「完成」与「跳过」「Esc」三种方式都关闭并写入 `aw.tour.seen:first-run:1.0.0`，恢复原 viewMode。
4. 已有 seen 标记 → 不自动弹；⌘K / 帮助中心手动调 `start(id)` 仍可开始。
5. targeting：存量用户（有 run 历史）不满足 first-run targeting → 不自动弹（D2）；`canShowTour` 对 featureFlags/minGraphCount/seenTours 各谓词正确求值。
6. 调度：多个 eligible 时 `pickAutoTour` 按 priority 只取 1 个；24h 冷却 key 存在时不自动弹。
7. 目标锚点缺失 → 渲染为居中卡且不抛错、可继续下一步。
8. `placeCard` 纯函数：右贴边溢出翻 left、下溢出翻 top、center 居中（用构造的假 rect 断言坐标）。
9. Registry：遍历 TOURS 动态生成 ⌘K 重看命令；新增一个 mock tour 无需改引擎即可被渲染。
10. i18n `keys.test`：`tour` zh/en key 集一致、值非空且不等于 key、无硬编码中文。

### 9.2 质量门
- `pnpm -r typecheck` 四包全绿；`pnpm --filter @agent-world/web exec vitest run` 全量零回归（新增用例计入 web 总数并同步 handoff/README badge）。

### 9.3 内置浏览器真机走查
- 全新账号：注册 → 空态选模板 → 进工作区自动引导 → 一路下一步 → 完成后不再弹。
- ⌘K「重新观看新手引导」可重放；Esc/跳过可用。
- 引导前在 3D 视图 → 开始被切到 2D、完成后恢复 3D。
- 暗色 / 亮色主题下卡片、scrim、描边都清晰；缩放到 125%/窗口变窄不错位。
- 折叠左右面板后触发，相关步骤正确展开或降级居中，不卡死。

---

## 十、实施拆分（原子提交，英语 message，无助手署名，不 push）

> **最终拆分以 §12.13 的多引导版本为准**（引擎/Registry → 覆盖层/调度/What's new → 测试 → docs）。下列单引导拆分仅留作"若 D4 改判为先做单引导"时的回退参考，默认不采用。

1. `feat(web): add guided-tour store, step config and tour i18n namespace`（store + steps + zh/en tour.json + i18n 注册，无 UI）
2. `feat(web): add guided tour overlay with spotlight and first-run/replay wiring`（GuidedTour 组件 + 定位引擎 + data-tour 锚点 + App 自动触发 + 命令面板重看 + styles）
3. `feat(web): add guided tour component and placement tests`（GuidedTour.test + placeCard 纯函数测试；也可并入 2，按改动量决定）
4. `docs: record guided tour design and index it`（本文档 + docs/README 索引 + handoff）

> 若一次做完，2/3 可合并为一个 feat commit；原则是每个 commit 自身 typecheck/测试绿。

---

## 十一、风险与取舍

- **锚点脆弱**：用专用 `data-tour` 属性而非 class 选择器，class 重构不影响引导；data-tour 只承担引导定位，不承担样式/测试选择器职责。
- **自定义画布无法高亮内部对象**：2D 是 SVG、3D/park 是 WebGL，无法对单个节点/工厂做 DOM 聚光灯。因此画布相关步骤只高亮**画布容器外壳**或 DOM 工具条/面板，不试图圈 3D 物体；这也是 start 强制 2d 的原因。
- **引导打扰老用户**：seen 版本化 + 存量有 run 历史账号不自动弹 + 随时跳过，三管齐下。
- **步骤太多引起反感**：默认 7 步封顶、每步不超过两句话；保留 5 步精简版配置，评审后可一键切换。
- **维护成本**：界面改版会让锚点/方位失效——data-tour 缺失有居中降级不会白屏；步骤表是纯配置，改文案只动 i18n、改顺序只动数组。

---

## 十二、可扩展架构：多引导注册中心与版本化（应对产品迭代）

> 本节是对前文"单引导"假设的升级：**引擎从 v1 就按"可注册多个引导"设计**，首次引导只是注册表里的第一条。后续任何新版本/新功能引导，**零引擎改动**，只加一个 tour 定义文件。这是本方案的最终架构，前文的 store/steps/持久化均按此实现（不再写死 first-run）。

### 12.1 核心原则：引擎与定义解耦，引导即数据

- **引导是数据，不是代码**：每个引导是一个纯配置对象（`id / version / targeting / priority / steps`），引擎只负责"渲染任意一个引导"。
- **引擎永不因新引导而改**：加引导 = 加文件 + 注册一行 + 加锚点/i18n。
- 首次引导（first-run）与未来 v2-park / v2-connector 引导在引擎层完全平等，没有特殊分支。

### 12.2 文件结构（最终）

```
apps/web/src/
├─ components/GuidedTour.tsx            # 通用引擎：渲染当前 activeTour，聚光灯/导航/a11y
├─ components/guided-tour-engine.ts     # 定位/聚光灯纯函数（placeCard 等，可单测）
├─ store/guided-tour.ts                 # 通用 store：activeTourId / index / start(tourId)，不绑定具体引导
├─ tours/
│  ├─ index.ts                           # TourRegistry：TOURS = [firstRun, v2Park, ...]
│  ├─ tour-types.ts                      # TourDef / StepDef / Targeting / TourContext 类型
│  ├─ first-run.tour.ts                  # 首次引导（原方案 §六 的步骤表）
│  ├─ v2-park.tour.ts                    # 未来示例：3D 园区新功能引导
│  └─ primitives.ts                      # 可复用 step builder：welcomeStep/commandPaletteStep/...
└─ i18n/locales/{zh,en}/tour.json       # 统一 tour 命名空间，按 tour id 前缀分 key
```

### 12.3 TourDef 接口

```ts
interface TourDef {
  id: string;                          // 稳定标识，如 "first-run" / "v2-park"
  version: string;                     // 语义版本 "1.0.0"；内容改版 bump → 用户重看
  titleKey: string;                    // ⌘K / 帮助中心显示名
  priority: number;                    // 多个可自动触发时的优先级（小的先）
  autoStart: boolean;                  // 满足 targeting 时是否自动弹（false=仅手动）
  targeting: Targeting;                // 谁能看到（见 12.4）
  steps: StepDef[];                    // 步骤配置（同前文 §六）
  onStart?: (ctx: TourContext) => void;   // 可选钩子，如强制切 2d、展开面板
  onFinish?: (ctx: TourContext) => void;  // 可选钩子，如恢复视图
}
```

### 12.4 Targeting（谁能看到）—— 防骚扰核心

```ts
interface Targeting {
  minGraphCount?: number;              // 至少 N 条产线
  hasRunHistory?: boolean;             // 必须/禁止有运行历史（上下文拿不到时该字段留空=不约束）
  featureFlags?: string[];             // 必须开启的 flag；web 当前无 feature-flag 体系，用可注入 getFeatureFlags()（默认返回 {}），预留
  seenTours?: string[];                // 必须已看过某引导（如先看 first-run 再看 v2）
  accountAgeDays?: { min?: number; max?: number };
  custom?: (ctx: TourContext) => boolean;  // 任意自定义谓词
}
```

- 示例：`v2-park` 引导 `targeting: { featureFlags:["park"], minGraphCount:2 }` —— 单产线、未开园区的用户永远看不到（featureFlags 由注入的 flags 访问器求值，当前默认全开/空集，不依赖不存在的后端）。
- **first-run 自动触发不依赖 run 历史拉取**：web 端没有现成"账号是否跑过 run"的同步信号，因此用更精确的**会话内 0→1 建首条产线**时刻触发（`createGraph` 前 `graphs.length===0`，建完进入工作区后延迟 ~400ms 弹）。这天然只命中新用户：存量老用户升级后不会再经历 0→1，故绝不会被自动打扰，无需额外请求；targeting 仍写 `minGraphCount:1` 做兜底。`hasRunHistory` 字段保留给未来能廉价取到该信号时使用。

### 12.5 持久化：按 `tourId:version` 隔离

- key：`aw.tour.seen:{tourId}:{version}`，如 `aw.tour.seen:first-run:1.0.0`、`aw.tour.seen:v2-park:1.0.0`，互不干扰。
- 通用 `hasSeen(tourId, version)` / `markSeen(tourId, version)`，不绑定具体引导。
- 版本 bump（first-run 1.0.0→1.1.0）→ 老用户自动再看一次；旧版本 key 保留可审计，不主动清理。
- **从原单引导迁移**：首次运行若检测到旧 key `aw.tour.seen=v1`，等价标记 `first-run:1.0.0` 已看（一次性迁移，迁移后删旧 key）。

### 12.6 调度与防骚扰（关键，避免版本连发）

- **每次会话最多自动弹 1 个引导**：多个 eligible 时按 `priority` 取最高，其余只在「What's new」/⌘K 手动入口可见。
- **24h 冷却**：同一账号 24h 内最多自动弹 1 次（即使有多个 eligible），避免连续版本骚扰；冷却 key `aw.tour.lastAutoAt`。
- **skip 即放过**：skip 也算该版本 seen，不再自动弹；用户可在帮助中心手动重看。
- **targeting 不满足绝不弹**：所有自动触发前必须过 `canShowTour(tour, ctx)` 求值。

### 12.7 锚点契约：功能代码拥有锚点，引导只引用

- 统一 `data-tour="<anchorId>"`，锚点由**被引导的功能组件自己加**（如 Park 入口按钮加 `data-tour="park:entry"`），不由引导组件加。
- 引导步骤的 `target` 只是一个字符串引用锚点 id；功能下线/改名时，对应步骤自动降级为居中卡（已有兜底，见 §八），不会白屏。
- 命名空间 `<feature>:<element>`，如 `raw:input`、`park:entry`、`hud:actions`，避免冲突。
- 这意味着**加新功能引导时，锚点随功能代码一起加**，引导文件只引用，职责清晰。

### 12.8 步骤原语（复用，避免重复写欢迎/完成卡）

- `tours/primitives.ts` 导出可复用 step builder：
  - `welcomeStep(titleKey, bodyKey)` —— 居中欢迎卡
  - `commandPaletteStep()` —— 讲解 ⌘K
  - `hudActionsStep()` —— 讲解顶栏总览
  - `finishStep(bodyKey)` —— 居中完成卡
- 新功能引导直接组合原语 + 自定义步骤，不重复造轮子。

### 12.9 "What's new" 帮助中心 + ⌘K 自动注册（统一手动入口）

- 账户菜单/帮助区加「引导与新功能」入口，列出 Registry 中所有引导：已完成 ✓ / 未看 / 重看按钮。
- ⌘K 命令面板**自动为每个 tour 生成一条** `replay-tour:{id}` 命令（遍历 TOURS 动态生成，无需逐个手写）。
- 未来加的引导自动出现在这里，零额外工作。这是所有版本引导的统一回访入口。

### 12.10 i18n 按引导隔离

- 统一 `tour` 命名空间 + id 前缀 key：`tour.firstRun.welcome.title`、`tour.v2Park.step1.title`。
- keys.test 四校验自动覆盖（zh/en 同 key、值非空、无硬编码中文）；新增引导只加 key 不改注册逻辑。
- 若某引导文案极多，可拆 `tours/{id}/i18n/{zh,en}.json` 在注册时合并进 i18next（预留能力，默认用统一命名空间）。

### 12.11 埋点钩子（可选，本期可不实现，接口预留）

- 引擎 emit：`tour:start` / `tour:step` / `tour:complete` / `tour:skip`，带 `tourId / version / stepIndex`。
- 接入现有 metrics/日志体系即可分析每步流失率；接口预留，不强制本期实现。

### 12.12 加一个未来引导的完整成本（示例：v2 3D 园区）

1. 新建 `tours/v2-park.tour.ts`：定义 `id:"v2-park"` / `version:"1.0.0"` / `targeting:{featureFlags:["park"], minGraphCount:2}` / `steps`（欢迎→园区入口→钻取 L1→状态色→完成）。
2. `tours/index.ts` 注册一行 `TOURS.push(v2ParkTour)`。
3. 功能代码侧给 Park 入口按钮等加 `data-tour="park:entry"` 等锚点（随功能代码一起加）。
4. 加 i18n key `tour.v2Park.*` zh/en。
5. **引擎、store、定位、a11y、What's new 入口、⌘K 命令全部零改动**。提交即可。

### 12.13 与原单引导设计的关系 / 实施建议

- 原方案 §六的步骤表、§七的定位/聚光灯/a11y、§九的测试全部保留，只是从"写死 first-run"改为"渲染当前 `activeTour`"。
- 首次引导（first-run）就是 Registry 第一条，行为与原方案完全一致（自动触发、7 步、强制 2d、seen 持久化）。
- 额外工作量约 **15%**（TourDef 类型、Registry、targeting 求值、按 id 持久化、What's new 入口、⌘K 动态注册），但换来未来零成本加引导。
- **建议：从 v1 就按此多引导架构实现，不要先做单引导再重构。** 实施拆分（§十）相应调整为：
  1. `feat(web): add guided-tour engine, registry types and first-run tour definition`（通用 store/引擎/类型 + first-run 定义 + i18n）
  2. `feat(web): add guided tour spotlight overlay, auto-start scheduling and what's-new replay`（GuidedTour 组件 + 锚点 + App 自动触发 + 帮助中心/⌘K + styles）
  3. `feat(web): add guided tour engine, placement and targeting tests`（引擎/placeCard/targeting 纯函数测试 + 组件流程测试）
  4. `docs: record guided tour extensible registry architecture`（本文档 + 索引 + handoff）
