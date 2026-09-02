# 缓做/低优事项登记表

> **单一事实源：挂起事项**。所有"讨论过、决策缓做/低优"的事项统一在此登记，每条必填**触发条件**。
> handoff.md 管"正在做"（活跃待办），本表管"挂着没做"。详细论证在各设计文档，本表只做索引与触发条件，不重复内容。
> 创建：2026-08-30

## 使用规则

- **新增**：任何缓做/低优决策（无论出自哪个设计文档或讨论）都必须在此登记一行，触发条件必填——没有明确触发条件的事项不该被缓做，应该要么做要么明确砍掉
- **重启**：触发条件满足时，把事项移入 handoff.md 待办，本表该行标注「已重启 YYYY-MM-DD」并保留（历史可查）
- **砍掉**：确认永不做的事项标注「已砍掉」+ 一句理由，不删行
- 表内排序按线的逻辑顺序，不代表优先级；重启优先级在移入 handoff 时再排

## 登记表

### 沙箱线

| 事项 | 缓做/低优原因 | 触发条件 | 决策详情 |
|---|---|---|---|
| docker/podman 容器后端 | 部署形态未定（单机 bwrap/sandbox-exec 已够用）；成本在外围不在接口（镜像生命周期/冷启动/安全审查）；容器网络与协作式代理衔接复杂 | 部署形态明确（多租户/云托管需要内核级隔离时） | [design-code-sandbox.md §11](design-code-sandbox.md#11-dockerpodman-容器后端待办低优决策记录) |
| net allowlist 在外部沙箱后端 | 协作式 HTTP 代理仅 rlimit 后端可用；bwrap/sandbox-exec 下诚实报 VALIDATION | 容器后端落地后由容器网络策略统一解决 | [design-code-sandbox.md §10](design-code-sandbox.md#10-net-allowlistssrf-校验代理已落地) |

### 编排线

| 事项 | 缓做/低优原因 | 触发条件 | 决策详情 |
|---|---|---|---|
| 状态机节点 | variables + branch 组合可兜底绝大多数场景；引入新执行语义，引擎/前端/测试复杂度齐涨，过度设计风险 | 兜底组合在真实产线中反复出现表达不了的流程语义 | [phase4-design.md §5](phase4-design.md#5-状态机缓做) |

### 模板/生态线

| 事项 | 缓做/低优原因 | 触发条件 | 决策详情 |
|---|---|---|---|
| 模板市场（用户发布/安装） | 冷启动死结（没内容没人用，没人用没内容）；需要审核/安全机制（用户模板可能带恶意配置）；TemplateField schema 已定型不会破坏性变更 | 多用户规模出现，有用户主动提出分享/安装诉求 | [design-templates.md §4](design-templates.md#4-p2-缓做决策记录用户发布安装模板真市场) |
| tpl-scan-ocr 投料口只认 URL | 上传能力已落在 source 节点（`2d3dfcf` + Inspector 文档区 `95c65a4`），但模板 fields 只暴露 `docUrl` → 狗粮时验“上传扫描件”必须手工改图把 source 接到 convert（graph `8e204023` 就是手改出来的）；要模板开箱支持上传，先得给 TemplateField 加 file 类型并定义实例化时的上传时序 | 下一个真实用户拿扫描件走 scan-ocr，手改图这步被证明不可接受；或 TemplateField 支持文件型字段时 | [template-checklist.md tpl-scan-ocr 行](template-checklist.md) |
| 节点市场（自定义节点） | 冷启动同上 + 更高成本（节点 SDK + 加载器 + 沙箱审查）；代码执行节点已兜底"临时需求" | 同模板市场，且代码节点兜底被证明不够用 | [roadmap-generalization.md Phase 5](roadmap-generalization.md#phase-5生态与平台化持续) |
| tpl-news-podcast / tpl-research-loop 的 happy path 复跑 | **纯凭证阻塞，产品侧无待修项**：search 默认 duckduckgo 返回反爬验证页（已改为响亮报错，三次重试 `9f700bdf`/`7bc85525`/`fe74e23a` 均诚实 PROVIDER_ERROR + loop 诚实上报循环体失败），agnes 无音频模型 → audioGen 拿不到真实 TTS。代价：**`search` 与 `audioGen` 两类节点至今从未真实成功产出过产物**（失败路径已验，成功路径零证据） | 拿到任一可用搜索源凭证（`TAVILY_API_KEY` / `SERPAPI_KEY` / google）或配上 TTS 供应商；两者各自独立解锁对应模板 | [template-checklist.md](template-checklist.md) 两行 🟡 + [handoff.md](../handoff.md) 待办第 2 条 |
| generic 节点的 image / video / audio 三种模态 | 全库仅 tpl-custom-model 用 generic 且是 text 模态（已真实跑通 `b91af1d3`）；三种媒体模态只有单元覆盖（诚实失败 + 缺能力 + error 边兜底，`5d76cc5`），没有真实产线用过 —— 专用 imageGen/videoGen 节点已真实出图出片，generic 媒体分支只是同一 worker 能力的另一条装配路径 | 出现真实使用 generic 媒体模态的产线（如用 generic 做「一个节点按模型自动选模态」的场景），或专用媒体节点与 generic 的行为出现分歧报告 | [technical-design.md 节点设计](technical-design.md) + `packages/server/src/engine.generic.test.ts` |

### 版本线

| 事项 | 缓做/低优原因 | 触发条件 | 决策详情 |
|---|---|---|---|
| 版本 diff 视图 | 恢复安全性已闭环（hash 标记 + 结构预览防盲恢复）；文本级 diff 是锦上添花，需要像样的 diff 组件才值得做 | 狗粮使用中真出现"必须逐字段对比两版本"的高频场景 | [design-versions.md §4](design-versions.md#4-p2-缓做决策记录) |
| A/B 测试 | **已落地**（2026-09-01 盘点确认：`ab.ts` + `/api/ab` + ABDialog/ABReport/RunCompare，用户隔离已覆盖）；本表原条目"单人自用无流量分流诉求"仅对**流量分流 / 统计显著性**仍成立 | 流量分流或多用户统计显著性诉求出现时重启扩展 | [design-ab-testing.md §4](design-ab-testing.md#4-边界与缓做) |

### 平台线

| 事项 | 缓做/低优原因 | 触发条件 | 决策详情 |
|---|---|---|---|
| 多租户/权限/团队协作 | 账号隔离（单用户边界）已落地；团队场景出现前做角色权限是空转 | 出现团队共用产线的真实需求 | [roadmap-generalization.md Phase 5](roadmap-generalization.md#phase-5生态与平台化持续) |
| 监控告警完整体系（指标/性能分析） | 失败告警 + rerun 闭环已有；指标大盘属于"有用户后再说" | 产线数量/运行频次大到人工看不过来 | 同上 |

### 集成线

| 事项 | 缓做/低优原因 | 触发条件 | 决策详情 |
|---|---|---|---|
| Notion | 需 OAuth 应用注册与审核；http 节点 + API token 可手工兜底 | 有产线高频使用 Notion 且手工 http 配置被证明太繁琐 | [integrations-future.md §1](integrations-future.md#1-notion) |
| Linear | 同 Notion | 同 Notion | [integrations-future.md §2](integrations-future.md#2-linear) |
| 邮件收件/附件 | 是触发器架构扩展（IMAP 轮询/webhook），不是 notify 的增量 | 有"收到邮件自动触发产线"的明确场景 | [integrations-future.md §3](integrations-future.md#3-邮件收件--附件) |
| 内容平台（小红书/抖音/淘宝） | 依赖商家 API 资质，走连接器市场不建原生节点 | 拿到平台 API 资质 | [integrations-future.md §4](integrations-future.md#4-内容平台小红书--抖音--淘宝) |
| `search` / `vcs` 节点没有节点级凭证入口 | 两类节点的 schema **完全没有凭证字段**（`SearchConfig` 只有 query/provider/maxResults/retry；`VcsConfig` 无），密钥只能走 server 进程环境变量：搜索 `TAVILY_API_KEY` / `SERPAPI_API_KEY` / `GOOGLE_API_KEY`+`GOOGLE_CX`（`search.ts` 的 `requireEnv`），vcs `GITHUB_TOKEN` / `GITLAB_TOKEN`（`vcs.ts:55/71`）——**而“节点自带凭证”在本项目已是既有范式**：imageGen/videoGen/audioGen 有 `baseUrl`+`apiKey`、notify 有 `webhookUrl`+`secret`、http 有 `headers`（狗粮 tpl-code-review 就是用节点级 `authorization: Bearer …` 拉私有仓 PR diff 的），search/vcs 是漏网。代价已实测：① 换搜索源必须改 env + **重启 server**（Inspector 里改不了），两条模板的 happy path 就卡在这里（见本表“news-podcast / research-loop”行）；② 多用户部署下所有人共用服务端一份搜索/VCS 凭证，而 provider 级 key 已能按用户存进加密 settings，节点级反而没入口；③ 一条产线里无法混用两个搜索账号或两个仓库凭证。缓做原因：单用户自用阶段 env 够用；且**不能简单往图 JSON 加明文 key 字段**——图会进版本快照与导出，得先把凭证走 `at-rest.ts` 的加密存储（settings 已有 per-user 加密先例，审计 L3），成本在脱敏链路而不是字段本身 | 出现第二个用户需要自带搜索/VCS 凭证；或一条产线需要混用多个搜索账号/多个仓库凭证；或“换搜索源不重启 server”成为运维诉求 | [template-checklist.md](template-checklist.md) 两行 🟡 + `packages/server/src/search.ts` `requireEnv` / `packages/server/src/vcs.ts:55,71` + [design-at-rest-encryption.md](design-at-rest-encryption.md) |

### 安全/运维线

| 事项 | 缓做/低优原因 | 触发条件 | 决策详情 |
|---|---|---|---|
| 静态加密的重加密 / 密钥轮换工具 | 换 key 后存量 secrets 需迁移重加密；当前可用 encryptString/decryptString 手写一次性迁移，影响面小 | 出现真实换 key / 轮换需求（或合规要求密钥定期轮换） | [design-at-rest-encryption.md §5](design-at-rest-encryption.md) |
| Bitbucket/Gitea | vcs 节点同构可扩展，无紧迫需求 | 用户提出 | [integrations-future.md §5](integrations-future.md#5-bitbucket--gitea-等-vcs) |
| 🔐 **节点级 `apiKey` 明文落库**（imageGen / videoGen / audioGen） | 审计 L3 的静态加密只盖了两类位置：`settings.data`（provider 级 key）与图文档里的 `triggers[].webhookSecret`（graphs.doc / graph_versions.snapshot / runs.snapshot 三处）——`sealGraphDoc` 实现上也就只 map 了 triggers。而三个媒体节点的配置支持节点级 `apiKey`（`ImageGenConfig`/`VideoGenConfig`/`AudioGenConfig`），**这个值今天以明文进 sqlite 的图 JSON、并随版本快照一起留存、也能随图导出被带走**（审计文档未将其列为待修项，属 L3 的漏网）。修法已有现成范式：把节点凭证字段纳入 `sealGraphDoc`/`openGraphDoc`（落盘前加密、读时透明解密，旧明文 lazy 迁移），或干脆改成引用 per-user 加密 settings 里的 provider 而不存副本。**之所以先登记而不直接改**：当前为单用户本机部署，且改动涉及三处快照读写路径 + 内容 hash 对比语义（加密不能破坏版本 diff），需单独一轮带回归的改动；**但若开多用户/对外部署，此项应先于上线处理** | 开多用户或对外部署（他人可读 DB / 备份 / 导出图）之前必须完成；或任何一次图导出/版本快照被带出本机的场景出现 | [security-audit-2026-08-31.md L3](security-audit-2026-08-31.md) + `packages/server/src/at-rest.ts` `sealGraphDoc`/`openGraphDoc` + [design-at-rest-encryption.md](design-at-rest-encryption.md) |

### 文档线

| 事项 | 缓做/低优原因 | 触发条件 | 决策详情 |
|---|---|---|---|
| Skill 体系独立设计文档 | extending.md §3（操作指南）+ core `skill.ts` 头注释（设计声明）已完整覆盖；独立设计决策文档属锦上添花 | 外部贡献者/多人协作需要设计论证文档时 | [extending.md §3](extending.md) + `packages/core/src/skill.ts` |
| brand_terms（品牌术语库）设计文档 | 特性小（用户级术语 CRUD，服务内容产线），用途已在内容线专项规划中说明 | 术语库升级为产线强依赖（如自动注入 prompt / 按产线隔离）时 | [product-content-roadmap.md](product-content-roadmap.md) |

### 数据处理线

| 事项 | 缓做/低优原因 | 触发条件 | 决策详情 |
|---|---|---|---|
| convert 只提取内嵌图，不逐页渲染 | 节点叫「逐页转图」但实现是 pdfjs 取 Image XObject：纯文本 PDF 诚实报错（已被 error 边兜底），而**含装饰图的文本 PDF 会绕过兜底**（狗粮验证时一份 tracemonkey 文本 PDF 提出 90 张碎片图，喂给 OCR 全是噪声）；真逐页渲染需原生 canvas 依赖（`@napi-rs/canvas` 类），引入成本与镜像体积都不小 | 狗粮/真实使用中出现“文本层 PDF 被当成图片走 OCR”导致结果明显变差，且需要确定性正确而非靠模板名提示 | [template-checklist.md tpl-scan-ocr 行](template-checklist.md) + [technical-design.md 节点设计](technical-design.md) |
| OCR 默认 `chi_sim+eng` 对纯英文扫描件注入 CJK 噪声 | 同一张图（graph `8e204023`）：`lang=eng` → `THUOICE 20:6 MO O0d42`（58%），模板默认 `chi_sim+eng` → `THUOICE 二 凹 已 “ 门 口 回 达 斗 不`（64%，数字行变汉字，置信度反而更高）。不是缺陷，是选型问题：改默认值会伤中文用户，自动判语言需先做启发式预处理（廉价但另属一个决策） | 真实用户以英文/多语扫描件为主，或“数字变汉字”这类反馈重复出现 | [template-checklist.md tpl-scan-ocr 行](template-checklist.md) |
| Inspector 只能填 `langPath`，worker/core 覆盖无入口 | schema 已能接本地路径（`e2781ab`），但 `Inspector.tsx` 的 ocr 区块只有一个语言包输入框 → 普通用户依旧改不了 worker/core（手写 graph JSON 可绕）；Node 下乱填 URL 还会把节点弄回 `ERR_WORKER_PATH`，多两个控件也是多两个坑 | 离线/内网部署真正开工（否则只是给用不上的旋钮加控件） | `apps/web/src/components/Inspector.tsx` ocr 区块 |
| tesseract 语言包落在 server CWD | 未传 `cachePath`，tesseract.js 按 `${cachePath || "."}/${lang}.traineddata` 写盘（chi_sim 42MB + eng 5MB）——本轮已先 `e77587a` gitignore 挡住误提交；真正修需要定数据目录约定（与 `artifacts/` 同一处）并处理只读 CWD | 部署形态确定（容器/只读工作目录），或 OCR 首次识别因写盘失败直接报错 | `packages/server/src/ocr.ts` 头注释 |
| Excel 读写 | 纯 JS 方案（SheetJS CE）功能裁剪；CSV + 代码节点可兜底 | 狗粮使用中出现 Excel 文件为主的输入源 | [roadmap-generalization.md Phase 2](roadmap-generalization.md#phase-2数据与文件处理2-3周) |
| fileParse 一次只解析一个文档 | source.files 可挂多份，但解析车间只读第一个（其余在节点摘要里点名未解析，不静默）；多文件可用多个解析车间或 http 节点兜底 | 狗粮中出现“一条产线同时审多份合同/文档”的真实诉求 | [technical-design.md 节点产物写入规则](technical-design.md) |
| HTML→PDF | 纯 JS 无中文排版方案；引入浏览器引擎（playwright）代价过大 | 中文排版需求出现且无法用「截图拼接/截图转 PDF」兜底 | 同上 |

## 已重启 / 已砍掉

（暂无——首建时全部挂起）
