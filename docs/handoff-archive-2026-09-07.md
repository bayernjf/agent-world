# Handoff Archive — 2026-09-07

> 从 `handoff.md`「Active work」区滚出的已完成（✅）待办详细过程归档（2026-09-07）。按约定 `handoff.md` 只保留标题行作索引，全文迁此。待办 38（商业化 M0 部署）仍进行中，留在 handoff。

## Active work 待办 1-37 归档

### 1. 自动数据接入 Connector + 触发方式

file/http/form/manual 本已落地，本次补齐 **SQLite database connector**（`9657538`+`9003120`，见 design-connector-database.md）；4.6 webhook/cron/event/batch 本已全链路落地，本次挖出并修复 **event 成功状态契约 bug**（`e9b55ae`，引擎发 `done` 而触发层等 `completed`，见 design-triggers.md）。两者组合已是无人值守产线；剩余仅 PG/MySQL 驱动、多实例分布式锁（均 deferred）。

### 2. 跑通真实产线（狗粮验证，2026-08-31 立项，2026-09-02 完成）

roadmap-tasks 1.7.1——用产品自己跑端到端真实产线，验证全链路真实可用。逐模板验证状态见 template-checklist.md。

- **完成总结（2026-09-02）**：27/27 业务模板全覆盖真实运行（25 ✅ + 2 🟡 环境侧阻塞），25 种节点类型除已废弃者外均有真实运行记录，四类自动触发均有真实 run 取证。共 9 波验证，掉出并修复 20+ 产品缺陷，核心类别：① 静默成功/静默失败；② 测试与产品契约脱节；③ 引擎级调度缺陷；④ 安全/凭证；⑤ 稳定性。剩余环境侧阻塞：tpl-news-podcast 缺 TTS 供应商、tpl-research-loop 缺可用搜索源。server 测试 557→664/664，core 162→164/164。
- **2026-08-31 文本链路**：跑通「短视频广告工坊」（run `e74cba65`），修复 SSRF `pinnedAgent` undici 版本不匹配（依赖降到 `undici@^7.8`）。
- **2026-08-31 全链路**：影坊视频节点适配（run `49e60631`），video 模型切回 `agnes-video-v2.0`，config.ts 加 `videoAdapter`，视频轮询超时 300s→900s；另修 artifact 落库双 bug（本地引用识别 + 跨 run 主键冲突）。
- **2026-09-01 tpl-news-podcast 🟡**：audioGen 失败被静默吞、search 默认 DDG 不可达、模板默认模型 tts-1 不在 provider 清单、technical-design 误写 templateId。
- **2026-09-01 复验**：media modality 错配派发期阻断（`7b7faf0`）、mediaGen 静默跳过改诚实失败（`b6de7d9`）、search 可行动报错 + opt-in 代理（`b82f89a`）、DDG 反爬响亮报错（`530bfc5`）。
- **2026-09-01 tpl-product ✅**（run `8f205215`）：双 imageGen 真实出图 + 修复产物服务 404 bug（`c91f973`，localRef 引用跟随）。
- **2026-09-01 tpl-xiaohongshu ✅**（run `904d6a05`）：复验 c91f973，产物不再破图。
- **2026-09-01 tpl-batch-content ✅**（run `03924415`）：code + map 批处理验证。
- **2026-09-01 tpl-contract-review ❌→✅**：source 只接受图片导致合同审查必败 → `SourceConfig.files` + file 产物 + Inspector 上传区（`2d3dfcf`/`95c65a4`），复验 run `084b6f63` rework 边首次真实跑通。
- **2026-09-01 tpl-scan-ocr ⬜→✅**（graph `8e204023`）：ocr 节点生产 100% 不可用（worker/core 钉 v5 CDN URL）、convert 像素错位（3 通道喂 pngjs）、OcrConfig 与离线部署承诺矛盾，均修复。
- **2026-09-01 tpl-doc-ingest ⬜→✅**（run `0117cdab`）：坏脚本能打死 server（EPIPE）、fan-in 静默丢弃、combine 脚本未转义 \n，均修复。
- **2026-09-01 tpl-release-pr ⬜→✅**：vcs 裸 fetch 绕过 SSRF、PR 标题推导、GitHub 422 详情丢弃，均修复；真实创建 PR #1/#2。
- **2026-09-01 tpl-evidence-brief + tpl-expense-review ⬜→✅**：table 排序空值语义缺陷（`2c3cef8`）、证据清单拆条污染、issueCount 多异常压测。
- **2026-09-02 狗粮第二波**（15 模板 ⬜→✅/🟡，27/27 全覆盖）：客服工单 approve 后 notify→depot 从未调度却报 done（`44c3260`，三重根因）。
- **2026-09-02 狗粮第三波**：subprocess（run `dc7b86fd`）、database（run `1ffee144`）、cron 真实调度（run `5a73d4f8`/`4df6e6a1`），零缺陷。
- **2026-09-02 狗粮第四波**：webhook/batch/event/cron 无人值守闭环，零缺陷。
- **2026-09-02 狗粮第五波**：generic 节点四模态静默跳过（`5d76cc5`）+ 文本产物不发 artifact。
- **2026-09-02 狗粮第六波**：六媒体分支空结果当成功（`2797011`），关掉审计 L8。
- **2026-09-02 第七波**：节点级凭证明文落库（`f7c333f`，sealGraphDoc 按字段名递归遍历）。
- **2026-09-02 第八波**：imageGen 静默成功 + 空补全当成功（`a633989`/`0a22653`/`ff223bb`）。
- **2026-09-02 第九波**：URL 查询串凭证收口（`043ce5c`）+ search/vcs 节点级凭证入口（`f914fa9` 等）+ 负载性 flaky 修复（`fd45fa8`）。

### 3. 回归测试集（已完成 2026-08-31）

vitest.setup mock bcryptjs、vitest.config 全局 timeout（60s/60s）、regression/core-path.test.ts 核心回归基线。结果：全量 571/571 连续 2 次复跑稳定通过。

### 4. 模板全量测试（已完成 2026-08-31）

25 个业务模板 + 空白产线引擎级冒烟全跑通。修复：code 节点裸引用 inputs→stdin 读取、error 边被 human 挂起饿死、code 失败误标 PROVIDER_ERROR→SCRIPT_ERROR、空白产线空图崩溃→fail-closed。后续新增模板至 33 个（专业服务方向）。

### 5. README 演示 GIF（已完成 2026-09-01）

`docs/images/demo-run.gif`（5 帧时间轴回放，960px，142KB），commit `6df0fe7`。

### 6. git push（已完成 2026-08-31）

安全审计批次 push 到 origin/feature/20260824，PR #90 title/description 同步。

### 7. web 前端组件测试（2026-09-02 登记，2026-09-03 完成）

从 176 个纯逻辑测试推进到 1460 个测试（组件测试 1223 个，覆盖 39 个组件）。分四批：P0（5 组件/112）、P1（5/174）、P2（10/285）、P3（19/652）。修复 Inspector.tsx 可选链 bug。见 web-component-testing-plan.md。

### 8. search 成功路径取证（2026-09-06）；8b. 效果数据回流（2026-09-04）

搜索凭证模型重构：「设置·搜索服务」按源独立绑定 key（tavily/serpapi/google 各一槽、落盘加密、切换不丢不串），真实跑通 Tavily 3 条结果（run `d80040c5`）。audioGen 仍推迟（无 TTS）。8b：F6 效果回流 `POST /api/metrics/webhook/:targetId`（每渠道 secret + 防重放）+ RPA 回读框架（`c0c4aa9`，选择器待真实环境逆向）。

### 9. 设计 Token 体系完善（2026-09-03，全部完成）

26 个基础 CSS 变量 → 完整 Primitive + Semantic token + 明暗主题切换（commit `9259a38`），渐进式迁移 30 批（`09abc4d`~`7d0b9da`）。见 design-design-tokens.md。

### 10. i18n 国际化（2026-09-03，全部完成）

i18next + react-i18next，7 命名空间，完整 zh/en 翻译包（1800+ keys），组件级迁移全部完成（Inspector 341 处 t() 调用），语言切换 UI + 本地化格式。见 design-i18n.md。

### 11. 自媒体电商方向能力升级（2026-09-03 立项 → 2026-09-04 十个特性全落地）

human/AB/parallel/loop/branch/batch/source 电商字段/gate/成本计量/品牌词库/notify/vcs/subprocess/cron 全部复用，真正缺口四处：run 内多变体择优、运营态工作台、商品/素材实体、效果回流。10 特性只新增 4 节点（fanout/select/compliance/publish）。见 design-ecommerce-roadmap.md。

### 12-22. F2-F10 各特性（2026-09-03~04 落地）

F2 审核队列（reviews.ts + ReviewQueue）、F3 平台适配与合规校验（platforms.ts + compliance 节点）、F4 商品库/品牌素材库、F5 批量任务编排、F6 效果数据回流、F7-A 平台化导出包、F8 内容日历、F9 内容级成本归因、F1 run 内多变体择优（fanout/select sub-run 泳道）、F10 fan-out/fan-in 画布编排、F7-B 开放渠道发布。各特性含 core/server/web 三层 + 测试。

### 23. 状态机方案 A 验证（2026-09-04）

variables + branch 组合足以表达状态机，无需新节点类型（engine.statemachine.test.ts）。方案 B（statemachine 节点）登记 deferred。

### 24-29. 专业服务方向模板（2026-09-04）

银行流水对账（tpl-reconciliation）、隐私政策合规审查（tpl-privacy-review）、发票批量 OCR 台账（tpl-invoice-ocr）、批量合同审查（tpl-batch-contract-review）、审计抽样底稿（tpl-audit-sampling）、fileParse 多文档增强 + 尽调清单（tpl-due-diligence）。累计 9 个专业服务模板（法律合规 5 + 财务审计 4），全部真实狗粮。

### 30. 核心文件重构（2026-09-04，全部完成）

engine.ts 4954→1828 行（-63%），Inspector.tsx 3848→611 行（-84%）。阶段 1 拆 Inspector + 阶段 2.1 runNode 闭包提取 + 阶段 2.2 NodeRunContext + nodes/ 目录。见 design-refactor-engine-inspector.md。

### 31. 合规/运营批次五份方案（2026-09-05，全部实施）

密钥轮换（keyring + enc:v2: + rotate-reencrypt）、审计日志 P1+P2、服务端日志 P1+P2+P3、公告 P1+P2+P3、反馈 P1+P2+P3。见对应 design-*.md。

### 32. search 成功路径补证（与第 8 条合并）

### 33. 服务端日志收编 + 默认落盘 + 请求日志（2026-09-05，P1+P2+P3 完成）

LOG_FILE 默认落 `<DB dir>/logs/server.log`、console 收编、请求中间件、P3 关键路径。server 747→771/771。见 design-logging.md。

### 34. 角色权限 RBAC（2026-09-05，P0-P3 全量完成）

全局 owner/admin/user + 资源级 owner/editor/viewer + resource_access 表 + 判定层 + Collaborators UI + 管理面板。见 design-rbac.md。

### 35. 连接器数据插值（2026-09-05，全部落地）

ResolvedMaterial.data 通道 + sourceMeta 旁路 + 快捷名注册表（product）+ buildSourceBrief fallbacks。engine.products.test.ts 2→11 例。见 design-data-interpolation.md。

### 36. 商业化详细实施方案（2026-09-06 设计，未实施）

design-monetization.md：三层计费模型 + 套餐档位 + 订阅 gate + 账单支付 + 企业版 + P0-P3 路线。实施未启动（触发条件：P0 成本计量回采 2-4 周）。

### 37. 画布等距 3D 展示视图（2026-09-06，四期全部完成）

受限 3D（正交投影 + 俯角固定 + 水平旋转）+ 2D/3D 切换，29 种程序化几何造型 + 卡车沿管道跑 + 运行状态亮灯 + 交互收尾 + 节点拖动。见 design-canvas-isometric.md。
