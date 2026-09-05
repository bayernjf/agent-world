# Agent World 项目进度总览

> **单一入口**：整体进度基线，供后续产品迭代对照参考。创建：2026-08-31。
> 各文档分工：阶段定义见 [PRD.md](PRD.md)；通用化主线见 [roadmap-generalization.md](roadmap-generalization.md)；活跃待办见 [handoff.md](../handoff.md)；缓做/低优挂起项见 [deferred-items.md](deferred-items.md)。

---

## 一、进度快照（2026-09-04）

> 完成度为基于项目文档状态的**估算**，用于快速判断"哪块做完了、哪块没动"，不是精确度量。按完成度降序。

| 模块 | 完成度 | 状态 | 说明 / 关联文档 |
|---|---|---|---|
| 安全加固（审计 29 项） | 100% | ✅ 已完成 | 3 Critical/10 High/8 Medium/8 Low 全部修复，含 CORS 通配符拒绝、SSRF、静态加密 L3；推翻 2 条旧"已解决"结论。**2026-09-02 扩围**：L3 静态加密从仅 `triggers[].webhookSecret` 扩展到图文档内**所有节点级凭证**（imageGen/videoGen/audioGen/generic `apiKey`、notify `secret`+`webhookUrl`、连接器 `auth.token`+auth 类 `headers`），`sealGraphDoc`/`openGraphDoc` 改为按字段名递归遍历（`f7c333f`）；**再收口**：`headers` 里由自定义名字承载的凭证（`X-My-Auth`、`X-Signature`）按名字模式加密，固定名单枚举不到的漏网补上（`ff223bb`）；**L3 声明的最后一条残留同日闭环**：嵌在 URL query 里的凭证（`?token=…`、Azure `?api-key=`）按**精确参数名**就地加密（良性参数与 endpoint 保持明文可排查，密文 percent-encode 往返），并删掉与改写器漂移的双检测器（`043ce5c`）；**同波补上 `search`/`vcs` 此前完全没有的节点级凭证入口**（`apiKey`/`cx`/`token`/`baseUrl`，落盘前即被既有 sealer 覆盖，不再只能靠 server 环境变量 + 重启，`f914fa9`+`75f02b4`+`817bff8`）。**真正剩下的边界**：写在自由文本里的密钥（prompt / `variables` / code 脚本 / http body）——按字段名加密拦不到 — [security-audit-2026-08-31.md](security-audit-2026-08-31.md) |
| 账号系统与用户隔离 | 100% | ✅ 已完成 | users 表 + JWT/HttpOnly cookie + 全量按 user_id 隔离 + 旧库回填迁移 |
| 回归测试与质量门 | 100% | ✅ 已完成 | core 188 / server 747 / mcp 50 / **web 1500**（2026-09-03 从 176 提升到 1460，+1284 用例——组件测试全覆盖 39 个组件，P0/P1/P2/P3 四批全部完成；基础设施 @testing-library/react + jsdom + vitest.config.ts + setup.ts + utils.tsx；过程中修复 Inspector.tsx 可选链 bug；全量稳定通过无回归）；core-path 回归基线 17 用例，Node 24 下稳定复跑 — [handoff.md Quality gate](../handoff.md) |
| 自媒体电商方向（F1-F10） | 100% | ✅ 已完成 | **2026-09-04 十个特性全部落地，里程碑 M1-M6 闭环**：F1 run 内多变体择优（fanout/select 节点 + 变体对比视图）、F2 审核队列、F3 平台合规、F4 商品库素材库、F5 批量任务、F6 效果回流、F7-A 导出包 + F7-B 开放渠道 Webhook、F8 内容日历、F9 内容级成本、F10 画布泳道编排；只新增 4 个节点，F7-C 浏览器 RPA 默认不做 — [design-ecommerce-roadmap.md](design-ecommerce-roadmap.md) |
| MCP Server | 100% | ✅ 已完成 | stdio + HTTP/SSE 双传输、15 工具 + resources + prompts + notifications + Bearer 认证（P0-P2 全落地）— [design-mcp-server.md](design-mcp-server.md) |
| Phase 1 基础通用能力 | 100% | ✅ 已完成 | HTTP/代码执行/条件分支/parallel/数据模型升级 — [roadmap-generalization.md](roadmap-generalization.md#phase-1基础通用能力2-3周) |
| Phase 2 数据与文件处理 | 100% | ✅ 已完成 | 表格/数据库/文件解析/OCR/转换/搜索/翻译 — [roadmap-generalization.md](roadmap-generalization.md#phase-2数据与文件处理2-3周) |
| 设计 Token 体系 | 100% | ✅ 已完成 | **2026-09-03 基础设施落地**（`9259a38`）：① Primitive 层完整——间距 12 级（8pt grid）、圆角 7 级、阴影 6 级、字号 8 级、行高 4 级、字重 4 级、动画 3 级（duration + easing）；② Semantic 层——背景 7 角色、文字 5 角色、边框 5 角色、功能色 4 组（success/warning/error/info 含 bg 变体）、accent 交互色 4 角色、语义间距/圆角/阴影；③ 明暗主题切换——`[data-theme="light"]` 属性驱动，所有 semantic token 完整映射浅色值，滚动条颜色同步；④ 保留原有 26 个原始 token 向后兼容，semantic token 映射到 primitive，主题切换单属性即可。**渐进式迁移已完成（30 批，commits `09abc4d`~`7d0b9da`）**：styles.css 全局样式全部迁移到 semantic token，覆盖全局基础/HUD/组件/画布/管道/产线/时间线/检查器/产物/画廊/产品/设置/触发器/引导/知识库/运行历史/模型分配等所有模块，全量 1460 测试每批验证通过无回归 — [design-design-tokens.md](design-design-tokens.md) |
| i18n 国际化 | 100% | ✅ 已完成 | **2026-09-03 基础设施落地**（`008c844`）+ **2026-09-04 收尾全部完成**：① 技术栈 i18next + react-i18next + i18next-parser；② 7 个命名空间（common/canvas/nodes/modals/settings/run/errors）；③ 完整双语翻译包 zh/en 各 1800+ keys；④ 语言自动检测 + localStorage 持久化；⑤ 组件迁移 41/41 组件 + 顶层 App.tsx；⑥ Inspector 内 29 种节点配置字段（约 250 处）全部迁入 `nodes.inspector`（Inspector.tsx 341 处 `t()` 调用，keys.test 硬编码中文守护通过）；⑦ 语言切换 UI（LanguageSwitcher 集成 UserMenu）；⑧ 本地化格式 `i18n/utils.ts`（formatDate/DateTime/Number/Currency/RelativeTime，基于 Intl + zh-CN/en-US）— [design-i18n.md](design-i18n.md) |
| Phase 3 集成与通知 | 95% | 🟡 主体完成 | notify/搜索/vcs/TTS 已落地；邮件收件、内容平台（小红书/抖音/淘宝）依赖 API 资质缓做 — [integrations-future.md](integrations-future.md) |
| 模板体系 | 97% | 🟡 主体完成 | 33 个实用模板覆盖 29 种节点类型中的 23 种（database / subprocess 无模板）；分类收口为 core `TEMPLATE_CATEGORIES` 有序 11 类，选择器按分类分组展示、空白钉最前（法律合规「合同审查」+「证据清单整理」+「隐私政策合规审查」+「批量合同审查」+「尽调清单」、财务审计「费用报销初审」+「银行流水对账」+「发票批量 OCR 台账」+「审计抽样底稿」）+ TemplateField 参数化全链路 + 空白产线入口（BLANK_TEMPLATE 独立导出，不计入模板数）；模板市场（发布/安装）缓做 — [design-templates.md](design-templates.md) |
| Phase 4 高级编排 | 92% | 🟡 主体完成 | 6/7 项落地：并行聚合 / subprocess / error 边+catch / AI Agent 工具循环 / human 审批 / 变量持久化；**状态机缓做** — [phase4-design.md](phase4-design.md) |
| 版本管理补强 | 95% | 🟡 主体完成 | 自动快照 + run 关联 hash + 恢复预览；**A/B 实验已作为独立特性落地**（design-ab-testing.md）；仅剩 diff 视图缓做 — [design-versions.md](design-versions.md) |
| 真实产线狗粮验证 | 100% | ✅ 已完成 | **33 个模板全覆盖**（历史 27/27 基线 + 2026-09-04 专业服务 9 个新模板逐一真实狗粮；剩 2 🟡 环境侧阻塞）；29 种节点类型均有运行记录（新增 4 种电商节点为引擎级测试覆盖）；四类自动触发（cron/webhook/event/batch）全部真实取证；**README 演示 GIF 已完成（2026-09-01，时间轴回放）**；9 波验证共修复 20+ 产品缺陷（静默成功/静默失败、测试与产品契约脱节、引擎级调度缺陷、凭证安全、稳定性）；剩余仅 `search`/`audioGen` 两类节点的成功路径证据（纯凭证阻塞，产品侧无待修项——search 的 key 现在直接填在节点里即可，无需改 env 重启 server） — [template-checklist.md](template-checklist.md) |
| 文档完善 | 75% | 🟢 基本完成 | 核心设计文档齐；2026-09-01 完成文档-代码覆盖盘点：补齐知识记忆/A-B 设计文档、修正 technical-design 时效；handoff 最近 5 条 hash 已核实回填；**2026-09-03 新增设计 token 与 i18n 方案文档**（design-design-tokens.md / design-i18n.md） |
| 自动数据接入 Connector | 70% | 🟡 主体完成 | file/http/form/manual 已落地；**SQLite database connector 已落地（2026-09-01，见 design-connector-database.md）**；剩 PG/MySQL 驱动接续（deferred） |
| 定时 / 事件触发 | 95% | 🟢 基本完成 | webhook/cron/event/batch 全落地（TriggersPanel+scheduler+27 测试）；**2026-09-01 修复 event 成功状态契约 bug**（见 design-triggers.md）；**2026-09-02 触发层全型实跑零缺陷**（webhook 401 诚实拒绝/batch 3 行并发/event 自动级联/cron 无人值守闭环，均有真实 run 取证）；多实例分布式锁 deferred |
| 商业化（定价/变现） | 5% | ⚪ 待启动 | 按产品决策**放后面** — [PRODUCT_STRATEGY.md](PRODUCT_STRATEGY.md) |

图例：✅ 已完成 · 🟡 主体完成（有缓做子项）· 🔵 进行中 · ⚪ 待启动

---

## 二、已完成版图（可迭代的基础能力）

- **执行引擎**：29 种节点类型，按 `NODE_CATEGORIES` 五组——AI 加工 5 / 车间调度 9 / 物料处理 7 / 外接设备 6 / 投料出料 2（逐种名称与中文术语见 [design-glossary.md](design-glossary.md)）；流式 + SSE + 断线重连 + halt/resume，成本电表（token + 单价）。**2026-09-04 代码重构完成**：节点执行体迁至 `packages/server/src/nodes/`（`NodeRunContext` + `NODE_HANDLERS` 注册表分发），`engine.ts` 4954→1828 行、`Inspector.tsx` 3848→611 行，纯重构行为零变化。
- **高级编排**：subprocess 子流程、error 边 + catch 容错、失败级联 skip、节点级重试、失败告警 + rerun、人工审批节点、graph 变量跨 run 持久化。
- **可信运行**：账号/用户隔离、静态加密（AES-256-GCM，**2026-09-02 扩围至图文档内所有节点级凭证，按 header 名字模式收口自定义凭证头，并就地加密 URL query 里的凭证；同波补上 `search`/`vcs` 的节点级凭证入口**）、SSRF 防护 + 代码沙箱（P0-P2 + net allowlist 代理）、29 项安全审计闭环。
- **质量体系**：core-path 回归基线（compile→execute→rework→resume→artifact→auth→SSRF）+ 全量测试稳定复跑；模板/引擎修复均带回归用例；**2026-09-02 按缺陷类横扫"静默成功"**——媒体节点抛错、provider 返回空结果、模型返回空补全/空译文一律改发诚实 `node.failed`（可被 error 边兜底），不再交出没有产物或空产物的"成功"run。
- **可扩展面**：MCP Server（外部 AI 客户端接入）、版本快照与恢复预览、模板参数化、33 内置模板按 11 分类分组展示、覆盖 29 种节点类型中的 23 种。

---

## 三、待启动 / 进行中管线（按优先级）

> 优先级与决策依据以 [handoff.md 待办](../handoff.md) 与 [deferred-items.md](deferred-items.md) 为准，本文档只做总览。

1. **自动数据接入 Connector（4.2）** —— ✅ 已落地（2026-09-01）。file/http/form/manual + SQLite database connector 全链路验证通过；PG/MySQL 待驱动接续（deferred）。
2. **定时 / 事件触发（4.6）** —— ✅ 已落地（2026-09-01）。webhook/cron/event/batch 全落地，修复 event 成功状态 `done` 契约 bug；与 Connector 组合即无人值守产线（已端到端验证，2026-09-02 触发层全型实跑零缺陷）。剩余仅多实例分布式锁（deferred）。
3. **模板体系扩充** —— ✅ 已完成（2026-09-01）。从 18 个扩充到 27 个业务模板（客服工单、代码审查、数据报表、合同审查、课程大纲、旅游行程、菜谱、证据清单整理、费用报销初审）；blankGraph 独立为 BLANK_TEMPLATE，不计入模板数；分类收口为 core `TEMPLATE_CATEGORIES` 有序 11 类，选择器按分类分组展示、空白钉最前 — [design-templates.md](design-templates.md) §6。
4. **README 演示 GIF** —— ✅ 已完成（2026-09-01）。时间轴回放映示 GIF 已放入 README，替换 TODO 注释位。
5. **真实产线狗粮验证** —— ✅ 已完成（2026-09-02）。27/27 模板全覆盖，9 波验证修复 20+ 产品缺陷；剩余 2 个 🟡 为环境侧阻塞（缺 TTS 供应商、缺搜索源 API key），产品侧无待修项 — [template-checklist.md](template-checklist.md)。
6. **web 前端组件测试** —— ✅ 已完成（2026-09-03）。从 176 个纯逻辑测试（零组件测试）推进到 **1460 个测试**，其中组件测试 **1223 个**，覆盖 **39 个组件**。分四批推进：P0（5 组件/112 用例）、P1（5 组件/174 用例）、P2（10 组件/285 用例）、P3（19 组件/652 用例）。基础设施 @testing-library/react + jsdom + vitest.config.ts + setup.ts + utils.tsx。过程中发现并修复 Inspector.tsx 可选链 bug。全量 1460/1460 稳定通过，56 个测试文件 — [web-component-testing-plan.md](web-component-testing-plan.md)。
7. **设计 Token 体系完善** —— ✅ 已完成（2026-09-03）。Primitive 层（间距/圆角/阴影/字号/行高/字重/动画）+ Semantic 层（背景/文字/边框/功能色/accent/语义间距圆角阴影）+ 明暗主题切换（`[data-theme="light"]`）全部落地，保留原有 26 个 token 向后兼容。**渐进式迁移已完成（30 批）**：styles.css 全局样式全部迁移到 semantic token，全量 1460 测试每批验证通过无回归 — [design-design-tokens.md](design-design-tokens.md)。
8. **i18n 国际化** —— ✅ 已完成（2026-09-03 立项 → 2026-09-04 收尾全部完成）。i18next + react-i18next + 7 命名空间 + 完整 zh/en 双语翻译包（1800+ keys）+ 语言自动检测 + localStorage 持久化全部落地；组件迁移 41/41 组件 + 顶层 App.tsx；Inspector 内 29 种节点配置字段（约 250 处）全部迁入 nodes.inspector（Inspector.tsx 341 处 t() 调用，keys.test 硬编码中文守护通过）；语言切换 UI（LanguageSwitcher）落地；本地化格式 i18n/utils.ts（formatDate/DateTime/Number/Currency/RelativeTime，基于 Intl）落地 — [design-i18n.md](design-i18n.md)。
9. **自媒体电商方向能力升级** —— ✅ 已完成（2026-09-03 立项 → 2026-09-04 十个特性全部落地）。F1-F10 十个特性全部交付，里程碑 M1-M6 全部闭环：**M1 引擎差异化**（F1 run 内多变体择优引擎 + 变体对比视图 + F10 画布泳道编排）/ **M2 提效快赢**（F2 审核队列 + F3 平台合规校验）/ **M3 数据资产**（F4 商品库素材库）/ **M4 规模化生产**（F5 批量任务）/ **M5 发布与排期**（F7-A 平台化导出包 + F8 内容日历）/ **M6 效果闭环**（F6 效果回流 + F9 内容级成本 + F7-B 开放渠道 Webhook 发布）。节点策略收口为**只新增 4 个节点**（fanout/select/compliance/publish），其余靠扩 ConnectorType（product）+ 平台层数据表 + 工作台 UI。F7-C 浏览器/RPA 自动化按方案默认不做（合规/封号风险）— [design-ecommerce-roadmap.md](design-ecommerce-roadmap.md)。
10. **核心文件重构（工程质量）** —— ✅ 已完成（2026-09-03 立项 → 2026-09-04 阶段 1+2 全部落地）。**Inspector.tsx** 3848→611 行（节点配置面板拆到 `InspectorFields/` 27 文件 + 注册表分发）；**engine.ts** 4954→1828 行，29 种节点执行体从巨型 `runNode` 迁至 `packages/server/src/nodes/`（28 个 `<kind>.ts` handler + `NodeRunContext` 显式上下文 + `NODE_HANDLERS` 注册表分发，notify 刻意保留内联以守住 error 边微任务时序）。纯重构、行为零变化，全量 server 747/747 + core-path 回归 18/18 复跑通过。阶段 3（接口风格约定，纯文档）延后 — [design-refactor-engine-inspector.md](design-refactor-engine-inspector.md)。
11. **文档穿插（4.8）** —— 基本完成（2026-09-01 盘点后核心设计文档覆盖全部已落地模块；低优余项见 deferred-items 文档线）。
12. **低优 / 缓做** —— 沙箱 docker 容器后端、模板/节点市场、版本 diff 视图、状态机、监控告警大盘、多租户、Notion/Linear/内容平台集成、Excel 读写、HTML→PDF。触发条件见 [deferred-items.md](deferred-items.md)。
13. **商业化** —— 放后面，决策基线见 [PRODUCT_STRATEGY.md](PRODUCT_STRATEGY.md)。

---

## 四、迭代参考规则

- **何时更新**：每次功能落地 / 阶段推进 / 待办状态变更时，更新本文档的进度快照与待办管线。
- **如何更新**：模块级完成度只改"状态 + 说明"两列，不编造精确数字；新增待办先写进 [handoff.md 待办](../handoff.md)（活跃事实源），再同步到本文档。
- **文档分工**（避免多源冲突）：
  | 文档 | 职责 |
  |---|---|
  | PRD.md | 产品阶段定义与护栏 |
  | roadmap-generalization.md | 通用化当前主线（5 Phase） |
  | docs/project-progress.md（本文档） | 整体进度基线 + 迭代对照 |
  | handoff.md | 当前状态 + 活跃待办 + 最近 5 条变更 |
  | docs/deferred-items.md | 缓做/低优挂起项（带触发条件） |
