# 产线模板体系增强 — 落地方案

> 基于 2026-08-30 的代码勘察写成（core/templates.ts / server 模板 API / web Onboarding / examples.md）。
> 背景与优先级：roadmap-generalization Phase 5 五项剩余能力中，模板市场起步件性价比最高——
> 节点与编排能力（Phase 1-4）已全部就绪，但能力面尚未转化为"5 分钟跑通第一条产线"的冷启动体验。
> 版本管理（需 DB 迁移 + diff UI）、多租户（无真实团队用户前是过度设计）、节点市场（依赖第三方开发者生态）均排后。
>
> **落地状态（2026-08-30）**：§1（共享 TemplatePicker + 空白入口）= `ffc34d9`；§2（4 个新模板 + examples.md 对齐）= `6a951e4`；
> §3（TemplateField 参数化）**全部落地**——schema 定型 `6daf309`、实例化应用（显式值 > defaultValue，copy-on-write 防模板污染）`242f706`、server `fieldValues` 透传 + `/api/templates` 返回 fields `8a1b1f9`、web 参数表单（TemplateFieldDialog，双入口）`e6bb9f3`；4 个 HTTP 模板（运营周报/定时巡检/多源简报/竞品监控）已声明 URL 字段，默认值=原 URL 保持开箱行为；§4（市场）维持缓做。

---

## 0. 现状速览（勘察结论）

| 能力 | 现状 | 结论 |
|---|---|---|
| 模板数据模型 | `GraphTemplate`（id/name/description/category/graph）+ `instantiateTemplate`（节点/边 id 全量重生成，`Graph.parse` 兜底校验）于 core/templates.ts | ✅ 已有 |
| 内置模板 | 6 个：淘宝商品详情 / 小红书图文 / 文案质检循环 / 翻译 / 文档审阅 / 空白 | ⚠️ 5/6 偏内容生成，数据分析/IT 运维类缺失 |
| 模板 API | `GET /api/templates`（含 slim geometry 缩略图）+ 建图 `template` 参数实例化 | ✅ 已有 |
| 首启模板选择 | Onboarding.tsx 模板选择器（分类 tab + 卡片 + SVG 预览，直读 core TEMPLATES 免网络往返） | ✅ 已有 |
| **老用户模板入口** | GraphSwitcher「+ 新建产线」**直接创建空图**，Onboarding 选择器仅首启出现 | ❌ **真缺（P0 核心）** |
| examples.md 文档模板 | 9 个手工描述的模板（含 HTTP 聚合研究、多语言等），**无代码化**，文档与内置模板两张皮 | ❌ 真缺（P1） |
| 模板参数化 | 无占位符机制；模板里写死的提示词/URL 实例化后需用户逐节点手改 | ❌ 真缺（P1） |
| 用户发布/安装模板（真"市场"） | 无；依赖多租户与审核机制 | ⏸ 缓做（P2，见 §4 决策记录） |

---

## 1. P0：老用户模板入口（本轮核心闭环）

### 1.1 问题

模板选择器只在首启 Onboarding 出现一次。已有产线的用户（产品的核心用户群）点「+ 新建产线」
得到的永远是空画布——内置 6 个模板对他们等于不存在。

### 1.2 方案

**GraphSwitcher 的「+ 新建产线」改为二段式**：

1. 点击后弹出模板选择弹窗（复用/抽取 Onboarding 的模板选择器组件，含分类 tab、卡片、SVG 预览）
2. 卡片首格固定是「空白画布」（对应现 blankGraph），其余为内置模板
3. 选中即调现有建图 API（`POST /api/graphs` + `template` 参数），落为当前用户的普通 graph，
   之后保存/运行/编辑一切照旧——模板与实例彻底解耦（现有 `instantiateTemplate` 语义不变）

**组件抽取**：Onboarding 的模板网格抽成共享组件 `TemplatePicker`（props：templates、onPick），
Onboarding 与 GraphSwitcher 弹窗共用，避免两份渲染逻辑漂移。

**验收**：
- 老用户（非首启）从 GraphSwitcher 能看到全部模板并能实例化
- 选空白画帧行为与现状完全一致（回归）
- 首启 Onboarding 行为不变（回归）
- web 测试：TemplatePicker 渲染 + 选择回调；GraphSwitcher 弹窗开合

### 1.3 明确不做

- 不做模板收藏/最近使用（无数据支撑，先不加复杂度）
- 不做服务端模板分页/搜索（6-12 个模板量级不需要）

---

## 2. P1：模板覆盖面扩充（与 P0 同轮或紧随）

### 2.1 新增模板（对齐 roadmap 点名的四类场景）

| 模板 | 类别 | 结构草稿 | 依赖 |
|---|---|---|---|
| 电商运营周报 | 数据分析 | HTTP（拉销售数据）→ code（清洗汇总）→ agent（生成周报）→ sink | 无需 key（HTTP 用公共 API 或静态 JSON 演示端点；code 沙箱本就无外网） |
| 定时巡检告警 | IT 运维 | cron 触发已有体系；HTTP（健康检查）→ branch（异常判断）→ notify（飞书告警）/ sink（正常记录） | notify 走 env 密钥，模板内留占位说明 |
| 多源研究简报 | 数据分析 | 复用 examples.md #3 的结构：双 HTTP connector → agent（综合）→ sink | 同上 |
| 竞品监控摘要 | IT 运维 | HTTP（拉页面/API）→ code（提取字段）→ agent（对比摘要）→ sink | 同上 |

**设计原则**：每个新模板必须"开箱可跑"——要么用 demo provider 兜底，要么失败路径也能演示
（error 边 + catch 现已支持，模板可展示容错编排）。

### 2.2 examples.md 与代码模板对齐

- examples.md 每个条目加"对应内置模板 id"（或标注"文档示例，未内置"）
- 内置模板的 description 保持与 examples.md 一句话定位一致
- 单一事实源：模板定义在 core/templates.ts，examples.md 只做导览不做定义

---

## 3. P1：模板参数化（占位符）

### 3.1 问题

模板里写死的品牌名/提示词/URL，实例化后要用户逐节点打开 Inspector 手改，体验断裂。

### 3.2 方案（轻量，不做模板引擎）

- `GraphTemplate` 加可选字段 `fields: { key, label, defaultValue, applyTo }[]`
  （applyTo 描述字段如何映射到节点配置，如 `nodes[writer].agent.prompt` 前缀替换）
- 实例化时对声明了 fields 的模板，web 弹一个轻量表单（复用 Inspector 的表单风格），填完再落图
- 先不做：fields 仅支持字符串替换；不引入递归模板/继承等机制（防过度设计，节点市场 P2 再议）

**落地补充（2026-08-30）**：web 表单为共享 `TemplateFieldDialog`（预填 defaultValue、留空回退默认值），
NewGraphDialog / Onboarding 双入口复用；`instantiateTemplate` 按显式值 > defaultValue 应用（copy-on-write
避免浅拷贝污染模板定义），空串视为跳过。

---

## 4. P2 缓做决策记录：用户发布/安装模板（真"市场"）

为什么缓做（与 design-code-sandbox §11 同款逻辑，成本在外围不在接口）：

1. 依赖多租户体系（按用户隔离已打底，但团队/组织维度未做）
2. 依赖审核机制（模板含任意 prompt/HTTP 配置，是提示注入与 SSRF 的天然载体，需要安全评审）
3. 无第三方供给方（节点市场同理）——没有发布者的市场是空壳

触发条件：多租户落地 + 出现真实的外部模板需求信号后再决策。

---

## 5. 实施顺序与验收

| 步骤 | 内容 | 验收 |
|---|---|---|
| 1 | TemplatePicker 抽取 + GraphSwitcher 二段式建图 | web 测试 + 手工回归（首启/老用户/空白三条路径） |
| 2 | 新增 4 个内置模板 + examples.md 对齐 | core templates.test 扩展（schema 校验 + 实例化 id 重生成 + 开箱可跑断言） |
| 3 | GraphTemplate.fields schema 定型（仅接口，无 UI） | core 类型测试 |
| 4 | 文档同步（roadmap Phase 5 表 + handoff 轮转） | docs 单一事实源检查 |

每步一个原子 commit；不碰 engine/scheduler，改动面限定在 core/templates.ts、web 两个组件、server 无改动（API 已够用）。
