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
| 节点市场（自定义节点） | 冷启动同上 + 更高成本（节点 SDK + 加载器 + 沙箱审查）；代码执行节点已兜底"临时需求" | 同模板市场，且代码节点兜底被证明不够用 | [roadmap-generalization.md Phase 5](roadmap-generalization.md#phase-5生态与平台化持续) |

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

### 安全/运维线

| 事项 | 缓做/低优原因 | 触发条件 | 决策详情 |
|---|---|---|---|
| 静态加密的重加密 / 密钥轮换工具 | 换 key 后存量 secrets 需迁移重加密；当前可用 encryptString/decryptString 手写一次性迁移，影响面小 | 出现真实换 key / 轮换需求（或合规要求密钥定期轮换） | [design-at-rest-encryption.md §5](design-at-rest-encryption.md) |
| Bitbucket/Gitea | vcs 节点同构可扩展，无紧迫需求 | 用户提出 | [integrations-future.md §5](integrations-future.md#5-bitbucket--gitea-等-vcs) |

### 文档线

| 事项 | 缓做/低优原因 | 触发条件 | 决策详情 |
|---|---|---|---|
| Skill 体系独立设计文档 | extending.md §3（操作指南）+ core `skill.ts` 头注释（设计声明）已完整覆盖；独立设计决策文档属锦上添花 | 外部贡献者/多人协作需要设计论证文档时 | [extending.md §3](extending.md) + `packages/core/src/skill.ts` |
| brand_terms（品牌术语库）设计文档 | 特性小（用户级术语 CRUD，服务内容产线），用途已在内容线专项规划中说明 | 术语库升级为产线强依赖（如自动注入 prompt / 按产线隔离）时 | [product-content-roadmap.md](product-content-roadmap.md) |

### 数据处理线

| 事项 | 缓做/低优原因 | 触发条件 | 决策详情 |
|---|---|---|---|
| Excel 读写 | 纯 JS 方案（SheetJS CE）功能裁剪；CSV + 代码节点可兜底 | 狗粮使用中出现 Excel 文件为主的输入源 | [roadmap-generalization.md Phase 2](roadmap-generalization.md#phase-2数据与文件处理2-3周) |
| HTML→PDF | 纯 JS 无中文排版方案；引入浏览器引擎（playwright）代价过大 | 中文排版需求出现且无法用「截图拼接/截图转 PDF」兜底 | 同上 |

## 已重启 / 已砍掉

（暂无——首建时全部挂起）
