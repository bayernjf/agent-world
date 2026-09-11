# Handoff Archive — 2026-09-11

> 从 `handoff.md` Active work / Recently shipped 归档的已完成项详细过程。本文件只读，新增内容请写回 `handoff.md`。
> 更早归档：`handoff-archive-2026-09-07.md`（#1–#37 摘要）、`handoff-archive-2026-09-10.md`（#24–#43 详细过程 + shipped #6–#20）。

---

## Active work 已完成项详细过程（#44–#45）

### #44 web 组件测试 100% 覆盖 + research-loop 补 sink（2026-09-10，5 个 commit）

① 补全最后 9 个无独立测试的 web 组件，分 3 个原子 commit（`f249b05` 三大 CalendarView/AnnouncementBell/ProductLibrary 共 39 例、`03add89` 四中 CollaboratorsModal/VariantComparison/BrandAssets/PublishTargets 共 38 例、`638bff3` 两小 KeyInput/LanguageSwitcher 共 9 例），web 1675→**1761/1761 全绿（81 文件）**，`apps/web/src/components` 下再无「有 .tsx 无 .test.tsx」的组件。② research-loop 补成品库 sink（`8752f58`）——loop 节点 BFS 遍历时把 sink 排除出循环体（否则 sink 被当成循环体每个 item 跑一次、且把单 endNode 的扁平聚合 `results:[...]` 破坏成 `{body,sink}` 多 endNode 结构），模板新增 depot 节点 + loop→depot 边，消除 "Nothing collects the output" 编译 warning；新增 **sandbox-free** 引擎测试（table 纯 JSON 解析 + fakeWorker textGen，绕开本机 macOS seatbelt 跑不了 JS sandbox 子进程的限制），并用「临时回退 loop.ts」对照实验反证改动必要（无改动时 sink 跑 3 次、聚合变对象；有改动 sink 跑 1 次、聚合保持扁平）。core **207/207**、全仓 typecheck 全绿。**本机限制（非缺陷）**：server 套件中依赖 spawn JS sandbox 子进程的用例（engine.code/loop/map/table 等用 code 节点造数据者）在本机 Node v22 + macOS seatbelt 下失败（status 71），干净 HEAD 同样失败、CI Linux bwrap 正常；本次新增的 loop-sink 测试刻意不依赖 sandbox，本机稳定绿。**Hasee 真机复跑验证通过（2026-09-10，run `91b7bcf5`，dev `49503e5`）**：从模板新建带 depot 的产线，投 2 课题，真实 tavily 搜索 + agnes 生成卡片（含 429 长退避 retry），约 4 分钟 done；depot sink 只 started/finished 各 1 次（未被吞进循环体），depot output 与 loop 聚合 artifact 字节级一致（2466B / 2 张调研卡片），创建 run 时编译 diagnostics 空，零 failed。template-checklist 同步从 🟡 升 ✅。

### #45 M1 等待期清账三件套（2026-09-11：code-audit 尾项 + C 类模板 file connector 预设 + 文档同步）

M1 回采纯攒数据期间主动清三项不依赖回采数据的账。

① **code-audit 最后 6 项 low 全部清账**（L19/L20/L22/L25/L26/L27，原 2026-09-10 复核"应继续暂缓"，本次用户决定清掉）：
- core 端 L25 `compile.ts` topoSort 由每出队节点遍历全边 O(V·E) 改为预构建出边邻接表 O(V+E)；
- L26 刻意不改 zod schema（怕旧图宽松配置 parse 失败），改在 compile() 末尾对 cron 缺表达式/webhook 缺 secret/event 缺 source/batch 缺配置各发一条**非破坏性中文 warning**（不阻断 load/run），+5 测试；
- L27 经核实确为设计意图（rework body 必须含入口到 gate 整条正向祖先链，返工要重跑整条链路），只补注释不改逻辑；
- web 端 L19 `App.tsx` 整 store 解构改 10 个独立 selector；L20 onDragStart 用 detachDrag ref 持有 document 监听 detach 函数 + unmount cleanup effect 兜底拖拽中途卸载；L22 `Minimap.tsx` 全局 pointer 监听 effect 原依赖 viewport 导致拖拽每帧卸载重挂，改 liveRef 镜像 viewport/scale、依赖收敛为只在 dragging 开始挂一次（并删掉因此无引用的 contentDeltaFromMinimapDelta，注意 liveRef 必须在 scale 声明后否则 TS2448）。

② **C 类文件/图片型模板预设 file connector（7 个）**：原卡点"写死绝对路径对别人机器无意义"，最终形态 = **预选 connector 类型 + 空路径占位 + engine 空路径友好报错**——doc-ingest/contract-review/privacy-review/batch-contract-review/due-diligence 5 个文本型预设 `{type:"file",file:{path:""}}`，scan-ocr/invoice-ocr 2 个图片型加 `asImages:true`（commit `a153661`）；`connectors.ts` file 分支对空白 path 抛中文友好错误（避免 `path.resolve("")` 落进程 CWD 遍历服务器目录），+2 测试。A 类 2 个强商品模板 product 预设在 commit `0527823`。`templates.test.ts:177` 形状断言锁死「恰好 7 个文档/OCR 模板带 file connector」，**改 templates.ts 会破坏该断言，勿动**。用户从模板建产线后投料台已选中「文件」连接器、只需填路径。

③ **文档同步**：code-audit 报告状态表/汇总/归因全部回写（已修复 67→73、未修复 6→0）、deferred-items C 类行标已落地、design-template-connector-presets §8/§9 与 C 类小节更新（6→7 个补 batch-contract-review，修正 D 类重复计数，正确盘点 2+5+7+19=33）、README 测试数与 Feature map、docs/README 索引。验证：core、web 1761（81 文件）、connectors.test.ts 33 全绿；server 全量本机 failed 经 `git stash` 对照确认是 Node v22+seatbelt 已知环境限制（干净 HEAD 同样失败），非本次回归。

---

## Recently shipped 归档（2026-09-10，#3–#5）

### test(web)+fix(loop) web 组件测试补到 100% 覆盖 + research-loop 补 sink（2026-09-10，`f249b05`/`03add89`/`638bff3`/`8752f58`）

① **9 个剩余无测试组件分 3 个原子 commit 补齐**：Batch1 三大（CalendarView 13 例动态取当前月避免依赖系统时间 / AnnouncementBell 12 例该组件用原生 fetch 需按 URL 路由 mock global.fetch / ProductLibrary 14 例归档恢复用 rerender、缺字段回退、null price）；Batch2 四中（CollaboratorsModal 10、VariantComparison 10 纯 props 组件 mock runtime 必须带 `nodes:{}`、fanout 从 artifact 读泳道、chosen/score 分级、BrandAssets 8 ASCII+中文逗号 split、PublishTargets 10）；Batch3 两小（KeyInput 6 防自动填充属性、LanguageSwitcher 3 测试内 import i18n 实例 changeLanguage 隔离）。过程中修掉多处「中文文案同时出现在 option 与列表行致 getByText 撞多元素」（改 getAllByText）。web 1675→**1761/1761（81 文件）**，组件目录零「有 tsx 无 test」。② **research-loop 补成品库 sink（`8752f58`）**：根因——不能简单加 loop→sink 边，loop 的 body BFS 会把唯一入边来自 loop 的 sink 判进循环体，导致 endNodes 从 {writer} 变 {writer,depot}、聚合从扁平 `results:[卡片]` 破坏成 `results:[{writer,depot}]`，且 sink 每 item 跑一次；修法是 BFS 内 `if (nodeById(graph,id)?.kind==="sink") continue`，loop 正常聚合后由主调度器把 sink 拉起一次喂入聚合。模板加 depot 节点（loop 正下方 x600 y560 避免与水平循环体交叉）+ e6 边，编译 diagnostics 由 1 warning 降为 **0**。新增 sandbox-free 引擎测试（source→table(parse/json)→loop→textGen body+sink，不 spawn 子进程），本机对照实验：回退 loop.ts 时 sink 跑 3 次/聚合变对象（测试红），应用后 sink 跑 1 次/扁平 3 项（测试绿）。core 207/207、全仓 typecheck 全绿。**本机环境注记**：依赖 code 节点实跑的 server 用例在本机 Node v22 + macOS seatbelt（sandbox-exec status 71）下失败，干净 HEAD 同样失败、CI Linux bwrap 正常，与本次改动无关。

### 验证 tpl-research-loop 完整 happy path（Hasee，2026-09-10）

feature 合 dev（PR #243, faa1c27）部署 Hasee 后真机复跑。成功 run `9cb4b423`：source 投 2 行课题 → split 正确拆 2 课题数组 → loop 逐课题迭代 → kicker 出题 → **search tavily 每课题返回 4 条真实结果** → **writer agnes 生成结构化调研卡片（结论/关键事实/待确认）** → loop 聚合 `{results:[卡片1,卡片2]}`，"循环 2 次完成"，最终正好 2 张卡片、课题对应正确无重复。**关键验证：writer 长退避 retry 确实扛住了 Agnes free tier 429**——429 被正确识别为 RATE_LIMIT（errorCode 落事件），按 30s/60s/120s/120s 指数退避；成功 run 的 writer 耗时 108s（一次 retry 后通过）。另一次失败 run `816e274f` 是**误操作同时开了 2 个 run**，最多 4 个 writer 并发打爆 free tier 配额，5 次 retry（344s=30+60+120+120 退避）全部 429 才放弃——证明 retry 逻辑本身正确，是测试操作 + free tier 并发限制问题，非 bug。**结论：research-loop 从 🟡 升 ✅（32/33 模板跑通，仅剩 news-podcast 缺 TTS）**。两个观察项（非阻塞）：① 模板无 sink 节点，编译 warning "Nothing collects the output"，但 loop 自身聚合 JSON 即最终产物，功能不受影响（后已由 #44 补 sink 消除）；② loop body 多 item 并行执行（MAX_CONCURRENCY=6），free tier 下多课题易触发 429，retry 已缓解，付费层无此问题。template-checklist 同步更新。

### test(web) M1 等待期补 web 组件测试 + code-audit 复核 + research-loop 配置验证（2026-09-10）

M1 回采攒数据期间继续清 deferred。① **web 组件测试补 2 个高价值组件**：PerformanceDashboard（F6 效果数据 + F9 内容成本，12 例：渲染/汇总卡片/空分母/聚合维度切换/插入 metric/CSV 导入/成本聚合/插入成本/Escape/backdrop/模态体点击）+ BatchManager（F5 批量任务，14 例：渲染/空状态/批次列表/创建校验/创建成功/展开详情/重试失败项/Escape/backdrop/多状态），web 1650→**1676**。② **code-audit 剩余 6 项逐项复核**（L19/L20/L22/L25/L26/L27），当时确认均应继续暂缓（性能优化价值低/边缘场景/历史数据风险/设计意图），复核结论写入 code-audit-2026-09-06.md 汇总区（次日 #45 用户决定清掉并全部落地）。③ **tpl-research-loop 模板配置验证**：core 207/207 全绿，search provider=tavily + writer retry=4x/30s-120s 配置正确；完整 happy path 待 feature 分支合 dev 部署 Hasee 后复跑（当日稍后真机复跑通过，见上条）。
