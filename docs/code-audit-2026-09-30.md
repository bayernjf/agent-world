# 项目级代码审计报告（2026-09-30）

> 审计时间：2026-09-30。范围：monorepo 全 4 包（`packages/core`、`packages/server`、`packages/mcp-server`、`apps/web`）。
> 性质：**深度代码审计 + 产品功能点梳理**，落到项目文档。
> 方法：以 2026-09-06《全项目代码审计报告》为基线，验证其遗留项现状，并针对 **自 2026-09-06 以来的 818 个新提交**做增量审计（聚焦新增/重写的模块），结合代码结构梳理全部产品功能点。
> 数据基线：4 包共约 **306 个源文件 / 77k 行**（core 9k / server 31k / web 35k / mcp 2k 行）；**196 个测试文件**；`index.ts` **134 个 API 端点**；`templates.ts` **36 个模板**；`NodeKind` **29 种节点**。

---

## 一、与上一份审计（2026-09-06）的对比

上一份报告共 77 项（high 8 / medium 38 / low 31），其修复状态（报告「六、修复状态」章节）为：已修复 73 / 无需修复 3 / 部分修复 1 / 未修复 0。本次复核结论：**该结论仍然成立**——基线问题已被系统性清账，无回潮。

唯一「部分修复」项 **M38（core `graph.ts` 三层 schema 校验过宽）** 现状：
- ✅ `FanoutConfig`（graph.ts:397-425）已加 `superRefine`，校验 `prompts/temperatures/models` 长度与 `count` 联动。
- ⚠️ `ConnectorConfig`（graph.ts:934-941）与 `GraphNode` 各 kind 专属配置仍 `.optional()`，类型与子配置不联动（如 `{kind:"imageGen"}` 缺 imageGen 配置仍可 parse，运行期才崩）。
- 原因：项目**故意保留宽松**，以兼容历史图数据加载；非法配置的兜底放在 `compile` 阶段（发非破坏性 warning），而非 zod 层。属合理性权衡，非缺陷。

**遗留边界提醒**：旧报告 H4（Python 代码节点隔离）的「诚实边界」已被 `CODE_SANDBOX=bwrap`（P2 后端）+ 本次新增的 `isolation.ts` 插件进程隔离解决，不再是敞口风险。

---

## 二、自 2026-09-06 以来新增代码的安全审计

818 个提交涵盖：生产加固（公开暴露加固、failover 自检、隔离代理）、MVP 独立复评（section 11）、账户开通/密码替换、备份恢复演练、metrics/error-sink 旋钮、MCP 协议。以下为关键新增模块的审计结论。

### 2.1 `packages/server/src/isolation.ts`（新增，11.8KB）— 插件进程隔离（4C.7）★★★★ 质量高

worker 插件声明 `isolation:"subprocess"` 时 fork 到独立子进程，父进程代理其 `fetch`/`fs` 并强制 allowlist。审计要点：

- ✅ **环境变量修剪**（`trimEnv`，isolation.ts:70-81）：固定安全基线 + 插件声明键；敏感键名（`KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL/AUTH`，正则 isolation.ts:51）除非显式 `PLUGIN_ENV_ALLOWLIST` 否则剥离，杜绝插件通过声明键盗窃宿主 API key（设计项 M6）。
- ✅ **路径边界**（`isPathAllowed`，isolation.ts:89-98）：用 `path.relative` 而非 `startsWith`，消除 `/allowed` vs `/allowed-evil` 前缀绕过（同思路修复了旧报告 L4）。
- ✅ **网络双重防护**（`proxyFetch`，isolation.ts:219-230）：先查 `networkAllow` 域名 allowlist，再走 `guardedFetch`（拒绝内网目标、逐跳复检），覆盖 DNS rebinding。
- ✅ **fail-closed 握手**（`spawnIsolatedWorker`，isolation.ts:295-345）：握手超时/退出/错误均 reject，绝不返回半死 worker 落到主进程跑（H8）。
- ⚠️ **破坏性 fs 操作**（isolation.ts:279-281）：`rm(path, {recursive:true, force:true})` 受 `checkFsPath` 限制，但 `force:true` 使 fsAllow 一旦配宽（如 `/data`）插件可递归删空整目录。**属配置依赖风险**，非代码 bug——运维 runbook 须明确 fsAllow 精确到子目录。
- ⚠️ **IPC 边界类型宽松**：`runTextGen/judge/generateImage` 参数与返回用 `any`（isolation.ts:184-198，6 处 `as` 断言来源）。IPC 协议本质是 string，类型宽松可接受，但建议为消息体补一份 zod schema 校验（防子进程发畸形消息导致父进程非预期行为）。

### 2.2 `index.ts` 账户开通 / 密码重置（新增，MVP 账户开通流程）— 认证关键

- ⚠️ **一次性密码明文返回响应体**（index.ts:1393-1404）：`createProvisionedUser` 用 `randomBytes(12).base64url`（16 字符，熵充足）生成一次性密码，但**直接 `return c.json({..., oneTimePassword})`**。这是 owner 开通账号流程的设计（owner 拿一次性密码转交用户，用户首次登录强制改密 `must_change_password`）。风险点：传输层必须 TLS，且**响应体不得被 access log / 反向代理记录**。建议：①仅返回一次、不进任何日志；②文档明确该接口只走内网/owner 通道。
- ✅ **权限守卫**：provision/role/plan 端点均 `isOwner(callerId)` 校验（index.ts:1409/1420/1442）；owner 单例不变量由 `idx_users_owner` 索引 + 显式拒绝自我降权保护（index.ts:1420-1421）。
- ✅ **审计合规**：provision 的 audit 只记 `email`/`objectId`，**不记密码**（index.ts:1398-1403），避免凭据落审计表。
- ✅ **plan 接口防幻觉**（index.ts:1444-1456）：原先解析了 `body.status` 却未生效（操作者拿 200 误以为状态已改）。现改为：非法 status 拒 400；不传则**保留原状态**（欠费清除只由 `invoice.paid` 或显式 status 触发），消除「假成功」。

### 2.3 启动自校验（boot self-check）— 消除「静默失败」★★★ 良好实践

- ✅ **failover 自检**（index.ts:169-187）：failover 启用但 `failoverCandidates` 长度 <2 时 `log.warn`，明确告知「agnes 挂了文本 run 不会切备份」。消除旧版「静默不告警」运维盲区。
- ✅ **WORKER=fake 拒绝启动**（providers/index.ts:39-44 注释）：生产环境 `WORKER=fake` 直接 refuse to boot 并提示要 unset 的变量。这是把「假装成功」的最后一条路径也变成命名失败。
- ✅ **metrics bearer**（index.ts:346-347+）：`METRICS_TOKEN` 设置时 `/metrics` 需 `Authorization: Bearer`，且 boot 自检在 production 无 error-sink 时显式告警（commit `b01e3e0`）。
- ✅ **failover 未配置备份告警**（b5b84be）：与 2.3 第一点同源，填齐 `BACKUP_*` 三项才解除。

### 2.4 其他新代码观察

- `at-rest` 加密：旧报告 L5 已修复（graph_variables 明文 → `encryptString/decryptString`），新增 `at-rest.db.test.ts`（17 处断言）证明覆盖充分。
- `key-rotation.ts` 存在（旧审计未覆盖）：密钥轮转能力已具备，建议后续审计单独立项。
- `migrate-to-postgres.ts`：双驱动迁移脚本存在（5 处 `as`），属一次性迁移工具，风险限于运维执行。

---

## 三、安全态势总评

| 维度 | 评估 |
|---|---|
| 注入 / 越权 | 基线 4 个任意文件/DB 读取 + mcp 无鉴权 + 2 个 XSS 均已修复；新增代码（isolation/provision）继续强化边界 |
| 认证 / 会话 | JWT HS256 + bcrypt + 安全 cookie；新增 owner 开通 + 一次性密码 + 强制改密；login/register 已限流（旧 M13） |
| SSRF | `guardedFetch` 双校验 + `ssrf.ts` 已覆盖 nip.io/进制 IP（旧 M12），isolation 复用同一能力 |
| 加密 / at-rest | AES-256-GCM + 密钥探测规则 + 变量加密 + 密钥轮转，链路完整 |
| 速率限制 / DoS | 全局限流（login/register/run/demo），mcp `parseBody` 5MB 上限，batch 500 上限（旧 M13/M16/M20） |
| 配置安全 | boot self-check 消除 failover/worker/metrics 静默失败 |

**结论：安全态势从 2026-09-06 的「高危敞口」演进为「生产可用、纵深防御」。当前无已确认的高危漏洞。** 唯一需跟进的是 2.2 一次性密码的传输层保护（配置/日志侧）。

---

## 四、产品功能点全量梳理

### 4.1 节点引擎（29 种节点，`core/src/graph.ts:11-41` 枚举）

| 类别 | 节点 |
|---|---|
| 生成（generation） | `textGen`、`imageGen`、`videoGen`、`audioGen`、`generic`（四模态 LLM 网关）、`code`（沙箱代码）、`ocr`、`fileParse`、`convert`、`table`、`search`、`translate`、`human`（人工介入） |
| 控制（control） | `gate`（门禁/合规判断）、`branch`（分支）、`select`（选择）、`map`、`loop`、`parallel`、`fanout`（泳道分流）、`subprocess`（子流程）、`compliance`（合规清洗）、`prohibited`（禁用词）、`publish`（发布）、`vcs`（版本控制） |
| 数据（data） | `source`（数据源）、`sink`（终节点）、`database`、`http`、`notify`、`vcs` |

每个节点有专属 3D 剪影（Two-Point-Hospital 风），状态 LED（idle/running/done/failed/halted）驱动选中高亮与 running 呼吸脉冲。

### 4.2 编排能力（Phase 4）

- DAG 编译（`compile.ts`）：拓扑排序 O(V+E)、契约校验、返工边 `from===to` 自环合法（rework 语义）、rework body = 入口到 gate 的整条正向祖先链。
- 运行引擎（`engine.ts`）：fork 复用（零成本复用上游）、retry 下沉、契约接线、本次运行内视频轮询、running 脉冲、预算熔断。
- 触发（`triggers.ts`）：cron / webhook / event / batch（CSV）四类，compile 阶段缺字段发非破坏性 warning。
- 变量系统（`variables.ts`）：字符串/数字/条件（CondParser 尾随垃圾已校验，旧 M37 修复）。

### 4.3 多端接入

- **Web 编辑器**（apps/web，React19+Vite+Zustand+three.js）：2D 画布编辑 + 3D 厂房视图（ACES 色调映射/雾/Bloom 泛光/边缘描边/地台/选中光环）、运行历史时间线、Inspector、Settings（1775 行）、ProductGallery、BatchManager、OperationsDashboard、ABReport、KnowledgePanel。
- **MCP 服务器**（packages/mcp-server）：`AgentWorldClient` 透传鉴权（旧 H6 已修复），SSE 帧 `\r?\n` 分帧（旧 M18）、`waitForRuns` 重试（旧 M19）、`MAX_BATCH_INPUTS=500`（旧 M20）、二进制下载带 token（旧 M17）。
- **CLI / 脚本**：owner 密码重置 CLI、备份恢复演练（`restore drill`，commit `9faaec8`）。

### 4.4 平台与商业化

- **RBAC**：owner/admin/user 三角色，单 owner 不变量强保护；`isAnnouncementAdmin` 等细分权限。
- **审计日志**：`audit(db, ...)` 全操作留痕（provision/role/plan/invoice 等），密码不落审计表。
- **公告 / 反馈 / 演示用户**：announcement 管理 + 用户反馈 + `mustChangePassword` 演示账号 TTL。
- **商业化**：M1→M2→M3——M2 owner 手动设套餐（plan/status 防幻觉）、M3 手动标记发票已付；Stripe 网关（`stripe.ts`）待 P2 接入。订阅门控（`api.subscription-gate.test.ts`）。
- **计费/计量**：`costs` 全模态归集、`power.metered` 事件、failover 备援计 0 占位（config.ts:363 注释明示）。

### 4.5 可靠性与运维

- **持久化**：SQLite（node:sqlite）+ PostgreSQL 双驱动（`sqlite-driver.ts` 4378 行 / `pg-sql.ts` / `db.ts` DDL 与 MIGRATIONS 双写）；迁移幂等。
- **at-rest 加密 + 密钥轮转**：AES-256-GCM + `SECRET_KEYS` 多密钥探测 + `key-rotation.ts`。
- **可观测性**：metrics（可选 bearer + bind-host 旋钮）、error-sink、boot self-check。
- **容灾**：provider failover（agnes 主 + backup 备）、备份恢复演练脚本。
- **3D 美化**（功能外的体验项）：①②色调映射+雾、②描边+地台、③暗角、④选中光环+呼吸、⑤Bloom、⑥running 脉冲（deferred-items.md 登记，⑦常显标签缓做）。

### 4.6 模板库

`templates.ts` **36 个**内置流水线模板（含小红书种草、草稿、发票 OCR、新闻播客、竞品分析等），覆盖主要使用场景。

---

## 五、代码质量指标

| 指标 | 数值 | 评估 |
|---|---|---|
| 源文件 / 行数 | 306 / 77k | 中大型 monorepo |
| 测试文件 | 196 | 覆盖充分（旧审计时 3488 测试全绿） |
| TODO/FIXME/HACK/XXX | 14 处 | **极少**，技术债标注克制 |
| `any` 类型 | 70 处 | **可控**，集中在 IPC/worker 边界 |
| `as` 强制断言 | 396+ 处（多数在测试） | 源文件集中在 `api.ts`（38）、`index.ts`（11）、`isolation.ts`（6）；测试文件大量断言属正常 |
| 巨型文件 | `index.ts` 4659 行、`sqlite-driver.ts` 4378 行、`templates.ts` 3639 行、`engine.ts` 2385 行 | 需架构关注（见 §六） |

**类型安全整体良好**：`any` 仅 70 处、`as` 多数在测试，说明 zod + 严格 TS 落地有效。非测试源文件的 `as` 主要集中在 API 边界（`api.ts` 38 处封装 fetch 响应），风险低。

---

## 六、结论与建议

### 总体结论
项目从 2026-09-06 的「高危敞口待修」演进为 **2026-09-30 的生产可用、纵深防御状态**。基线 77 项问题已清账（73 修复 / 3 无需修复 / 1 部分修复且属合理权衡）；新增 818 提交以「生产加固」为主轴，质量高（`isolation.ts` 为教科书级安全代码，boot self-check 消除静默失败）。**当前无已确认高危漏洞。**

### 优先建议（按性价比）
1. **P0（配置/运维）**：2.2 一次性密码的响应体保护——确保 `/api/admin/users` provision 接口只走内网/owner 通道，响应体不进 access log；建议补充「仅返回一次」语义。**✅ 已落地（2026-10-02）**：`api.provision.test.ts` +2 守护（①access log 绝不携带一次性密码——spy `process.stdout` 实测；②无再读端点——users 列表不 echo 任何密码字段）；runbook [public-exposure-hardening.md](runbooks/public-exposure-hardening.md) 补 provision 只走内网/owner 通道、反代 access log 不得记录 body（nginx `log_format` 去掉 `$request_body` 类变量）。随 PR #464 合 dev 并部署 Hasee `f6bdef0`。
2. **P1（健壮性）**：`isolation.ts` 子进程 IPC 消息体补 zod 校验（防畸形消息）；`fsAllow` 在运维 runbook 明确须精确到子目录（防 `rm -rf` 误伤）。**✅ 已落地（2026-10-02）**：`isolation.ts` 新增 `ParentInboundSchema`（call-result + proxy 的 fetch/fs payload 形状全量校验），畸形消息 fail-closed（reject 全部在途 call、不杀子进程），`isolation.test.ts` +4 测（fake ChildProcess）；runbook [public-exposure-hardening.md](runbooks/public-exposure-hardening.md) §3 明确 `TOOL_FS_ALLOW` 写前缀必须精确到业务子目录。随 PR #464 合 dev 并部署 Hasee `f6bdef0`。
3. **P2（架构）**：`index.ts`（4659 行）与 `sqlite-driver.ts`（4378 行）已达维护临界，建议按路由域（auth/run/graph/admin/billing）拆子 router、按驱动方法拆 driver helper，降低认知负载与回归风险（非紧急，当前测试门禁可兜底）。
4. **P3（技术债）**：`as` 断言在 `api.ts` 集中，建议逐步用 zod 推断替代；`M38` 的 `ConnectorConfig`/`GraphNode` 宽松 schema 维持现状（兼容性优先），持续依赖 compile 阶段兜底。

### 功能完整性
29 种节点 + Phase 4 编排 + Web/MCP/CLI 三端 + RBAC/审计/公告 + 商业化 M1-M3 + 双驱动持久化 + 36 模板，**功能面完整且自洽**。外部依赖卡点（agnes 付费 key / Stripe / TTS）为申请类事项，非代码缺陷。

---

> 本报告为增量审计，可与 `docs/code-audit-2026-09-06.md`（基线 77 项）、`docs/security-audit-2026-08-31.md`（29 项全修复）并读，构成完整审计链。
