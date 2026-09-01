# 产线模板验证与评估待办表

> **定位**：跟踪每个产线模板的**真实狗粮验证与体验评估**状态。模板的存在性/定义以 core `TEMPLATES` 数组为单一事实源（27 个，2026-09-01 确认）；本表只管"哪个模板被真实验证过、体验如何"。
>
> **维护规则**：
> 1. **新增模板必须在此登记一行**（与 core 模板数对不上即视为欠账），登记时验证状态标 ⬜。
> 2. 真实跑通后更新状态为 ✅，并记 run id / 日期 / 评估发现；发现的问题按性质流转：可修的进 [handoff.md](../handoff.md) 待办，暂不修的进 [deferred-items.md](deferred-items.md)。
> 3. **两级验证口径**：① 引擎级冒烟（全部 27/27 已通过，2026-08-31，见 handoff 待办 #4）——只证明形状与执行不崩；② **真实狗粮运行**（本表跟踪的）——配好 provider 真实调用模型、产物可用的端到端验证。

## 状态图例

- ⬜ 待真实验证（引擎冒烟已过，未真实跑过）
- 🟡 部分验证（跑通但有关键缺口，见备注）
- ✅ 已真实跑通（端到端产物可用）
- ❌ **真实路径不可用**（产品能力缺口导致必败，非参数/环境问题；引擎冒烟能过是因为用例直接合成了产物）

## 待办表

| 分类 | 模板 id | 模板名称 | 状态 | 真实运行记录 | 评估发现 |
|---|---|---|---|---|---|
| 营销内容 | tpl-media-pipeline | 短视频广告工坊 | ✅ | run `e74cba65`（文本链路）+ `49e60631`（全链路 MP4，5m50s），2026-08-31 | 期间修复 undici 对齐、videoAdapter、artifact 落库双 bug；视频生成 5-6 分钟/段属 API 固有耗时 |
| 营销内容 | tpl-product | 淘宝商品详情 | ✅ | run `8f205215`（真实投料“手工陶瓷马克杯”，2026-09-01） | 全链路真实跑通：3×textGen + **双 imageGen 真实出图**（场景图 1.57MB / 配图 1.10MB PNG 1024×1024）+ gate 一次通过无 rework。发现并修复 🔴 **产物服务 bug**：生成媒体的 run 行只存 `up-…` 本地引用、自身桶无字节，`GET /api/artifacts/:id` 返 404 “blob missing on disk”（UI 破图，影响历史所有生图 run）→ 路由改为跟随引用（`c91f973`，含越权用例） |
| 营销内容 | tpl-xiaohongshu | 小红书种草笔记 | ✅ | run `904d6a05`（真实投料“日系复古帆布托特包”，2026-09-01） | 与 tpl-product 同构（3×textGen + 双 imageGen + gate），全链路真实跑通：双图 1024×1024 PNG（配图 1.29MB / 场景图 1.57MB）、gate 一次通过无 rework。**同时复验 `c91f973` 产物修复**：新生成图经 `GET /api/artifacts/:id` 直接 200 可取完整 PNG（旧数据需同样跟随引用，已生效）；gate 判定理由确认图片 URL 正确传递至排版环节。无新发现 |
| 营销内容 | tpl-batch-content | 批量内容工坊 | ✅ | run `03924415`（真实投 4 行清单，2026-09-01） | code 拆条→map→textGen 成稿→gate 全链路跑通：`split` 正确拆出 4 项、`map` 展开“映射 4 项”并逐项生成简报、`writer` **一次调用产出 4 篇成稿**（4 个标题均命中、尾段完整无截断；设计意图：成批成稿而非逐条跳 run，token 经济）。gate 一次通过无 rework。无新发现 |
| 营销内容 | tpl-review-publish | 人工审核发布 | ⬜ | — | human 审批 + error 边兜底场景 |
| 营销内容 | tpl-news-podcast | 资讯播客工坊 | 🟡 | 复验 run `b6ac0fee`（摘除 voice，代理已通）+ `d57a1b43`（同图），2026-09-01 | 首验 run `829d23af`/`c870fd4d` 发现的 4 条问题已全部修复并复验：① audioGen 静默吞 → 改 node.failed（`b6de7d9`）；② search 不可达 → 可行动报错 + `AGENT_WORLD_PROXY` 代理（`b82f89a`）；③ tts-1 modality 错配 → 派发期阻断（`7b7faf0`）；④ `template` 参数名已纠正文档。**剩余阻塞（非产品缺陷）**：DDG 反爬验证页（已改为响亮报错，不再静默 0 结果）→ 需配 TAVILY_API_KEY 等换源；agnes 无音频模型 → 需配 TTS 供应商才能出音频成品 |
| 数据分析 | tpl-ops-weekly | 运营周报 | ⬜ | — | http + code + 无数据兜底 |
| 数据分析 | tpl-research-brief | 多源研究简报 | ⬜ | — | parallel 汇聚场景 |
| 数据分析 | tpl-competitor-watch | 竞品监控摘要 | ⬜ | — | http + 拉取失败兜底 |
| 数据分析 | tpl-research-loop | 多课题深度调研 | ⬜ | — | loop + 多课题 |
| 数据分析 | tpl-data-report | 数据报表生成 | ⬜ | — | http + code + table |
| 写作 | tpl-draft | 写草稿 | ⬜ | — | 最简 textGen 链路 |
| 写作 | tpl-translation | 翻译流水线 | ⬜ | — | 专用 translate 节点 |
| 办公协同 | tpl-doc-review | 文档审查 | ⬜ | — | 基础 textGen + gate |
| 办公协同 | tpl-doc-ingest | 文档智能解析入库 | ✅ | 复验 run `b0f60b0b`（默认 tracemonkey PDF）/ `10eba2ef`（纯文本 PDF 走 error 边，2026-09-01）；缺陷现场 run `9c38a59b`/`a12c9a41`（进程被杀）/ `ab5b20df`（静默丢弃） | 一口气暴露 4 个产品缺陷。① 🔴 模板 `combine` 脚本在 TS 字符串里写了未转义的 `\n`，生成的 node 脚本在字符串字面量中间断行，子进程直接 SyntaxError（`86a513d`，并新增「全部模板 code 脚本必须可编译」守护）。② 🔴 脚本秒退时引擎还在向它的 stdin 管道灌输入，`write EPIPE` 无监听 → **未处理的 error 事件把整个 server 进程杀死**（每次跑该模板必崩，`b320f27`）。③ 🔴 调度器 fan-in 缺陷：`combine` 等 parse/ocr/ocrFallback 三路，ocr 失败被 error 边接住后 `predecessorsReady` 仍要求它 done → merge 永远不调度，**run 却报 done、无任何入库产物**（静默丢弃，`e6dc2c9`；另修 stranded pending 不得报 done）。④ 🟡 `AGENT_WORLD_PROXY` 开启时 `ALLOW_PRIVATE_NETWORK=1` 被代理分支无视，与文档承诺的「完全跳过内网检查」不符（`63bc1db`）。真实链路：拉 13 页 PDF → fileParse「84609 字符+10 图」→ ocr → combine → table「4 行×2 列」→ sink，首行摘录可对回论文标题（TraceMonkey）；纯文本 PDF：ocr 诚实报「没有可识别图片」→ error 边→兜底空串→ **merge 照常汇聚**→入库产物含夹具原文（`TEXT LAYER ONLY`） |
| 办公协同 | tpl-scan-ocr | 扫描件数字化 | ✅ | 复验 run `934474f3`/`f1a0237c`（真实上传 2 页扫描件 PDF，2026-09-01）；兜底分支 run `f92b24ae`；首验 run `7561d8d8` ❌ | **ocr 节点此前在生产里 100% 不可用**：`ocr.ts` 把 worker/core 钉在 tesseract.js **v5** 的 CDN URL 上，而 Node 侧 `worker_threads.Worker()` 直接拒绝 URL（`ERR_WORKER_PATH`），装的又是 v7 → 每个 ocr 节点必败；单测把 `ocrImage` 整个 mock 掉，所以全绿。修：不再注入默认 worker/core 路径，只透传显式覆盖（`5b71c9a`）。第二处 🔴：`convert`/`fileParse` 提取 PDF 内嵌图时把 pdfjs 的 3 通道样本直接喂给 pngjs（写 PNG 恒按 RGBA），**整张图像素错位、纵向压成 3/4**，OCR 只能出乱码 → 展开为不透明 RGBA 修复（`4215d9c`），修后产物字节数与源图一致、可读。第三处 🟡：`OcrConfig.langPath/workerPath/corePath` 是 `z.string().url()`，把文档与审计 M7③ 承诺的「本地路径离线部署」堵死 → 放宽为 `min(1)`，安全仍由运行期 `assertOcrSource` 白名单把关（`e2781ab`）。真实链路：上传扫描件 → convert「提取 2 张图片」→ ocr「132 字符/平均置信度 58%」→ sink 成品可对回夹具（`THUOICE 20:6 MO O0d42` ← `INVOICE 2026 NO 0042`）；纯文本 PDF 走 convert `ERR[VALIDATION] 文件中没有可提取的图片` → **error 边首次真实跑通** → textGen 给出改用建议 → sink → done。遗留（非缺陷）见 deferred：模板默认 `chi_sim+eng` 会把英文扫描件数字行识别成汉字；`convert` 名为逐页转图实为提取内嵌图；只支持 URL 投料 |
| 开发集成 | tpl-custom-model | 自定义模型接入 | ⬜ | — | http + code + vcs |
| 开发集成 | tpl-release-pr | 发版 PR 助手 | ⬜ | — | vcs 节点 |
| 开发集成 | tpl-code-review | 代码审查助手 | ⬜ | — | http + code + gate |
| 法律合规 | tpl-contract-review | 合同审查助手 | ✅ | 复验 run `084b6f63`（真实上传 PDF，2026-09-01）；首验 run `9b42e591` ❌ | 首验发现的 🔴 能力缺口已修：source 节点此前只能传图（`SourceImages.tsx` 过滤 `image/*`、engine 仅产 text/image），而 fileParse 只认 `kind==="file"` → 真实产品里根本无法投料。现：`SourceConfig.files` + source 产 file artifact（`2d3dfcf`）+ Inspector 文档上传区（`95c65a4`，不支持的类型/超 5MB 不静默丢弃）。复验全链路：上传 1.4KB 供货合同 PDF → fileParse「解析完成：750 字符文本」→ 条款提取 → 风险审查 → **gate 驳回一次后返工通过**（rework 边首次真实跑通）→ human 节点挂起 → `resume {action:"approve"}` → done，成品引用了 PDF 里的仲裁机构/验收期限/30% 定金。另：fileParse 读不到字节时的报错已带上 5MB 内联上限（`2d3dfcf`）。已知限制：多个文档只解析第一个，其余在摘要里点名未解析件数（`5cfd5bd`，已登记 deferred） |
| 法律合规 | tpl-evidence-brief | 证据清单整理 | ⬜ | — | code 拆条 + table 排序 |
| 财务审计 | tpl-expense-review | 费用报销初审 | ⬜ | — | code 规则校验 + table |
| IT 运维 | tpl-patrol-alert | 定时巡检告警 | ⬜ | — | cron 触发 + notify webhook（需填 webhookUrl 字段） |
| 客户服务 | tpl-customer-service | 客服工单自动处理 | ⬜ | — | branch + human + notify（需填 webhookUrl 字段） |
| 教育 | tpl-course-outline | 课程大纲生成 | ⬜ | — | 教育场景 textGen |
| 生活 | tpl-travel-plan | 旅游行程规划 | ⬜ | — | 生活场景 textGen |
| 生活 | tpl-recipe | 菜谱生成 | ⬜ | — | code 营养估算 |

> 空白产线入口（BLANK_TEMPLATE）不属业务模板，不进本表。
>
> **验证前置条件**（2026-09-01 狗粮总结）：含 `search` 节点的模板（research-brief / competitor-watch / news-podcast / research-loop 等）默认走 duckduckgo，**需要本机能直连或给 server 配置出站代理**（`AGENT_WORLD_PROXY`）；改用 tavily/serpapi/google 需对应环境变量（`TAVILY_API_KEY` 等）且重启 server。含 `audioGen` 的模板需要 provider 有音频模型（当前 agnes 无 TTS，需另配）。含 `fileParse` 且仍靠 source 投料的模板（contract-review）：在投料车间的「文档」区上传 PDF/DOCX/PPTX，**单件 ≤5MB**（上传口允许 25MB，但解析需整体内联读入）。含 `ocr` 的模板（scan-ocr / doc-ingest）：tesseract.js 自己拉语言包（`tessdata.projectnaptha.com`），**不走 `AGENT_WORLD_PROXY`**（那个只作用于 guardedFetch），本机需系统代理或直接把 `langPath` 指到本地目录；首次识别后 `<lang>.traineddata`（chi_sim 42MB）会落在 **server 进程 CWD**，已 gitignore，但目录权限不对时会直接报错。
>
> **当前进度（2026-09-01）**：真实狗粮验证 **8/27**——✅ 7（tpl-media-pipeline / tpl-product / tpl-xiaohongshu / tpl-batch-content / tpl-contract-review / tpl-scan-ocr / tpl-doc-ingest）+ 🟡 1（tpl-news-podcast，剩环境侧阻塞：需换搜索源 + 配 TTS 供应商） ；已跑出的发现已全部流转为修复并复验。其余 19 个⬜。
>
> 验证顺序建议：**已覆盖节点类型**（2026-09-01）textGen / imageGen（双图）/ code / map / gate+rework / **error 边兜底（含兜底后重新汇入主流程的 fan-in merge）** / fileParse（真实上传路径）/ **convert（PDF → 图片）** / **ocr（识别 + sink 汇总）** / **table（结构化入库）** / human 审批挂起与恢复 / sink 汇总；**尚未真实跑过**：vcs、loop、parallel、branch、notify 告警、translate、subprocess/database。**下一批建议**：tpl-release-pr（vcs，零覆盖风险面最大）→ tpl-review-publish（human + branch，与 contract-review 不同构）→ tpl-research-brief（parallel 汇聚，需搜索源）→ tpl-evidence-brief / tpl-expense-review（code+table 同族，刚修好的调度路径正好压测），再补纯 textGen 的简单场景。
