# 商品内容产线迭代规划（淘宝 / 小红书图文）

目标场景：用户排几张产品实拍图 → 自动产出可商业使用的平台图文（淘宝详情页、小红书笔记等）。

## 现状（阶段 3 末）

已有「商品详情页」模板：原料台(图片) → 卖点提炼 → 文案撰写 → 排版整理 → 质检站(可返工) → 成品库。

已经具备：
- 视觉模型真的能看到产品图：source 图片 URL 沿流向传递，每个 agent 节点通过 `image_url` 多模态消息收到图片（`engine.ts` 的 `imagesFor` + `openai-compatible.ts` 的 `buildMessages`）。
- 图文混排：排版节点输出结构化 Markdown 并在文中 `![](url)` 插图；`FinishedProduct` 渲染标题/引用/列表/图片画廊。
- 质检 + 返工闭环、产物持久化（本地 blob + artifacts 表）、跨 run 成品库画廊。
- 成本/预算/重试/错误脱敏/多标签乐观锁/结构化日志等生产底座。

距离“直接商用上架”的差距：
1. 图片只能填 URL，不能本地上传/拖拽。
2. 输出是通用 Markdown，没有平台专属版式（淘宝长页 vs 小红书笔记）。
3. 图片位置不可精确控制。**（已解决：阶段 6 已支持 `image` 的 `align/width/aspect/rounded` 与 `imageCards` 的 `layout/columns/span`，见 `docs/roadmap-tasks.md`）**
4. 不能导出成品（长图/HTML/富文本）。
5. AI 生图节点已接入（缺素材时自动出 banner/场景图，支持数量与节点级端点覆盖）。
6. 品牌/人群/调性/平台违禁词等已有输入口（source 字段），且违禁词已在 gate 确定性拦截；品牌词库、多版本 A/B、评估联动、AI 生图节点均已实现。

## 迭代阶段

### 阶段 A：接真实素材（已完成）
- ✅ source 节点支持点击/拖拽/粘贴产品图，`POST /api/artifacts/upload` 落盘，得到 `/api/artifacts/:id` URL，带缩略图预览。
- ✅ 多张图按顺序作为主图→细节图，仍可手动填 URL。
- ✅ 图片作为 image artifact 流向下游视觉模型。

### 阶段 B：平台专属产线模板（核心，进行中）
- ✅ 「淘宝商品详情」模板：排版节点输出结构化 ```product-json 区块（hero/heading/bullets/imageCards/paragraph/specs/cta）。
- ✅ 新增「小红书种草笔记」模板：卖点→种草文案→笔记排版→质检，输出同结构但 note 风格（emoji、短句、话题标签）。
- ✅ core 新增 `ProductBlock`/`ProductDocument` schema 与 `parseProductDocument()`；`FinishedProduct` 检测到结构化块用 `ProductBlocks` 按版式渲染，否则回退 Markdown。
- ✅ 品牌/人群/价格带/语气/违禁词/补充说明作为 source 输入字段，由 `buildSourceBrief` 组装成创作简报流向下游所有写手。

### 阶段 C：导出即用
- 成品区支持导出长图、复制富文本/HTML、下载 Markdown，可直接贴进千牛/小红书后台。

### 阶段 D：AI 生图与品牌增强（后置）
- ✅ AI 生图节点：调用 OpenAI 兼容的 `POST /images/generations`（provider 或节点级 `baseUrl`/`apiKey` 覆盖，120s 超时）；source 缺真实图片时自动生图，按 `n`（1–8）出 banner/场景图并以 `artifact` 流向下游；上游已有图片则跳过（避免浪费配额）。淘宝/小红书模板内置「AI 配图」+「AI 场景图」两节点。
- ✅ 品牌词库：可管理的品牌词库（`brand_terms` 表 + `/api/brand-terms` CRUD + Web 管理弹窗），厂房(source)节点可填「品牌词」并一键「从品牌词库载入」；品牌词随创作简报下发给写手（建议融入），质检 gate 可设「品牌词覆盖率门槛」`minBrandCoverage`——低于则打回上游重写。
- ✅ 多版本 A/B：A/B 实验运行器——选一个厂房(agent)节点 + 填 N 个 prompt 变体，一次发起 N 次独立运行（各自替换目标节点 prompt），统一打上 `ab_group` / `ab_arm` 标记；`/api/ab/:groupId` 报表按臂并排对比合格率、质量分、平均返工、耗时、单跑成本，自动推荐质量分最高臂。复用 评估联动 的 `avgScore`。
- ✅ 评估联动：gate 的 judge 现在产出 0–10 质量分（`score`），Web 端质检站可设「质量分门槛」`minScore`——低于阈值直接判废打回上游重写，与模型布尔判定并行。质量分持久化进 `node_runs.score`，`/api/eval` 报表按 prompt 版本聚合 `avgScore`，可对比改 prompt 前后的质量变化（为 A/B 铺路）。
- ✅ 违禁词校验：source 节点的「禁用词 / 禁用说法」字段沿 flow 向上游收集，gate 判定时做确定性硬拦截——命中即判废并打回上游重写，与模型 judge 并行生效。写手已通过 `buildSourceBrief` 拿到禁用词清单并在创作时规避。

## 与 ArtifactRef 的关系
阶段 A/B 用“图片 URL 透传 + 文本流”即可支撑实拍图场景，不需要先做引擎 ArtifactRef 改造。
等需要“图片/JSON 作为下游节点的一等结构化输入”或多模态自动拼接时，再做 3.8 的 ArtifactRef 升级。
