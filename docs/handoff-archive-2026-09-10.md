# Handoff Archive — 2026-09-10

> 从 `handoff.md` Active work / Recently shipped 归档的已完成项详细过程。本文件只读，新增内容请写回 `handoff.md`。

---

## Active work 已完成项详细过程（#24–#38, #40–#43）

### #24 「银行流水对账」模板（tpl-reconciliation，2026-09-04）

按 product-industry-roi.md 的「专业服务高 ROI 切入」落地，财务审计第二个模板（第 28 个业务模板）。结构：source 投料两段流水（`银行流水`/`企业账簿` 标记分段，每行 `日期 金额 摘要`）→ code 逐笔配对（date+amount 键，两侧差异分「银行有、账无」/「账有、银行无」）→ table 差异清单按金额降序（数值感知 `amountNum` 列）→ textGen 对账报告（引用 summary 统计、不得编造）→ gate 质检（rework 边回 report）。纯确定性 code + 零外部凭证。已加：core 形状断言（templates.test.ts，模板数 27→28 守护同步）+ 引擎级执行用例（regression/core-path.test.ts：3 银 + 3 账、2 匹配 2 差异、排序 50>30）+ template-checklist 登记（⬜ 待真实狗粮）。验证：core templates 22/22、server regression 18/18（需 `NODE_OPTIONS=` 清空——code 节点沙箱在 IDE 内与 Node 24 `--permission` 冲突）。真实狗粮已跑通（engine 层真实调用 agnes，run `dogfood-rec`）：agnes key 经仓库根 `.env` 的 `AGNES_API_KEY` 注入（`load-env.ts` 在 `index.ts` 首位 `import` 自动加载到 `process.env`，`ps eww` 看不到属正常——`process.loadEnvFile` 只更新内存对象），3 银 + 3 账 → 2 匹配 2 差异 → agnes 真实产出对账报告（总览统计 3/3/2/2、差异明细按金额降序 50>30、每条差异带排查建议、结论「存在差异」）→ gate 通过 → done。

### #25 「隐私政策合规审查」模板（tpl-privacy-review，2026-09-04）

专业服务方向法律合规第三个模板（第 29 个业务模板）。结构：source 投料隐私政策 → fileParse 解析 → textGen 合规盘点（11 维度：PII 披露/同意/第三方共享/用户权利/保留期限/安全/跨境/未成年人/联系方式/更新通知）→ textGen 整改建议（缺失维度 + 风险分级）→ gate 风险门禁（rework 边回 fix）→ human 人工确认 → sink。复用 contract-review 的 fileParse + 双 textGen + gate + human 结构，零新节点；合规条款覆盖是**模型判断**（区别于 compliance 节点的广告法极限词确定性规则）。已加：core 形状断言（templates.test.ts，模板数 28→29 守护同步）。真实狗粮（engine 层聚焦 audit/fix/gate 真实调用 agnes，run `dogfood-privacy`）：投料故意缺失多维度的隐私政策（仅 3 条），agnes 精确盘点 11 维度（2 覆盖 + 1 不完整「第三方共享只声明不出售」+ 7 缺失、均引用原文），整改建议逐维度带整改建议 + 风险等级（高/中）+ 法律依据（个保法/GDPR 具体条款）+ 合规优先级汇总 → gate 通过 → done。fileParse/human 集成由 contract-review 真实狗粮覆盖。

### #26 「发票批量 OCR 台账」模板（tpl-invoice-ocr，2026-09-04）

专业服务方向财务审计第三个模板（第 30 个业务模板）。结构：source 投发票图片（source.images）→ ocr（chi_sim+eng）识别 → textGen 字段提取（发票号/日期/抬头/销售方/价税合计/税额/税率，严格 JSON 数组）→ code 台账清洗（正则提取 JSON 数组、保证至少一行）→ table 发票台账按日期升序 → sink。零新节点（ocr + textGen + code + table）。已加：core 形状断言（templates.test.ts，模板数 29→30 守护同步）。真实狗粮（engine 层聚焦 extract/code/table，跳过 OCR——OCR 由 scan-ocr 已覆盖，run `dogfood-invoice`）：投 2 张发票模拟 OCR 文字，agnes 精确提取 7 字段（金额 1130/226、税额 130/26 正确）→ code 清洗 → table 台账按日期升序 → done。发现 table 通用局限：`coerce` 把纯数字字符串转 number，发票号「044001900111」前导 0 在台账展示时丢失（extract/rows 阶段仍保留字符串），标识符列前导 0 敏感场景待定。

### #27 「批量合同审查」模板（tpl-batch-contract-review，2026-09-04）

专业服务方向法律合规第四个模板（第 31 个业务模板）。结构：source 投多份合同（`=====` 分隔文本）→ code 拆条 → textGen 逐份风险审查（8 维度，扁平风险行 JSON）→ code 汇总清洗 → table 风险汇总按合同号升序 → gate 质检（rework 回审查）。用文本投料 + code 拆分绕开 fileParse 单文档限制，零新节点。已加：core 形状断言（templates.test.ts，模板数 30→31 守护同步）。真实狗粮（完整跑，run `dogfood-batch-contract`）：投 2 份埋风险合同，agnes 精确识别 7 风险点（合同1 四项 + 合同2 三项，severity 分级合理、建议具体）→ table 按合同号升序 → gate 通过 → done。至此专业服务方向第一档候选全部落地（法律合规「合同审查/证据清单/隐私合规/批量合同审查」4 个 + 财务审计「报销初审/银行对账/发票 OCR」3 个，共 7 个模板）。

### #28 「审计抽样底稿」模板（tpl-audit-sampling，2026-09-04）

专业服务方向财务审计第四个模板（第 32 个业务模板）。结构：source 投账目明细（CSV：日期,金额,科目,对方）→ code 抽样规则（大额≥10 万必查 / 重复交易 / 非工作日）→ table 抽样清单按金额降序（展示分支）→ textGen 审计底稿（引用 summary 统计 + 每类核查要点 + 结论建议）→ gate 质检（rework 回 report）。零新节点。已加：core 形状断言（templates.test.ts，模板数 31→32 守护同步）。真实狗粮（完整跑，run `dogfood-audit`）：投 6 笔账目，code 抽样正确（total 6 / sampled 5 / large 1 / duplicate 2 / weekend 3——08-01/08-02/08-08 均为周末），agnes 底稿统计正确、重点行在前、核查要点具体、结论建议合理 → gate 通过 → done。至此专业服务方向累计 8 个模板（法律合规 4 + 财务审计 4）。

### #29 fileParse 多文档增强 + 「尽调清单」模板（tpl-due-diligence，2026-09-04）

① 引擎增强——fileParse 从「只解析第一个文档」改为「解析所有文档」，多文档 text 用 `===== 文件名 =====` 头分隔（单文档路径字节不变、向后兼容），读不到/解析失败的文档跳过并计数；解锁批量合同/尽调场景，更新 engine.fileparse.test.ts 契约（10/10）。② 模板——专业服务方向法律合规第五个模板（第 33 个业务模板）：source 投多份尽调材料 → fileParse 解析所有文档 → textGen 尽调盘点（7 事项：工商/财务/资产/合同/诉讼/人力/税务）→ textGen 缺口清单（补充材料 + 风险提示 + 优先级）→ gate 质检。真实狗粮（聚焦 audit/gap/gate，run `dogfood-dd`）：投 2 份材料，agnes 正确盘点（1 覆盖 + 2 不完整 + 4 缺失）、缺口清单逐项补充；首次 run halted——gate criterion「已覆盖事项引用原文」对「不完整」事项过严（材料本身缺失无法引用）且 rework 回不到 audit，放宽 criterion 后 done。教训：criterion 的「引用原文」要求只适用于「已覆盖」事项，对缺失/不完整事项不合理，且 gate 的 rework 只能回最后一段 textGen。至此专业服务方向累计 9 个模板（法律合规 5 + 财务审计 4）。

### #30 核心文件重构（2026-09-04 立项 → 全部完成）

`engine.ts`（原 4954 行，`runNode` 单函数 3160 行占 64%）与 `Inspector.tsx`（原 3848 行，主组件 3350 行占 87%）曾到可维护性临界点。方案见 docs/design-refactor-engine-inspector.md。进度：① 阶段 1（拆 Inspector）已完成——`Inspector.tsx` 3848→611 行，新增 `apps/web/src/components/InspectorFields/`（types/shared/registry + 27 个 `XxxFields.tsx`），主组件用 `FIELD_COMPONENTS[node.kind]` 注册表分发，web 测试 1500/1500 全绿；② 阶段 2.1（runNode 闭包提取）已完成——29 分支提取 28 个为 `runScheduler` 内部 `runXxx` 闭包（notify 刻意保内联），`runNode` 3160→~380 行（-88%）；③ 阶段 2.2（NodeRunContext + nodes/）已完成——`NodeRunContext` 显式化共享状态（10 个可变标量 getter/setter 与调度器本地变量双向绑定），节点执行体迁至 `packages/server/src/nodes/`（28 个 `<kind>.ts` + types + shared），`runNode` 退化为 `NODE_HANDLERS` 注册表分发器（未知 kind 回落 textGen、notify 内联），**`engine.ts` 4954→1828 行（-63%）**，每步原子提交 + typecheck + server 747/747 全绿；④ 验收：core-path 回归 18/18 复跑通过；阶段 3（接口风格约定，纯文档）已标记延后。红线全部遵守：纯重构不改行为、小步原子提交、测试是唯一验收。

### #31 合规/运营批次五份方案（2026-09-05 定稿；①密钥轮换、②审计日志 P1+P2、③日志 P1+P2+P3、④公告 P1+P2+P3、⑤反馈 P1+P2+P3 全部已实施）

围绕「用户存的 key 能否合规安全保存」评估后补齐的设计文档，均已登记 docs/README.md 索引与 deferred-items 触发条件——① design-key-rotation.md（密钥轮换：P1+P2+P3 全量落地 2026-09-05——keyring 加载（`AGENT_WORLD_ENCRYPTION_KEYS` 多值 / `.encryption-keys` JSON 数组 / 旧单值等价兼容）+ `enc:v2:<keyId>:` 密文格式（v1 全兼容）+ `scripts/rotate-reencrypt.ts` 重加密收敛（幂等 / fail-closed / dry-run / --table / residue 门禁）+ 运维手册 docs/runbooks/key-rotation.md（定期轮换五步 / 泄露应急含 JWT secret 连带轮换 / 常见错误排查））；② design-audit-log.md（审计日志：P1+P2 已落地 2026-09-05——audit_log 表迁移 29 + `audit()` helper + 全词表埋点 + `GET /api/audit` + 专项测试；P3（180 天清理 + hash chain）待触发）；③ design-logging.md（服务端日志：P1+P2+P3 全量落地——见待办 33）；④ design-announcement.md（公告：P1+P2+P3 全量落地 2026-09-05——announcements/announcement_reads 表迁移 30 + `GET /api/announcements`（窗口过滤 + 双语字段 + 本人 read 状态）+ `POST /:id/read`（幂等 upsert）+ 管理 API（改走全局 admin 角色，env 白名单已退役见待办 34）+ 前端 `AnnouncementBell`（铃铛下拉 / warning 横幅 / critical 模态，`announcements` i18n namespace zh/en）+ `api.announcements.test.ts` 专项测试（窗口过滤/read 幂等/权限/双语/CRUD 回路）+ P3 target 定向（`graph:`/`template:` 受众匹配 + 模板卡角标/产线横幅入口级展示 + 管理表单三态受众，详见 Recently shipped #1））；⑤ design-feedback.md（用户反馈：P1+P2+P3 全量落地 2026-09-05——feedback 表迁移 33 + `POST /api/feedback`（服务端上下文白名单二次脱敏 + 滚动小时 10 条限流 + 截图 ≤1MB）+ `GET /api/feedback`（owner/admin）+ `PATCH /:id`（三态流转）+ `GET /:id/attachment` + 前端 `FeedbackModal`（截图粘贴 + 诊断勾选）+ UserMenu 入口 + AdminPanel 反馈 tab + `feedback` i18n namespace + P3 反馈→公告联动（`POST /api/feedback/announce` 单请求建公告+批量关闭 + AdminPanel 多选合并表单））。实施触发：轮换=合规准备启动。已完成的安全验证（非方案）：settings 表落库加密断言测试（`api.security.test.ts` 新增「settings at-rest encryption」组，直读 sqlite 原始字节断言无明文 + decryptString 可还原）；`.env` 钉死 `DB_FILE` 绝对路径消除 cwd 漂移；删除仓库根幽灵空库。

### #35 连接器数据插值（2026-09-05 方案定稿 → 2026-09-05 全部落地）

源起——用户质疑「原料台右边的节点面板为什么还有商品店铺字段，属性要适配各行各业」，复查发现 connector 结构化数据在 loader 出口被压成纯文本、简报字段与 connector 数据双来源拼接无提示、`graph.ts` 注释宣称字段级映射实为文本拼接。定位为引擎级通用机制（行业无关）而非电商特性：① `ResolvedMaterial` 加通用 `data?: unknown` 通道（product 填 `Product[]`，未来 http/database/各行业 connector 免费复用）；② engine 加 `sourceMeta` 旁路 Map（复刻 httpMeta 模式）+ interpCtx 合并 → 下游可写 `${srcId.data[0].name}`；③ 快捷名注册表（connector 类型→名字，product 注册 `product`/`products`，仅图中恰 1 个该类型 source 时注入全局名，法律 case/财务 invoice 未来各自注册）；④ `buildSourceBrief` 加通用 `fallbacks` 参（留空回填/手填覆写，映射由行业适配层声明——product：productName←name、brand←brand；调性字段永远纯手工），shared.ts 零领域知识；⑤ 简报 8 字段支持 `${product.*}` 插值；⑥ 修 `graph.ts` 失实注释；⑦ SourceFields hint。新行业接入 = 四件适配声明（data 结构/快捷名/映射/hint 文案），引擎零改动。方案全貌（2026-09-05 定稿，13 节）：§3.1 面板适配三段式（感知=前端查 connector.type 挂 hint / 适配=引擎 fallback 合并 / 换字段=未来行业包走 TemplateField 模式）、§6 语义边界（data[0] 须稳定 ORDER BY / 空 data 不报错 / 防重入单遍 replace）、§7 生命周期（resume 后 meta 内存 Map 为空，与 httpMeta 同级既有语义；brief artifact 含 fallback 结果持久化=历史回看数据快照）、§8 免费能力（`${product.price} > 100` branch 数值条件自动可用，CondParser 字面量嵌入已验证）、§12 使用维护（使用者零预设，无映射规则表无 YAML；三层维护=机制一次写完/适配每类型一次性四件套/数据变更零配置变更；商品库加列 `${product.sku}` 自动可用）。测试：buildSourceBrief 单测 + `engine.products.test.ts` 2→11 例（⑧防重入 ⑨branch 数值 ⑩纯手工模板逐字节基线 ⑪快捷名踩名守护——节点 ctx 优先）。4 个原子 commit 切分见方案 §11。电商 roadmap §F4.1 留指针。全局 `product` 快捷名已拍板（2026-09-05）：做——决策记录见方案 §3.2（可用性 + var/httpMeta 先例一致压过理论踩名风险；踩名优先级钉死节点 ctx 优先）。实施已全部完成（2026-09-05，4 个原子 commit 按方案 §11 切分，见 Recently shipped）：① D1+D2+D3+types（`ResolvedMaterial.data?` + `sourceMeta` 旁路 + 快捷名注册表 + `run.ts` loader 带 data）；② D4+D5+D6（`buildSourceBrief(fallbacks)` 仅事实字段留空回填/手填覆写、8 简报字段 `${product.*}` 插值、`graph.ts` 注释修正）；③ 测试 `engine.products.test.ts` 2→11 例（全局快捷名/命名空间/整节点引用/回填/覆写/调性不回填/多 source 退化/无 connector 空串/防重入/branch 数值/踩名）+ buildSourceBrief 4 单测；④ D7 web hint（product connector 显示「留空自动取商品库值」+ zh/en i18n）。发现并修掉一处偏离方案的关键实现细节：`loadProducts` 传入的是 `ProductConnector`（`.selection` 在顶层），不是含 `.product` 的壳。验收：server 883/883、web 1561/1561、typecheck 全绿。方案里标注的两个「顺手活」也已补上（2026-09-05）：① run 日志 warn——空 data（product connector 库空/筛空，§6.2）与悬空引用（图里写 `${product.…}` 但无 product source，§3.2）各 warn 一条，避免静默空串；② GlossaryModal 补 `${product.name}` 词条 + connector note 补 database/product（§10）。真实 dogfood 已跑通（engine 层真实调用 agnes，run `dogfood-interp`）：投料商品「复古托特包」→ `${product.name}` 解析到库值 → agnes 产出「一眼心动的复古托特包，装得下日常，也装得下品味」→ brief 留空自动回填「商品名称：复古托特包」。

### #37 画布等距 3D 展示视图（受限 3D + 2D/3D 切换，2026-09-06 立项，第一、二、三、四期全部完成）

方案见 docs/design-canvas-isometric.md。在现有 2D 编辑画布上增量加「受限 3D」展示视图（正交投影 + 俯角固定 + 水平旋转 + 平移；2D 编辑 / 3D 查看分离）。第一期 9 步原子提交全部落地：①three.js + React.lazy ②view-mode store ③坐标映射纯函数 ④静态 3D 场景 ⑤锁俯角摄像机 ⑥2D/3D 切换（CanvasToolbar 视角按钮）⑦锚点对齐 + 状态记忆 ⑧3D 选中节点（raycast + 高亮，点击弹 Inspector）⑨淡切 + i18n + dispose。第二期（2026-09-06 完成，`688dc42`+`f0fbcf2`+`b569a31`）：① 29 种程序化几何造型（`f0fbcf2`）——`buildNodeShape` 给每种 kind 一个可区分的顶部造型（球/锥/环/八面体/叠盒/门框/沙漏等），按 `NODE_CATEGORY` 五组配色；② 卡车沿 3D 管道跑（`688dc42` 折线纯函数 `xzPolyline`/`xzPolylinePointAt` + `b569a31`）——复用 2D 正交路由（`edgeAnchors`+`orthogonalRoute`）把边画成折线，卡车沿 `RuntimeState.packets` 逐条 spawn、按 `ARTIFACT_COLORS` 上色（rework 橙 / error 红）；③ 运行状态亮灯（`b569a31`）——每节点前置 LED，`statusLedColor` 按 `runtime.nodes[id].status` 变色（running 绿呼吸 / failed 红 / halted 黄 / done 暗绿）。runtime 经 ref 每帧读取，不重建场景。第二期完整落地，无剩余项。第三期（交互收尾，2026-09-06 完成）：① 3D 点击节点弹 Inspector（`c8ad1cb`，pointerdown/up 位移 >4px 判拖拽，点击才发 `setInspectorOpen(true)` 展开面板，拖拽旋转不误弹）；② 水平旋转多输入源（`93225a3`，滚轮上下 + 方向键 ←/→ 也转，缩放仍锁；触控板双指滚轮自动同路）；③ minimap 缩放滑块（`cc980ec`+`234c590`，`range` 跨度 0.3~3、保留 ± 步进 + 百分比、中性色不抢戏）；④ minimap 遮罩拖动修复（`bc754aa`+`9d8869a`，视口 2.25:1 在方形 minimap 里 `viewW` 先撞 `MAP` 横向钳死 [0,0] → 改钳 rect 中心、对称溢出）；⑤ 3D 遮罩拖动 = 平移（`e0bcbe7`+`a08cdf9`，move request 只改 `controls.target` 会变成重瞄准旋转，改 target+position 同步、遮罩框跟随光标）；⑥ 3D 遮罩区滚轮缩放画布（`ef1f740`，`onWheel` 3D 分支走 `requestCamera3dZoom` 而非改 2D `viewport.zoom`，否则遮罩缩了画布没缩）；⑦ 3D 适应按钮真 fit（`e284cf4`，`resetCamera` 原 `zoom=1` 写死只居中，改 `fitZoom=min(VIEW_W/bw,VIEW_H/bh)` + `camera.zoom=fitZoom/viewport.zoom`）。第四期（视觉打磨 + 节点拖动，2026-09-06 完成）：① 默认视角 RTS 等距角（`53ac300`，左后上方 30° 俯角，帝国时代风）；② 适应对齐 2D 布局（`156feb4`，按图宽高比选 yaw，长边水平）；③ 节点体积感（`b008215`，高度 50 + 多面材质 + 左后上方光照）；④ 节点旋转 22.5°（`78fbdf5`）+ 扁平化材质柔和（`27aefb5`）；⑤ 管道实心圆管 + 地面阴影 + 参考网格（`25e8543`）；⑥ 俯角调低（`cb8218e`，π/5→π/3）；⑦ 锚点旋转对齐面中心（`b70d9d6`）；⑧ 左键拖节点移动布局 + 管道实时重路由 + 手形光标（`f7c6b73`，拖动时 `controls.enabled=false` 避免与 pan 冲突、实时 `rebuildEdgesForNode` 重建 TubeGeometry、松手 `moveNode` 写回 graph）。

### #38 商业化 M0：本地运行环境部署（2026-09-07 立项，2026-09-08 全部完成）

把 agent-world 部署成可 7×24 跑真实产线的单机服务（Ubuntu 纯 Server 笔记本 / Node 24 / systemd 托管 server / nginx 同源托管 web / `CODE_SANDBOX=bwrap` 关审计 H4），作为商业化 P0 成本计量回采的运行床。挂 design-monetization.md §8.13 里程碑 M0。文档：docs/runbooks/deploy-ubuntu-execution-plan.md（阶段 0-7 方案）+ docs/runbooks/deploy-ubuntu-execution-log.md（逐步执行记录，敏感信息一律占位符）+ docs/runbooks/deploy-ubuntu-server.md（命令手册）。阶段 0-7 全部完成（免密 A1-A4 / Node 24 / bwrap / nginx / agentworld 用户 / mask suspend / rsync+构建 / .env / systemd active / nginx 反代 / 备份 cron 就绪；`AGENT_WORLD_ENV=staging` 已注入）；阶段 7 商业验收 8/8 全部通过（注册 / AGNES key / 建产线跑通 / 成本计量 / cron 触发 / code 沙箱 / subscriptions 表 / 备份恢复），期间修掉 bwrap 在 systemd `PrivateTmp` 下写 `/tmp` 被命名空间隔离的问题（`f288cc1` 改挂 writable tmpfs）。CI/CD 自动部署已生效（`d7e3c22` + `85094b0` 已在 `origin/dev`/`origin/main`；`gh run list --workflow=deploy.yml` 可见 2026-09-08 起多次 success，self-hosted runner 执行 `/opt/agent-world/deploy.sh`）。

### #40 Hasee 异地备份到 Mac（2026-09-10，未 commit）

补 deferred-items「异地备份推送」缺口——服务器备份与原库同盘，异地由 Mac 每日拉取。① Mac 端：`scripts/remote-snapshot.js`（远端 node:sqlite 只读 VACUUM INTO 一致快照，含 WAL、不干扰运行中 server，VACUUM 前自动清旧文件）+ `scripts/backup-agent-world-to-mac.sh`（scp 快照脚本 → 远端生成快照 → rsync 拉 db/artifacts/logs → 本地 `sqlite3 integrity_check` 门禁 → db 滚动保留 14 份 → 幂等标记 `.last-backup-<date>`，`--force` 可强跑）；launchd `~/Library/LaunchAgents/com.agent-world.backup.plist`（每日 11:00 + RunAtLoad 补跑，SSH 走无口令 `id_ed25519` 不依赖 agent）。已实机验证：手动跑 + launchd kickstart 各一次完整链路通过（快照→拉取→校验 ok→artifacts/logs），幂等跳过验证通过。踩坑两处：① macOS bash 3.2 的 `$VAR` 后紧跟全角括号会吞字节（`$TODAY）` → `TODAY�` unbound），变量引用统一 `${VAR}`；② `VACUUM INTO` 目标已存在报错，先 `fs.rmSync` 清理。② 服务器端缺口：核实 cron 每日 02:30 正常（`current` 与 `snap-2026-09-09` 同 inode 硬链接证明轮转正常，「current 停旧」实为无数据变化时 rsync 全跳过，非故障）；`sqlite3 wal_checkpoint` 静默失败补丁已执行闭环（2026-09-10）：`scripts/patch-hasee-backup.sh`（原脚本备份 → python 替换为 node:sqlite checkpoint → 手动验证）已由用户授权 sudo 在 Hasee 执行——原脚本备份为 `/usr/local/bin/backup-agent-world.sh.bak-20260909-182215`，checkpoint 行已替换（失败时 echo 告警继续，不中断 rsync），手动验证通过（`-wal` 清空为 0 字节、主库 921600B 落盘）。③ 密钥边界：`.encryption-keys`/`.jwt-secret`（及 `/opt/agent-world/.env`）600 权限，异地备份不含密钥；已导出单独保管（2026-09-10）——三个文件逐字节 hash 验证后存入 macOS 钥匙串（service=`agent-world`）：account `encryption-keys`（明文 68B）/ `jwt-secret`（明文 64B）/ `env`（.env 224B，多行内容经 security 会乱码故存 base64 300 字符）。取回方法：`security find-generic-password -a agent-world -s encryption-keys -w`（明文条目直接输出；`env` 条目先 `| base64 -D` 还原）。服务器原文件保留不动。文档：deferred-items「异地备份推送」行已更新为已落地、deploy-ubuntu-server.md §六 补异地备份小节 + checkpoint 模板改 node 版。

### #41 M1 回采产线挂载（2026-09-10，进行中→已闭环）

在 Hasee staging 按「成本画像」挂 4 条代表产线攒真实成本（不全挂 33 模板——一次性体验≠真实使用、video 高频拉高均值致定价偏高、法律/财务模板无代表性，模板覆盖是狗粮验证的事）。① `[M1回采] ①写草稿·高频文本`（cron `0 */3 * * *`）② `[M1回采] ②翻译流水线·带返工`（cron 每日 10:00，gate 上限 3 次天然带返工）③ `[M1回采] ③短视频广告工坊·媒体中价`（cron 每日 11:00，imageGen $0.04/图 + videoGen）④ `[M1回采] ④批量内容工坊·批量放大`（cron 每周一 9:00，Map 批处理 5 条选题）。已配：模板实例化、textGen/imageGen 模型显式配 agnes-2.0-flash / agnes-image-2.0-flash（模板新实例节点 model 默认 `__unset__`，写草稿初稿/润色在 Inspector 逐配，翻译/短视/批量模板部分自带头模型）、source custom 投料（真实主题/英文原文/广告简报/选题清单）、cron 触发器。改产线名无 UI 入口（命令面板/标题下拉均无）→ 走同源 API：`GET /api/graphs/:id` 取完整 doc → 改 `name` → `PUT /api/graphs/:id`（PATCH 404 不要用，PUT 成功后 version+1）。成本链路已真实验证：写草稿冒烟 run——初稿 $0.00048 计量、润色重试后 $0.00092、电费读数 $0.00140（按节点/模型归集正常）。阻塞：Agnes free tier 429 限流——run 内连续调用（节点间隔秒级）只放行第 1 次，后续必 `HTTP 429 "reached the API rate limit for free users. Upgrade to a Token Plan"`（润色/质检均撞，历史"运营周报 产线故障 耗时2s"同因）；手动重试（间隔 90s+）可通过。方案 C（降频+拉长 retry 退避）用户已拍板，2026-09-10 实施中：已做（配置层）：① 写草稿 cron `0 */3 * * *`→`0 */6 * * *`（触发器 upsert：POST /api/graphs/:id/triggers 同 id 即更新，无 PUT 路由）；4 条产线全部文本节点 retry 调 `{maxRetries:4, baseDelayMs:30000, maxDelayMs:120000}`（①初稿/润色、②初译/校对、③脚本撰写、④批量成稿；PUT /api/graphs/:id 逐个带完整 doc，①version→10，其余→3）。实测（手动触发 ①，run d241361c）：初稿一次成功 $0.00060（11.6s，未触发 retry）；润色 429 后自动 30s/60s 退避共 105.5s 重试成功 $0.00094——textGen retry 配置生效；但质检 gate 仍 429 失败（errorCode UNKNOWN），run 终态 failed、成本 $0.00153 已归集。gate 缺口实锤：`packages/server/src/nodes/gate.ts` 的 `worker.judge` 调用无重试包装，provider 层（openai-compatible.ts:510）judge 的 retry 硬编码 `{maxRetries:1, baseDelayMs:1000, maxDelayMs:10000}`——1s 退避躲不过 ~60s 限流窗口；ImageGenConfig/VideoGenConfig/GateConfig 均无 retry 字段（core schema），imageGen 紧随 textGen 调用也会 429。已闭环（2026-09-10）：方案 ① 代码补丁用户拍板后全部落地——① 429 长退避补丁（PR #229，merge `006186b` 已部署）：`openai-compatible.ts` 的 judge / generateImage / generateVideo 提交段用 `withRetry` 包裹（30s/60s/90s/120s ×4，`LONG_RETRY` 常量 + `isRateLimit` 判定；顺带修掉 judge/summarize 的 retry 死配置——streamChat 本不消费 retry，纯配置无效，必须在调用处包重试）；② 触发器持久化 bug（PR #231，merge `70524df` 已部署）：`saveGraphUnscoped` 以 `user_id=NULL` 走 upsert，而 insertGraph 的 `ON CONFLICT ... WHERE graphs.user_id = excluded.user_id` 对 NULL 恒不成立 → 触发器更新被静默跳过、只存内存索引、重启即丢（实测 4 条产线部署后 triggers 全空）→ 修复为读取产线真实 user_id 复用，doc（含 triggers）正常落盘，新增回归测试 `db.triggers-persist.test.ts`；③ 全链路复测通过（run `f19b88bc`）：初稿 $0.00047535 一次过 → 润色 $0.0007014 一次过 → 质检 gate.verdict passed（429 不再打爆 run）→ 成稿，status done，总成本 $0.00117675 完整归集；④ 4 条产线 cron 触发器全部重建并验证 doc 落盘（① 每 6h、② 每日 10:00、③ 每日 11:00、④ 每周一 09:00）。M1 回采产线全部就绪，cron 按计划自动攒数据。顺带：全量 server 1010/1010（含 RPA 2 例——本机补装 Playwright chromium 后全绿）。部署复核（2026-09-10）：dev 远端 = `5fab154`（PR #233 pr-helper bot 自动合并 handoff 记录）== Hasee 健康探针 commit，dist 05:29 UTC 构建、服务 05:29:38 重启完成；05:29 重启后 next-runs 4 条 cron 排程正常 = 触发器持久化在真实重启场景下验证通过。每日回采体检（2026-09-10 起，用户授权「每天都看一遍直到满意为止」）：豆包定时任务每日 10:30（Asia/Shanghai）触发，检查 Hasee 4 条 M1 产线回采数据：① 当日 + 累计 run 列表（status 分布：done / failed / running，失败原因归类，重点盯 429 残留）② 每次 run 成本归集（`/api/runs/:id/stats` costUsd 与成本报表总额对账，确认非 0 / 非碎片）③ 完成率与异常清单。通过标准：run 完成率正常（失败均有明确非限流原因）、成本归集完整无 0 计费、429 不再打爆 run。体检结论（含发现与处置）回写本待办；直到用户满意或叫停为止。执行方式：SSH 别名 `hasee-2016-server` 或浏览器 http://192.168.31.14（需登录态）；若触发环境无法访问局域网 / 登录态丢失，明确告知用户并提供体检清单。

### #42 画布 3D 视图审计欠账清理（2026-09-10）

清掉 docs/code-audit-2026-09-06.md 全部 3D 遗留（7 项）——`Canvas3D.tsx` 拆 mount-once + graph-sync 双 effect（M30/L29：WebGLRenderer/灯光/循环挂载一次，graph 编辑只重建节点/边几何；camera3d 仅挂载时读取，杜绝陈旧相机竞态）、setPointerCapture + pointercancel 兜底（M23：画布外松手不再冻结相机）、prevSel 增量 emissive（L30：仅选中变化时遍历）、cleanup 统一 dispose Mesh+Line 材质数组（L28/L31：多面 base 材质与 GridHelper 材质随场景释放）、ResizeObserver 复核确认已满足（M26）。新增回归测试：graph 变更不重建 renderer（`Canvas3D.test.tsx` 3 例）。web typecheck 绿、全量 1643/1643。审计汇总同步：已修复 60→67、未修复 13→6（剩余全为性能/历史数据/设计意图类暂缓）。3D 功能视图至此零欠债。

### #43 RTS 宏观视角·阶段 A 平面运营工作台（2026-09-10，A1-A7 一口气全部完成，PR #239 merge `514d18a` 已部署 Hasee）

设计见 docs/design-rts-overview.md（三层世界 L0 工业园区/L1 单厂 3D/L2 节点，A 平面工作台→B 宏观沙盘 MVP→C 完整 RTS，commits `3b85b9d`/`252dced`）。A1 `db.operationsByGraph` 跨产线只读聚合（`225f7b3`，5 db 测试）——按状态计数 running/halted/done/failed/tripped/cancelled、最近一次 run 跨时窗（last* 不受 since 限）、时间窗成本复用 `costForMonth` 口径（SUM(node_runs.cost_usd)、排除 running）、零 run 产线 LEFT JOIN 保留、graphIds 走协作 scope，全标准 SQL PG 双轨复用；A2 `GET /api/operations/overview`（`b85a768`，5 api 测试）——visibleGraphs scope + totals reduce + 每 graph cron next-run；A3 web api client（OperationsOverview 类型 + `operationsOverview(sinceMs?)`，按 PerformanceDashboard 等现有页面惯例组件自取数、不造冗余 store）；A4 `OperationsDashboard.tsx`（`5c94fca`，7 组件测试）——15s 轮询、今日/全部时窗、汇总条 9 格（总/运行中/待审/成功/失败/熔断/取消/成本/成功率）、失败+熔断「需要关注」区、每产线状态卡（chips/最近运行/下次 cron/成本/下钻最近 run）；A5 命令面板「运营工作台」入口 + hub 下挂审核队列（带 halted 徽标）/发布日历/效果成本；A6 zh/en `modals.operations` 全 `t()`、样式全设计 token（i18n 守护 4/4、零硬编码中文与颜色）；A7 server 1015/1015、web 1650/1650 全绿，PR #239 CI 全绿 merge、Hasee 部署到 `514d18a`，浏览器真机对账通过——全部时窗 total13/done9/failed4/cost$0.5446/成功率69% 与 node:sqlite 直查 DB ground truth 逐项一致，今日时窗自洽、lastRun 跨时窗显示、cron next-run、空产线保留、hub 跳转、失败红边语义色全部验证。阶段 B/C 前置（商业化闭环、真实多产线规模）不满足，仍按设计 §九挂 deferred。

---

## Recently shipped 归档（第 6–20 条，2026-09-08~09-09）

### 6. feat(core,server,web) 成本计量开跑前置：单价缺口审计 + 按模型分摊（2026-09-08）

商业化 P0 的最后两块。① 单价缺口审计：`unpricedModels()`（core，按 modality 分 `all`/`any` 完整性）判定「完全没配单价」与「只配了一部分」，server 启动 warn + `/api/costs` 下发 `unpricedModels`，成本报表顶部警告条点名缺哪几项。动因：缺单价的模型 `computeCost` 返回 0，`node_runs.cost_usd` 当场按 0 落库、事后无法补算，回采数据会系统性偏低且无声。② 按模型分摊：`node.finished` 的 `Usage` 加可选 `model`（5 类生成节点 + generic 4 个 emit 点），`node_runs.model`（迁移 36，带 `down`）持久化，`byModel` 聚合 + 前端「按模型分摊电费」表 + CSV `model` 段；迁移前的行 NULL 归入 `(未记录模型)` 桶而不是丢弃，保证 byModel 与总额对账。③ 顺手把 `usage_ledger` 标注为 P1 配额脚手架（表 DDL / 两条语句 / 迁移 34 描述三处），此前两次被误判为死代码。6 个原子 commit `b99e7d6`/`e48cfba`/`91b30b5`/`7122790`/`d4c9f2b`/`88de316`（PR #211 已合 dev，Hasee 已部署 `deploy OK: 1ef57bc`）。core 191→198，server 937→939，web 1575→1580。

### 7. fix(server,core,test,docs) 连接器数据插值恢复 + 全 33 模板盘点（2026-09-08）

根因：D1-D7 于 9/5 落地，9/6 晚被 `acbc273`/`addf74d`/`d095d59` 三个无说明 commit 回滚了 D3/D4/D5（快捷名注册表、简报字段回填与插值、空库+悬空引用两处 warn），只剩 D1/D2/D6 存活。修复：引擎恢复 3 层（D3 快捷名注入 + D4 回填 + D5 插值）+ 恢复被删 4 正向用例 + 4 个全链路集成测试（source→textGen 完整管道）+ 两个强商品模板（淘宝详情、小红书种草）预设 product connector（manual selection）+ 形状断言锁死边界 + 6 个文件型模板登记为后续。全 33 模板按 A 强商品 2/B 开关型 5/C 文件型 6/D 手动文本 20 盘点不重不漏。方案文档 `design-template-connector-presets.md` 新建 + `design-data-interpolation.md` 更新回滚/恢复时间线。5 个原子 commit `a139541`/`e840dc8`/`e6bf852`/`0527823`/`c6c0f9c`。server 937/937（+8），core 191/191（+1），web 1575/1575（+5）。

### 8. docs+fix M0 阶段 7 商业验收全部通过（2026-09-08）

bwrap PrivateTmp 修复（`f288cc1` nginx tmpfiles.d 配 PrivateTmp=写入 `/tmp` 被 systemd 命名空间隔离 → 改挂 writable tmpfs）+ 8/8 验收逐项记录（`7fc299b`/`c99b874`/`a7cae3e`/`f85cd00`）。M0 全部完成。

### 9. fix(web) 切换产线被 409 静默阻断（2026-09-08）

根因三连：① `scheduleSave` 自动保存不带 If-Match 且成功后不回写 `serverVersion`，服务端 upsert 已 `version+1` 而本地仍是旧值；② 切换产线时 `flushSave` 拿过期 `If-Match` 发条件 PUT，服务端 `updateGraphIfVersion` 匹配不到行必返 409（只要编辑过一次就 100% 复现）；③ 8b8969b 给 `flushSave` 加了 rethrow（M22），但 `switchGraph` 的 `await flushSave()` 在 try/catch 外，409 直接把切换打断且无任何提示。修复：自动保存成功后回写 `serverVersion`；新增 `enqueueSave` 保存队列串行化 autosave 与 flush（消除并发双 PUT 竞态）；`switchGraph` 捕获 flush 失败 → toast 报错并中止（保住未保存修改，不再静默）。+3 回归用例（graph.save.test.ts），web 1571→1574。`780eb58`/`99e161c`/`11a8f64`。

### 10. fix(web) 修复 PG 演练方言缺口 9 类（2026-09-08）

Docker postgres:16 + dev 库（25 表/12.2 万 events）端到端搬迁演练：行数全对齐、71 图 doc 逐字节一致、enc:v2 密文可解密、PG 冒烟全通。演练抓出并修复 9 类静态评审漏掉的方言缺口。详见 design-postgres-migration.md §8。+1 用例（pg-sql BLOB→bytea），server 928→929。

### 11. feat(server) PostgreSQL 阶段 3：DB_DRIVER 开关 + 搬迁脚本（2026-09-08）

`openDatabase()` 按 `DB_DRIVER` 分派 + FTS 知识库 PG 下诚实降级 + `migrate-to-postgres.ts`（VACUUM INTO 快照→流式批量 INSERT→行数校验）+ 修复 DDL 契约缺口 4 表。+9 用例，server 919→928。

### 12. fix 审计修复 25 项收尾（2026-09-08）

高危 8 项清零 + 本轮 25 项：server L5/L6+M1/M3/M5（L5 graph_variables 加密、L6 clientIp trusted proxy、M1 abort 挂起、M3 产物 id 前缀、M5 文本产物事件）、mcp 8 项（M15-M19+L15/L16/L18）、core M31-M36+L23/L24（M36 旅行模板目的地字段）、web 4 项（M21/M22/M24/M27）。审计报告 61/77 修复，剩 13 项 low 级暂缓。

### 13. chore(ci) dependabot 依赖治理（2026-09-08）

关闭 zod 4 major 升级 PR #182（~1300 处类型错误），`.github/dependabot.yml` 加 ignore zod major；合并 4 个依赖 PR（jose 6.2.11 / nodemailer 10 / i18next 26.4.2 / hono 4.13.7）。server 911→912。

### 14. feat(ci) SAST（CodeQL）（2026-09-08，P1 安全）

`.github/workflows/codeql.yml`（CodeQL 周度 + push/PR 触发）。

### 15. docs 运营三件套（2026-09-08，P1 运营流程）

postmortem 模板 + SLA/SLO 定义 + 变更管理。

### 16. feat(server) 数据归档 + 一致性校验（2026-09-08，P1 数据域）

`pruneOldEvents` + `scripts/prune-events.ts`（清理 90 天前 events）+ `db.verifyIntegrity()`。server 909→911。

### 17. feat(ci) 依赖漏洞扫描（2026-09-08，P1 安全）

CI 加 `pnpm audit --audit-level=high` 门禁 + glob 高危 CVE 修复。

### 18. feat(devx) pre-commit hooks（2026-09-08，P1 DevEx）

husky + `.husky/pre-commit` 跑 `pnpm typecheck`。

### 19. feat(server) 覆盖率门禁（2026-09-08，P1 测试工程）

`@vitest/coverage-v8` + 阈值门禁（lines 75 / stmts 72 / funcs 74 / branches 62）。

### 20. feat(server) migration 回滚（2026-09-08，P1 发布工程）

`Migration.down` + `rollbackLatestMigration` + `scripts/migrate-down.ts`。server 908→909。
