# 内置模型目录与插拔设计

> 状态：**①②③④ 全部落地**（① `9c7c5f1`、② `54acc50`、③ `7c0dbe0` 于 2026-09-25；④ `4c4e699` + `8266403` + `af9c6ed` 于 2026-09-26）。落地后的实际行为差异见 §十一，④ 相对本方案的改动见 §十末。
> 关联：`packages/server/src/config.ts`（目录与合并）、`packages/server/src/providers/index.ts`（路由与 worker 缓存）、`packages/server/src/validate-models.ts`（派发前检查）、[design-monetization.md](design-monetization.md)（内置层与套餐门禁）、[design-versions.md](design-versions.md)（contentHash 与版本快照）。
> 一句话：**换默认 = 配置、热生效；加/删内置模型 = 数据、admin 面；接新供应商或改接口方言 = 代码、发版；凭证 = env，永不进数据也不进界面。**

## 一、要解决的问题

当前所有内置模型都来自 agnes 一个源。要的是：

1. 随时更换内置模型（增、减、换默认），**用户新建的产线自动跟上**，不需要逐条产线手改；
2. 已有产线里钉死的模型如果**下架了，派发直接报错**，用户自己在 Inspector 重选——**不做静默自动迁移**；
3. 用户自带的自定义模型（BYOK）继续由用户自己在 Settings 维护，与内置层互不干扰。

反目标（v1 曾设计、已否决，理由见 §五）：逻辑角色令牌、模型层级/tier、读取时别名解析、槽位持久化、按角色聚合成本、已存图批量改写。

## 二、两个平面（前提，不是待议项）

| 平面 | 谁维护 | 今天在哪 | 可否热改 |
| --- | --- | --- | --- |
| **内置模型**（平台出钱的那层） | 平台方 | `config.ts:295-356` 的 `AGNES_PROVIDER`，`source:"builtin"` | 默认模型/启停可以；**模型清单不行**——`parseRaw` 在读取时强制用代码里的内置层覆盖任何用户/文件副本（`config.ts:472-474`） |
| **用户自定义模型**（BYOK） | 用户 | Settings 界面 | 可以，增删/改模态/改单价全都已经能做（`apps/web/src/components/Settings.tsx:476/517` 建、`1215` 改模态、`1285` 改单价） |

内置层在 Settings 里被刻意做成**不可删、不可改 key、只能选中和停用**（`config.ts:292-293` 注释写明）。这条守卫是有意的：内置模型是平台侧计费和套餐门禁的对象，任何用户都能改它等于把计费面交给了用户。所以本方案 §六的 admin 面**必须长在平台管理员平面，不能长在现有 Settings 上**。

## 三、目录字段的归属（本方案的核心决策）

不按「内置 / 用户」切，按「**改一次要动什么**」切。把内置 provider 的字段摊开：

| 字段 | 现状位置 | 性质 | 归属 |
| --- | --- | --- | --- |
| 模型名 `models[]` | `config.ts:304-311` | 高频小改，纯数据 | **数据（admin 面）** |
| 模态 `modalities{}` | `config.ts:312-319` | 同上 | **数据** |
| 单价 `pricing{}` | `config.ts:325-332` | 计费面，但改动不需要发版理由 | **数据 + 必须写审计** |
| 启停 `enabled` / `defaultModel` / `defaultProvider` / `modelOrder` | `config.ts:298/390/391/393-400` | 运营决策 | **配置（已经热生效）** |
| `baseUrl` | `config.ts:299` | 供应商端点 | **env**（照 `BACKUP_BASE_URL` 既有先例，`config.ts:367-375`） |
| `apiKey` | `config.ts:303` | 凭证 | **env only**，注释已确立"无 key 即 fail closed"，不进数据、不进界面 |
| `endpoints` / `videoAdapter` | `config.ts:333-355` | **接口方言**：`createBody.mode:"ti2vid"`、五档 `aspectToSize`、`resultUrlPath`、`durationPath`——全是这家供应商偏离 OpenAI 兼容的具体偏差 | **代码，发版** |

两条支撑理由：

1. **表单化的成本已经付过了**：名字 / 模态 / 单价这套控件在用户 provider 路径上是成品，搬到内置只需要一个权限位，不需要新交互设计。
2. **`videoAdapter` 表单化会变坏**：把它做成界面就是给运营一个 JSON 文本框，比改代码更容易错。而且它是**每 provider 一次**的东西——加第 7 个 agnes 模型时它一个字都不用变，所以留在代码里并不拖累"随时增减"。

### 字段允许清单（④ 的安全不变量）

数据层的合并**只允许覆盖白名单字段**，其余一律以代码默认为准：

```
{ ...AGNES_PROVIDER, ...pick(catalog, ["models", "modalities", "pricing", "enabled"]) }
```

这样"数据能否覆盖 `baseUrl` / `apiKey` / `endpoints` / `videoAdapter`"这个问题**在结构上不存在**——不是靠界面不显示它们，而是靠合并不读它们。这是本方案最重要的一条防线。

## 四、规则 A：下架即报错

用户语义：**"内置模型下架 → 直接报错 → 用户自己重选"**。今天它报不出来，三条静默路径各自把失败降级成"成功"：

| 位置 | 今天的行为 | 后果 |
| --- | --- | --- |
| `validate-models.ts:66` | `provider.source === "builtin"` → **跳过注册检查** | 内置模型哪怕已从 `models[]` 删掉，派发照样放行 |
| `providers/index.ts:34-37` | `enabled === false` → `log.warn` + 换成 `fakeWorker()` | run 一路 `done`，产出是假文本，用户看不出来 |
| `providers/index.ts:46-53` | `type:"anthropic"` / 未知类型 → `fakeWorker()` | 同上 |

改法：三处都改用具名错误（`MODEL_RETIRED` / `PROVIDER_DISABLED` / `PROVIDER_UNSUPPORTED`），文案指名"模型 X 已不可用，请在 Inspector 重选"，并且**保留 `type:"fake"` 走 `fakeWorker()`**——那是 demo 账号与测试的合法路径，只是不该再充当"配置坏掉时的替身"。

规则 A 必须先落：它把"下架"从发版动作降级成界面上点一下。如果静默路径还在就开数据面，等于把一条会假成功的链路挪到最容易误触的地方。

## 五、规则 B：`model: ""` = 跟随当前默认

替代 v1 整套角色令牌的轻量约定：**空串就是插槽**，语义为"取该模态的当前默认"。没有新概念、没有别名表、不碰已存数据。

### 为什么解析点在 `startRun`（而不是读取时）

`run.ts:141-188` 里：`compile(graph)` → `loadConfig(userId)` → `validateModels` → `dispatchGate` → `db.createRun({ graph })`。解析插在 `loadConfig` 之后、`validateModels` 之前，`createRun` 与 `execute` 都用解析后的那份内存图。三条理由，都有具体证据：

1. **持久化文档不被改写** → `contentHash` 不变 → 版本快照节流与 run 的"与运行版本一致"标记不炸（这是 v1 读取时解析最大的风险，直接消失）。
2. **`validateModels` 拿到的已是真名** → 规则 A 的报错天然生效，不需要为 `""` 单开分支。
3. **评测指纹自动正确**：`sqlite-driver.ts:2387` 的 byPrompt 版本指纹是按**快照里的** `${model}\0${prompt}` 做 sha256。若在读取时解析，快照永远存 `""`，换内置默认后新旧 run 会被并进同一个评测版本——静默把两次不同实验当一次。派发时解析就没这问题，并且换默认会正确地开一个新版本。

连带：重跑/fork 走的是快照（`run.ts:380`、`:518`），新 run 的快照里已是真名，不会被二次解析；老快照里的真名若已下架，`validateModels` 报错——正是想要的语义。

### 需要改的几处

* **schema**：`graph.ts:142`（`TextGenConfig.model`）**本就没有 `min(1)`**，文本路径零 schema 改动；需放开 `:170`（image）、`:188`（video）、`:208`（audio）、`:230`（generic）四处 `min(1)`。
* **解析**：新增纯函数 `resolveModelSlots(graph, cfg)`。文本取 `cfg.defaultModel`；媒体按模态取"该模态第一个启用的模型"，顺序跟随 `cfg.modelOrder`（`config.ts:125/494-500` 已有该字段与回填）。默认值本身不可用时**保持空串**，交给 `validateModels` 报"还未配置模型"——不做二次猜测。
* **模板**：`templates.ts` 实测 **59 处**模型字面量（52 × `agnes-2.0-flash` + 5 × `agnes-image-2.0-flash` + 1 × `agnes-video-v2.0` + 1 × `tts-1`）→ 全部改 `""`；`templates.ts:1345` 的 `defaultValue: "agnes-2.0-flash"` 同步去掉。
* **web 新建节点**：`store/graph.ts:17` 模块级字面量与 `:288/:318` 的加节点默认 → 改走已缓存的默认模型（拿不到就留空，由 Inspector 的 `MissingModelHint` 覆盖）。
* **顺手还掉的债**：`store/graph.ts:160` `migrateGraphModels` 每次打开图都把"它不认识的模型"重写成具体 id 并自动存盘——就是 #53 那次零配置首跑 422 的根因。改成"空串合法、不碰"，这一类问题一次到底。
* **Inspector 口径**：`TextGenFields.tsx:40-46` 现在把不在选项里的模型渲染成「（当前）」，读起来像"没问题"；改为不可用标红 + 一键"改为跟随默认"。空串显示为「跟随默认 · <解析后的名字>」。

## 六、阶段 ④：admin 可维护的内置目录

### 存储选型：`settings` 表的一个平台行（**不需要迁移**）

上一轮我倾向"数据目录里一个 JSON 文件"，核过 DDL 后改主意，理由三条：

1. `settings.user_id` 是 `TEXT PRIMARY KEY` 且**无外键**（`sqlite-driver.ts:383`），所以保留一个伪 key（如 `__platform__`）当平台行即可，**schemaVersion 不动**、备份链路（含加密）原样复用。
2. 加解密已经在 store 边界做好（`index.ts:111-118` 的 `encryptString`/`decryptString`），平台行免费获得同一套静态加密。
3. 文件方案要面对只读 CWD 的诚实报错问题（`ocr.ts` 的 `cachePath` 踩过），DB 行没这个负担。

文件方案唯一的优势是"跟着 git 走 review"，而这一条由**代码默认值仍在 git 里**保留——数据层只是覆盖，删掉数据行即回到代码默认，天然可回滚。

### 读取路径

`parseRaw` 是同步的（`config.ts:464`），而 store 是异步的 → 平台目录**在启动时加载一次、admin 写入后显式刷新**，缓存在模块级变量；`parseRaw:473` 那行由 `providers[name] = def` 改为 `providers[name] = mergeBuiltinCatalog(def, platformCatalog()[name])`。

这条"写路径必须显式失效缓存"的要求不是洁癖——§七就是同一个缺陷类已经真实存在一次的证据。

### 权限与审计

* 复用既有全局管理员平面：`users.role='admin'`（`api.announcements.test.ts:126` 注释即"announcement admins are users with the global admin role"），`/me` 已经往前端露 `canManageAnnouncements`（`api.rbac.test.ts:44-47`）。照同样形状加 `canManageCatalog`，**不引入新 RBAC 概念**。
* 每次目录写入记审计 `model.catalog_update`（`design-audit-log.md` §3 同格式），detail 记改了哪个 provider、新旧模型数、被改价的模型名（**不记价格数值本身**，价格是可回读数据，审计里存副本反而扩大泄露面）。
* 内置 provider 的 `apiKey` 不出现在任何读写面。

## 七、目录热更新的正确性地雷（已核实的现存缺陷，与 ④ 无关，② 单独修）

* `openai-compatible.ts:231` 的 `pricingFor` 闭包捕获的是**建 worker 那一刻的 provider 对象**，成本就在 worker 内部算（`:177`/`:222`/`:675`），落库的 `cost_usd` 是它的返回值；
* `providers/index.ts:38` 的 worker 缓存 key 只有 `name::baseUrl::apiKey`。

→ 把某个模型单价从 0.1 改成 1.0，**只要没动 baseUrl 和 key，跑着的进程继续按 0.1 记账**，直到重启或缓存挤掉（`MAX_WORKER_CACHE=64`）。模态同理（`modalityOf`/`endpointFor` 也读那份对象）。名字与启停没这问题——路由侧 `providerForModel(cfg, model)` 每次现读新 config。

两条修法：

* **(a) 把影响行为的字段纳入缓存 key**（`models` 数与内容摘要、`modalities`、`pricing` 摘要）——改动局部，不动契约。
* **(b) 计价下沉到 engine**，worker 只回原始用量，由 engine 用新鲜 config 定价——架构上更干净，但会碰 `Worker` 接口和约 20 个测试替身。

本方案取 **(a)**，把 (b) 记为可选演进（触发条件：需要按租户/时段动态计价，或 worker 缓存 key 第二次漏字段时）。

## 八、落地阶段

| 阶段 | 状态 | 内容 | 主要改动 | 验收（实际落点） |
| --- | --- | --- | --- | --- |
| **①** | ✅ `9c7c5f1` | 规则 A：下架即报错 | `validate-models.ts` 去掉 builtin 豁免（改判 `providerForModel` 新增的 `matched`）、`providers/index.ts` 停用/未实现/未知类型三处不再降级成 fake、`workerFor` 不再把空模型名交给 fake | 从 `models[]` 删一个内置模型 → 派发 422 且错误指名模型；停用 provider → 抛 `UNSUPPORTED`（不在 `nodes/shared.ts` 的 RETRYABLE 里，所以不重试也不出网）；`type:"fake"` 与 `WORKER=fake` 仍正常出文本 |
| **②** | ✅ `54acc50` | 热更新生效（缓存 key） | `providers/index.ts` 的 `providerCacheKey` 用整份 provider 对象作 key | 同一进程内改单价后下一次 run 即按新价记账（`routing.test.ts` 实测 5e-6 → 5e-3），另有 3 条 key 性质测 |
| **③** | ✅ `7c0dbe0` | 规则 B | `model-slots.ts`（新增）+ `run.ts` 建 run 前解析、`ab.ts` 补解析与 `defaultModel`、`graph.ts` 五处 schema、`templates.ts` 59 处、`store/graph.ts` 删除读取时迁移、Inspector 共用 `ModelSelect` + i18n | 空槽派发跑通、**快照存真名而产线文档保持空串**（`api.dispatch-guard.test.ts` 端到端测）、换默认后评测版本自动分开、已下架名在 Inspector 标「已下架，请重选」且可一键回「跟随默认」 |
| **④** | ✅ `4c4e699`/`8266403`/`af9c6ed` | admin 目录数据面 | `builtin-catalog.ts`（平台行 + 白名单合并 + 校验）+ `config.ts:loadConfig` 的 `applyPlatformCatalog` + `GET/PUT /api/admin/model-catalog` + `canManageModelCatalog` + `model.catalog_update` 审计 + Settings 的 `ModelCatalogAdmin` | admin 增一个模型 → 用户可选、无需发版；删一个 → 命中规则 A 报错**且写入响应直接列出受影响的产线**；改价 → 命中 ② 的热生效；写入出现在 `/api/audit` |

顺序不能反：① 是所有后续的前置（否则"下架"落到最容易误触的界面时仍在假成功）；②先于④（否则界面会骗人）；③独立于④，可先行。

## 九、风险与观测

* **换默认 = 换质量与价格，用户可能没察觉。** 缓解：run 快照与时间线记**实际使用**的模型名（`nodes/textgen.ts:262` 的 `usage.model` 已是解析后的名字），Inspector 显示「跟随默认 · <名字>」而非空白。
* **admin 面是计费面。** 缓解：字段允许清单（§三末）、`canManageCatalog`、`model.catalog_update` 审计。
* **"有模型没价格"的沉默**：`computeCost` 对无价模型返回 0（`packages/core/src/pricing.ts:138`），但 `pricing.ts:203` 已有 `unpricedModels` 助手——④ 的目录体检可直接复用它，把"这个模型跑完记账为 0"在写入时就告警。
* **不做远端目录 / 自动跟随供应商模型列表**：那是把供应商接入变成供应链攻击面，且离线自托管（本产品的一条主用法）会直接坏。

## 十、待拍板（2026-09-26 结案）

1. ~~④ 是否连"哪个套餐能看见哪个内置模型"一起放进数据面~~ —— **这个问题问的是一个不存在的概念**：代码里没有任何"按套餐限制具体模型"的机制（`allowedModels` / `modelAccess` 在 core+server 全仓 0 命中；`PlanQuota` 只有 `tokens / concurrentRuns / storageBytes / videoSegments / seats` 五个维度，`packages/core/src/plans.ts:16-27`）。所以数据面能表达的是"有哪些模型、什么模态、多少钱、开不开"，**"谁能看见"目前等价于"订阅额度够不够烧得动它"**。若将来真要按套餐分模型，那是一个新特性（要先决定：限制的是可选列表，还是派发时的硬门禁），不在 ④ 范围内。
2. ~~阶段 ② 取 (a) 还是要直接做 (b)~~ —— 取 **(a)** 并已落地（`providerCacheKey`，`54acc50`），(b) 仍作为可选演进留在 §七。

### ④ 落地时相对本方案的两处改动

- **合并点从 `parseRaw` 挪到 `loadConfig`。** 原设计指 `config.ts:473` 那一行，但 `parseRaw` 在"无用户行且无配置文件"时**根本不会被调用**（`loadConfig` 直接返回 `DEFAULT_CONFIG`），挂在那儿等于在干净部署上什么都不做——正是最常见的场景。这条是集成测试逼出来的（§十一）。
- **写入响应直接回答"下架谁会坏"**（`affected`，上限 50 条 + `affectedTruncated`）。这是 v1 想用别名表解决的那个问题，落地成了派发前预检而不是自动改写——符合规则 A"报错让用户自己重选"的原意。

## 十一、①②③④ 落地后的实测状态与剩余字面量

**质量门（④ 落地后于 2026-09-26 实跑，非估算）**：core 346/346（本轮未改 core）；server **1427 例 = 1423 passed / 2 skipped / 2 failed**（那 2 failed 是 `engine.code.test.ts` 的 python 出网用例，本机 `python3` 是 Xcode 许可 shim，属既有环境失败，与本设计无关；2 skipped 是 `DOGFOOD=1` 门控）；web **1973/1973**（106 文件，单跑全绿）；`pnpm typecheck`（含 scripts）绿；`i18n:check` 与 `i18n:prune -- --check` 均 0 未引用 key。**④ 的增量**：server +30 例（`builtin-catalog.test.ts` 22、`api.model-catalog.test.ts` 8）、web +5 例（`ModelCatalogAdmin.test.tsx`），单独复跑 37/5 全绿。①②③ 当时（09-25）的基线是 server 1390 = 1386 passed / 2 skipped / 2 failed、web 1968/1968。

**还剩的写死模型名（③ 有意未清，都是"最后兜底"位）** —— **2026-09-26 已全部清掉，见下**：

| 位置 | 现在的写法 | 触发条件 |
| --- | --- | --- |
| ~~`engine.ts:1653/2119/2346`~~ **已清（2026-09-26）** | `fallbackModel: opts.defaultModel ?? ""` —— 兜底**不再是任何模型名**。四个派发口（startRun / resumeRun / forkRun / ab）现在都经 `drainRun` 且都显式传 `defaultModel`，所以为空只可能是「直接调引擎且没给默认」；留空会命中规则 A 报 `UNSUPPORTED`（具名、不出网），而不是悄悄用写死的内置名跑。原文「要清就得同时核约 20 个测试替身的期望值」**实测是错的**：真把兜底清空后 server 全量 1425 通过 / 2 条既有环境红，**零测试依赖这个兜底**（测试图的节点都自带模型名） | ——（已闭环） |
| ~~`openai-compatible.ts:518/536/881`~~ **已清（2026-09-26）** | 三处改成 `requireModel(...)`：没有模型名就抛 `UNSUPPORTED`（不在 `nodes/shared.ts` 的 RETRYABLE 里 → 不出网、不重试），并点名是哪一处（textGen node / gate judge / summarization）。**核实过可达性**：`judge` 那处看起来是活路径（gate 节点没有 `textGen`），但 `providers/index.ts:153` 的 routingWorker 已用 `cfg.defaultModel` 把 `node.textGen.model` 填满再下发，所以直达 openai-compatible worker 时才可能为空 | ——（已闭环） |
| `templates.ts:1424`（`defaultValue: "tts-1"`）与 `tpl-custom-model` 的模型字段 | 有意保留 | 它们是**用户看得见、可编辑的 BYOK 入口**，不是内置层 |
| `seed.ts` / `workers/demo.worker.ts` / 各 `*.test.ts` | 有意保留 | 测试夹具钉具体模型是正确的 |

**顺带查出、尚未修的相邻缺陷（已登记 deferred）**：`ab.ts` 的实验 run 只补了 `dispatchGate` + 模型解析 + `defaultModel`，但仍然不经 `runAsUser`、不传 `bannedTerms` / `userSkills` / `searchConfig` / `storeBinary` / `monthlyBudgetUsd`，也不写 `recordRunUsage`。也就是说 A/B 实验这条路上**合规词表、技能、媒体产物落库、月度预算与用量归集都是缺的**。这不是本设计引入的（① 之后至少不再是"静默用错模型"），但它和"跨切面检查只挂在一条路由上"是同一个形状。

> **✅ 该缺陷已于 2026-09-26 修复**：`run.ts` 抽出 `drainRun()`，把跨切面依赖（合规词表 / 用户技能 / 搜索配置 / 媒体落库 `storeBinary` / 月度预算 / G4 远程任务 / 子流程 / 用量归集 / 告警 / 指标）装配成一份，**startRun / resumeRun / forkRun / ab 四条派发路径共用**——原先那三份近乎逐字重复的代码也随之消失。`ab.ts` 只多一个刻意的差异：`persistVariables: false`——N 条 arm 并发写同一份跨 run 图变量会互相覆盖，还会把实验状态写进产线的正式状态。防复发用源码扫描守护「从 `engine.js` 引入 execute/resume/fork 的文件必须引用 `drainRun`」（`ab.test.ts`，植入 rogue 文件验证过能红），另有功能测钉住「实验 run 也要进用量台账」（此前是 0，等于实验不占额度）。
