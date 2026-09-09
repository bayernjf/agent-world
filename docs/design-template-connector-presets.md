# 产线模板连接器适配与数据插值修复方案

> 状态：**方案定稿（2026-09-08），待落代码**。
> 关联：[design-data-interpolation.md](design-data-interpolation.md)（插值引擎机制 D1-D7）、[design-ecommerce-roadmap.md](design-ecommerce-roadmap.md) §F4（商品库）、[template-checklist.md](template-checklist.md)（逐模板狗粮状态）。
>
> 本文回答两个问题：① 连接器数据插值能力为什么在现有产线模板里"没生效"，引擎层丢了什么、怎么修；② 全部 33 个业务模板逐一盘点后，哪些该预设连接器、哪些保持手动，以及落地与验证方式。

## 1. 问题现象

用户从模板新建一条"淘宝商品详情 / 小红书种草笔记"产线，即便已经在「商品库」录入了商品，产线运行时也不会自动带出商品名、品牌、价格等结构化字段，仍要手动把商品信息再贴一遍原料台。排查结论分两层：

1. **模板层（没接线）**：全部 33 个业务模板的 source 节点都是裸 manual 节点——`templates.ts` 中 `source: {` 与 `connector` 出现次数均为 **0**；文坊节点 prompt 里也没有任何 `${product.*}` 插值表达式。能力做了，但模板一个都没用上。
2. **引擎层（能力被回滚）**：插值机制 D1-D7 在 2026-09-05 落地，但 **2026-09-06 晚被三个连续 commit 部分回滚/清理**，导致设计文档仍写"已实施"、实际只剩 D1/D2 存活。详见 §2。

## 2. 引擎层现状：D1-D7 逐项核对（代码级，2026-09-08）

| 编号 | 能力 | 当前状态 | 证据 |
|---|---|---|---|
| D1 | `ResolvedMaterial.data?` 通用结构化数据通道 | ✅ 存活 | `connectors.ts` `ResolvedMaterial.data` |
| D2 | `sourceMeta` 旁路 + `interpCtx` 合并，命名空间形式 `${srcId.data[0].name}` | ✅ 存活 | `engine.ts` sourceMeta/interpCtx；测试 ②③ 通过 |
| D3 | 快捷名注册表 `product`=data[0]、`products`=data，恰 1 个该类型 source 时注入全局名 | ❌ **被删** | `addf74d` 删 `CONNECTOR_SHORTCUTS`（connectors.ts 20 行）+ engine 扫描/注入 34 行 |
| D4 | 简报事实字段（productName/brand）留空时从 data[0] 回填，手填优先 | ❌ **被删** | `acbc273` 删 `deriveConnectorFallbacks`；`d095d59` 删 `buildSourceBrief` 第三参与 4 个单测 |
| D5 | source 简报 8 字段内的 `${...}` 先插值再 fallback | ❌ **被删** | `acbc273` 删 `buildBriefCtx`/`interpolateSourceNode`（source.ts 112 行） |
| 守护 | 空 data warn、悬空 `${product.x}` 引用 warn | ❌ **被删** | `acbc273` 删两处 warn |
| D6 | graph.ts ProductConnector 注释修正 | ✅ 存活（注释准确） | `graph.ts` |
| D7 | 前端 product connector 数据源 hint | ❌ **被删/缺失** | `SourceFields.tsx` 搜不到插值 hint |

### 2.1 回滚时间线（事实，原因未记录）

```
acbc273  22:19  revert(server): remove connector data interpolation   （删 D4/D5 + 两处 warn，source.ts -112）
addf74d  22:26  fix(server): remove leftover connector interpolation  （删 D3 快捷名注册表 + engine 注入 + 测试）
d095d59  22:29  refactor(server): drop buildSourceBrief fallback param（删 D4 第三参 + 4 单测）
```

三个 commit 的 message 都**没有说明回滚原因**，且夹在画布 3D 视图第四期的一串提交中。当前 `engine.products.test.ts` 里 ⑦⑪ 用例已被改写为锚定"快捷名不注入"的状态（断言 `${product.name}` 解析为空），①④⑨⑩ 用例被直接删除。

> **诚实标注（不确定性）**：回滚是用户本人（bayernjf）主动提交的，但未记录动机，无法从仓库确定当时是遇到 bug 还是仅做重构清理。因此本次属于"**按当前需求重新恢复**"，恢复后必须重点回归两类潜在风险点：① 多 product source 的快捷名退化；② 商品数据值里含 `${...}` 字面量的防二次展开。不臆断历史原因。

### 2.2 仍然可用的部分（不用重做）

- 命名空间形式 `${intake.data[0].name}`、整节点引用 `${intake}`（=简报文本）全程可用，测试 ②③⑤⑥⑧ 守护中。
- product connector 拉数本身正常：空库返回 `{text:"",images:[],data:[]}`，`source.ts` 用 `m.text || opts.sourceInput || ""` 回退手动输入，**不报错**。

## 3. 全 33 个业务模板 source 输入性质盘点

> 统计口径：`TEMPLATES` 数组 33 个业务模板，不含 `BLANK_TEMPLATE`（空白产线）。分类依据是 source 节点承载的数据形态及其直接下游节点类型（逐个核对 `templates.ts` 节点构成）。

### A 类·强商品输入（2 个）——本次预设 product connector

| 模板 | source 名 | 判定依据 |
|---|---|---|
| tpl-product 淘宝商品详情 | 原料台 | 单品图文 → 卖点/文案/排版，天然对应商品库一条记录 |
| tpl-xiaohongshu 小红书种草笔记 | 原料台 | 同上，单品种草 |

### B 类·cron 开关型（5 个）——source 只是启动信号，保持 manual

这些模板的 source 不承载业务数据，真正拉数在**下游独立的 http 节点**；source 主要给 cron/event 触发一个启动信号。预设 product connector 属于语义错误。

| 模板 | source 名 | 真正数据源（下游） |
|---|---|---|
| tpl-ops-weekly 运营周报 | 周期开关 | http 拉取数据 |
| tpl-patrol-alert 定时巡检告警 | 巡检开关 | http 健康探针 → branch |
| tpl-research-brief 多源研究简报 | 研究开关 | 2×http 数据源 → parallel |
| tpl-competitor-watch 竞品监控摘要 | 监控开关 | http 抓竞品页 |
| tpl-data-report 数据报表生成 | 数据源 | http 拉取数据 → code 清洗 |

### C 类·文件/图片输入型（6 个）——本次不动，登记后续

source 主路径喂给下游 fileParse / ocr，语义上对应 **file connector 或 source.images**。写本文时 file connector 还没有结构化 data 通道（D1 仅 product 落地），所以判定为"不涉及插值问题、属独立的输入体验优化"。**2026-09-09 补记**：五类 connector 已全部接上 `data` 通道，file 给 `[{name, path, content}]`，能力阻塞不再成立；预设仍未做，原因换成了"写死的本地路径对别人的机器没意义"，见 §8。

| 模板 | source 名 | 下游 |
|---|---|---|
| tpl-doc-ingest 文档智能解析入库 | 文档入口 | fileParse + ocr（另有 http 辅路） |
| tpl-scan-ocr 扫描件数字化 | 文件入口 | ocr（另有 http 辅路） |
| tpl-contract-review 合同审查助手 | 合同文件 | fileParse |
| tpl-privacy-review 隐私政策合规审查 | 隐私政策文件 | fileParse |
| tpl-invoice-ocr 发票批量 OCR 台账 | 发票图片 | ocr |
| tpl-due-diligence 尽调清单 | 尽调材料台 | fileParse（多文档） |

### D 类·手动文本/主题/清单/CSV 型（20 个）——保持 manual

输入是自由文本、主题、多行清单或粘贴的 CSV，由用户每次运行时填写，或下游另有 search/vcs/http 辅助节点；与商品库无语义对应。

| 模板 | source 名 | 输入形态 |
|---|---|---|
| tpl-media-pipeline 短视频广告工坊 | 主题 | 主题（可商品可纯主题，故不预设） |
| tpl-draft 写草稿 | 主题 | 自由主题 |
| tpl-translation 翻译流水线 | 原文 | 待译文本 |
| tpl-doc-review 文档审查 | 待审文档 | 纯文本 → textGen（无 fileParse） |
| tpl-batch-content 批量内容工坊 | 原料清单 | 多行清单 |
| tpl-review-publish 人工审核发布 | 素材输入 | 待审素材 |
| tpl-custom-model 自定义模型接入 | 请求输入 | 测试文本 → code |
| tpl-news-podcast 资讯播客工坊 | 话题输入 | 话题 → search |
| tpl-research-loop 多课题深度调研 | 课题清单 | 多行课题 → code 拆题 → loop(search) |
| tpl-release-pr 发版 PR 助手 | 变更草稿 | 草稿 → vcs |
| tpl-customer-service 客服工单自动处理 | 工单 | 工单文本 → branch |
| tpl-code-review 代码审查助手 | PR 输入 | diff 文本 → code（http 辅路） |
| tpl-course-outline 课程大纲生成 | 课程主题 | 主题文本 |
| tpl-travel-plan 旅游行程规划 | 需求输入 | 需求文本（http 辅路） |
| tpl-recipe 菜谱生成 | 食材口味 | 文本 |
| tpl-evidence-brief 证据清单整理 | 证据材料台 | 多段文本 → code |
| tpl-expense-review 费用报销初审 | 报销明细台 | 粘贴 CSV → code |
| tpl-reconciliation 银行流水对账 | 流水投料台 | 两段流水 → code |
| tpl-batch-contract-review 批量合同审查 | 合同投料台 | 多份文本 → code |
| tpl-audit-sampling 审计抽样底稿 | 账目明细台 | 粘贴 CSV → code |

**合计：2 + 5 + 6 + 20 = 33，全覆盖、不重不漏。**

## 4. 设计决策

### 4.1 只给 A 类 2 个模板预设 product connector，其余一律不动

- B 类预设商品库是语义错误（开关信号 ≠ 商品）；
- C 类是 file/images 输入，属于另一条独立工作线（见 §8 后续）；
- D 类输入与商品库无语义对应。
- 营销内容分类下也只有 2 个是强商品输入——"分类是营销"不等于"输入是商品"（批量内容/审核发布/资讯播客都是反例），**按 source 数据形态而非模板分类决定**。

### 4.2 selection 选 `manual`，不选 `all`

预设配置：`source.connector = { type: "product", product: { selection: "manual" } }`。

| 选项 | 行为 | 取舍 |
|---|---|---|
| `all` | 自动拉全部 active 商品，`${product.name}` 只取 data[0]（=最新创建） | 多商品时"想做 B 却注入 A"，错配隐蔽；formatProduct 还会把全部商品拼进原料，噪声大 |
| **`manual`（选定）** | 用户在原料台显式勾选"这条产线这次做哪个商品" | 语义最精确，符合"一条产线一次做一个商品"；空选时 `getProductsByIds([])` 返回空 → 自动回退手动输入，安全 |

### 4.3 prompt 插值的空值鲁棒原则（重要）

用户可随时把 connector 切回 manual，此时 `${product.name}` 按既有语义解析为空串。因此：

1. **主信息走简报，不靠 prompt 硬编码**：D4 恢复后，选中商品会在 source 简报自动出现"商品名称/品牌"行，`formatProduct` 的完整商品文本也进原料块，而下游 prompt 通过整节点引用 `${intake}` / inputPolicy 已经能看到全部商品信息——**即使 prompt 里一个插值都不写，商品信息也到得了模型**。
2. **prompt 只在需要"稳定点名"的位置轻量引用**（如卖点提炼锚定商品名），且措辞对空值可读，不允许出现"为「 」撰写"这种空括号病句；空值时由上游简报兜底。
3. 插值只加在真正消费商品身份的节点（卖点/文案），排版（product-json 结构）、质检（criterion）、配图（imageGen 靠上游图）不需要加。

### 4.4 引擎恢复以设计文档 D1-D7 为准，但补一条历史教训

恢复 D3/D4/D5 + 两处 warn + D7，机制与 [design-data-interpolation.md](design-data-interpolation.md) 原设计一致；区别是这次**必须补 source→textGen 全链路集成测试**。上次回滚能在单测全绿下发生，正是因为旧单测直接测 `buildSourceBrief(node, input, fallbacks)` 纯函数，而真实调用链 `source.ts → buildSourceBrief` 早已不传第三参——纯函数单测绿、集成链路断。集成测试是本次的回归锚。

## 5. 落地改动清单

### 5.1 引擎恢复（packages/server + core）

1. `connectors.ts`：恢复 `CONNECTOR_SHORTCUTS` 注册表（product/products 两条）。
2. `engine.ts`：恢复 `sourcesByConnector` 扫描（≥2 个同类型 source 时 info 提示快捷名退化）、`interpCtx` 恰 1 个时注入快捷名（节点 ctx 优先）、悬空 `${shortcut.`/`[` 引用的 warn 守护。
3. `nodes/source.ts`：恢复空 data warn；恢复 `buildBriefCtx` + `interpolateSourceNode`（D5）+ `deriveConnectorFallbacks`（D4），调用 `buildSourceBrief(node, sourceText, fallbacks)`。
4. `nodes/shared.ts`：`buildSourceBrief` 恢复第三参 `fallbacks?`，事实字段留空回填、手填覆写、调性字段永不回填。
5. `apps/web` InspectorFields/SourceFields：恢复 D7 product connector hint（走 i18n，不硬编码中文，遵守 AGENTS.md）。

### 5.2 模板（packages/core/templates.ts，仅 2 个）

- tpl-product、tpl-xiaohongshu 的 intake 节点：裸节点 → 带 `source.connector = {type:"product",product:{selection:"manual"}}`。
- 两个模板的"卖点提炼/文案撰写"prompt：按 §4.3 原则加最小必要的 `${product.brand} ${product.name}` 锚点（措辞对空值鲁棒），其余节点不动。

### 5.3 文档

- 更新 `design-data-interpolation.md`：状态行改为真实状态，补"实施-回滚-恢复"历史与本次结论。
- 本文（template-connector-presets）登记进 docs 索引与 handoff「Project documents」。

## 6. 测试计划

1. **恢复并修正 `engine.products.test.ts`**：
   - 恢复 ① 全局快捷名 `${product.name}`、④ 简报事实字段自动回填、⑨ 防二次展开、⑩ branch 数值条件；
   - 把 ⑦⑪ 从"锚定快捷名被删"改回"快捷名注入 + 多 source 退化 / 节点 id 优先"的原设计语义；
   - 保留 ②③⑤⑥⑧。
2. **新增全链路集成测试（本次关键回归锚）**：构造 `source(product connector, 库中有 1 条商品) → textGen(prompt 含 ${product.name}) → sink`，断言：① 文坊实际收到的 prompt 中商品名被替换；② source 简报 artifact 含"商品名称：X / 品牌：Y"回填行；③ 空库时回退手动输入、run 不失败且产生一条 warn；④ 手填 productName 覆写库值。
3. **模板形状测试**：`templates.test.ts` 断言两个 A 类模板 intake 带 product connector、其余 31 个 source 不带 product connector（锁死"只改 2 个"的边界，防止以后误扩散）；模板总数仍为 33。
4. 全量 `server` + `core` + `web` 测试与 typecheck 必须全绿。

## 7. 提交切分（原子提交，英语 message，不 push）

1. `fix(server): restore connector shortcut registry and interpolation guards`（D3 + 两 warn，connectors/engine）
2. `fix(server): restore brief-field fallback and interpolation from connector data`（D4/D5，source/shared）
3. `test(server): add end-to-end connector interpolation integration tests`（测试恢复 + 集成测试）
4. `feat(core): preset product connector on product and xiaohongshu templates`（2 模板 + 形状断言）
5. `feat(web): hint product connector data interpolation in source fields`（D7 + i18n）
6. `docs: record connector interpolation rollback/restore and template preset plan`（两文档 + 索引/handoff）

每个 commit 独立可回滚、各自跑通相关测试；文档 commit 放最后。

## 8. 边界与后续（不在本次范围）

- **C 类文件型模板预设 file connector / source.images**：~~等 file connector 接入结构化 data 通道~~ 通道已于 2026-09-09 接通，卡点变成"预设什么路径"——写死绝对路径对别人的机器无意义，等可移植的约定或真实反馈再立项。
- ~~**其他 connector 的结构化 data**~~ **已落地 2026-09-09**：五类 connector 全部填 `data` + 各自快捷名（`${response.x}` / `${row.列名}` / `${form.字段名}` / `${file.content}`），见 [design-data-interpolation.md §13](design-data-interpolation.md)。
- **media-pipeline 是否预设 product**：其输入"主题"可商品可纯主题，保持 manual；若后续数据表明绝大多数用于商品，再单独评估。
- 当初回滚原因无记录：恢复后在真实狗粮（tpl-product/tpl-xiaohongshu 端到端）中重点观察多 source 退化与防重入，发现问题以新事实为准再调整，不沿用猜测。
