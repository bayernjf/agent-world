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
- ✅ **权限守卫**：provision/role/plan 端点均 `isOwner(callerId)` 校验（现位于 `routes/admin.ts`）；owner 单例不变量由 `idx_users_owner` 索引 + 显式拒绝自我降权保护。**⚠️ 该 ✅ 只在 SQLite 成立**——那个索引只由迁移 31 创建、不在 DDL 常量里，而 PG 建库只跑 `toPgDdl(DDL)` 从不跑迁移，见 §七-7.2。
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

> **⚠️ 本句作用域限定（2026-10-04 增量复核，见 §七）**：上面这句只覆盖**请求路径**上的注入 / 越权 / SSRF / 加密。同一轮复核在**运维工具与数据层**补出两条高危——`rotate-reencrypt` 的 fail-open 判定（§七-7.1，误操作可导致加密字段永久不可解）与「PG 上 owner 单例无 DB 约束」（§七-7.2，仅 SaaS 轨）。所以「无高危」不等于「可以上线」的前提清单已经清空。

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
3. **P2（架构）**：`index.ts`（4659 行）与 `sqlite-driver.ts`（4378 行）已达维护临界，建议按路由域（auth/run/graph/admin/billing）拆子 router、按驱动方法拆 driver helper，降低认知负载与回归风险（非紧急，当前测试门禁可兜底）。**✅ 已落地（2026-10-02）**：①`sqlite-driver.ts` 按驱动方法拆 5 个 helper 模块（schema/mappers/backup/cascade/driver-body，主文件 ≈93 行 + re-export），commit `32335aa`；②`index.ts` 按路由域拆 9 个 router（auth/graphs/runs/ops/admin/settings/feedback/announcements/billing）+ `shared.ts`/`ctx.ts`，组装版 1085 行，commit `dadcd58`。验证：server tsc 0 错、server 全量 1473 passed / 2 skipped、`pnpm -r typecheck` 四包绿。
4. **P3（技术债）**：`as` 断言在 `api.ts` 集中，建议逐步用 zod 推断替代；`M38` 的 `ConnectorConfig`/`GraphNode` 宽松 schema 维持现状（兼容性优先），持续依赖 compile 阶段兜底。**✅ 已落地（2026-10-02）**：新建 `safe-utils.ts`（errMsg/asRecord/errorStatus/isAbortError）与 `graph-snapshot.ts`（宽松持久化快照 schema），`api.ts`/`index.ts` 30 处、`isolation.ts` 6 处、`at-rest.ts` 7 处 `as` 断言清零，commit `385f402`（+vitest@5.0.1 devDep `dd39874`）。`M38` 的宽松 schema 维持现状（兼容性优先，compile 兜底）。

### 功能完整性
29 种节点 + Phase 4 编排 + Web/MCP/CLI 三端 + RBAC/审计/公告 + 商业化 M1-M3 + 双驱动持久化 + 36 模板，**功能面完整且自洽**。外部依赖卡点（agnes 付费 key / Stripe / TTS）为申请类事项，非代码缺陷。

---

## 七、增量复核（2026-10-04，基线 HEAD `6db6ea3`）——本报告未覆盖的 8 条

> **处置（同日）**：7.1–7.6 **已修**（commit 与逐条可伪验收见本节末「处置进度」）；7.7 是门禁取向问题、留给用户拍板；7.8 需要 Hasee 的 root（修法与验收读数已写进两份 runbook）。

> **方法**：本轮不接受任何扫掠结论。下面每条都由复核者自己打开文件重推；引用一律给**当前**文件名（§五 之后 `index.ts` 与 driver 已拆分，本报告正文里的旧行号失效）。取证方式逐条标注：**[实测]**＝命令跑出来的计数、**[读码]**＝打开了被引行、**[推断]**＝由前两者推导。

### 7.1 [高] `rotate-reencrypt` 的「旧密钥可以删了」判定 fail-open

`reencrypt()` 用 `new DatabaseSync(opts.dbFile)`（`key-rotation.ts:135`）建句柄——该构造**会静默创建缺失文件**；每个 surface 在表不存在时直接 `continue`（`:140-143`、`:187-191`）。CLI 侧默认值是 `DB_FILE ?? "agent-world.sqlite"`（`scripts/rotate-reencrypt.ts:24`），并在 residue 为 0 时打印 `no old-key ciphertext remains; the old key can be dropped from the keyring`（`:39-41`）且把 `process.exitCode = 0`（`:44-45`）。**[读码]**

⇒ 三种情形下它都给绿灯：路径打错、指向空库、以及 PG 部署（脚本恒开 SQLite）。运维照这句话删掉旧密钥，**加密字段永久不可解**，属不可逆数据损失。这正是本仓 09-25 已经为 `prune-events.ts` 修过的同一缺陷类（「静默建空库并报成功」）。
**修法**：接 `scripts/sqlite-ops-db.ts` 的 fail-loud 守卫；并在「一个 surface 都没扫到」或 `report.tables.length === 0` 时**报错退出**，而不是报「可删」。

### 7.2 [高，仅 PG 轨] §2.2 那条 ✅ 只在 SQLite 成立——PG 上 owner 单例没有任何 DB 约束

`idx_users_owner` 不在 DDL 常量里（`sqlite-schema.ts:44` 的注释明写「is NOT here on purpose」，理由是老库那时还没有 `role` 列），它只由**迁移 31** 创建（`sqlite-schema.ts:1020-1025`），`POST_MIGRATION_INDEXES` 也不含它（**[实测]** 该列表只有三条 stripe 索引）。而 `pg-driver.ts:50` 建库只执行 `toPgDdl(DDL)`、**从不跑迁移**；`createUser` 又是 check-then-insert（`driver-body.ts:459` 的注释仍自称「由该索引保护单 owner 不变量」）。
⇒ 全新 PG 库上**两个并发首注册可以都成为 owner**（root-of-trust 破口）。当前 staging 是 SQLite，所以不阻断上线，属 SaaS 前置。
**修法**：把该索引并入 DDL 常量（PG 侧由 `toPgDdl` 自动继承，SQLite 老库继续靠迁移 31），或把 `createUser` 改成单语句条件插入，让不变量不依赖「谁来跑迁移」。**[实测+读码]**

### 7.3 [中] 没有任何门禁执行过 PG 路径的一行

`ci.yml` 里没有 postgres 服务（**[实测]** grep `postgres|service|5432` 命中 0）；`pg-sql.test.ts` 只断言字符串翻译产物，`migrate-to-postgres.test.ts` 只 `dryRun`，`db-driver-switch.test.ts` 不开 PG。
⇒ `toPgDdl(DDL)` 若被真 PG 拒绝、或 7.2 这类缺失，**永远不会让 CI 变红**。本仓 09-08 做过 Docker postgres:16 手工演练（评审有记录），但没有固化成门禁——一次性演练挡不住后续回归。
**修法**：CI 加 `postgres:16` service + 一条「建库→跑关键 CRUD→比对行数」冒烟 job。

### 7.4 [中] server 侧运维脚本会「对着空气报成功」

`openDb` 是 `createSqliteDriver` 的别名（`db.ts:385`）＝**恒 SQLite**，不看 `DB_DRIVER`。而 `backfill-usage.ts:21`、`generate-invoices.ts:22`、`prune-demo-users.ts:22`、`migrate-to-postgres.ts:22` 都是 `process.env.DB_FILE ?? "agent-world.sqlite"`，**既无 `existsSync` 也无驱动拒绝**；`reset-password.ts` 有存在性守卫（`:45`）但同样不拒 PG。**[实测]**（默认值 grep + `sqlite-ops-db` 引用清单：root 两个脚本用了守卫，`packages/server/scripts/` 六个没用）
⇒ 路径打错就在空库上跑完并报 `created: 0` / `expired: 0`；PG 部署下它们读写的是**本地 SQLite 文件而真数据未动**，`reset-password` 会打印一个在生产里根本登不进去的口令。
**修法**：四个脚本各接一行 `sqlite-ops-db.ts`（仓内已有先例，成本极低）。

### 7.5 [中] `packages/server/scripts/*.ts` 不在任何 tsconfig 覆盖内

`packages/server/tsconfig.json:8` 的 include 只有 `src/**/*`；根 `tsconfig.scripts.json:15` 只有 `scripts/**/*.ts`。这些脚本经 `tsx` 调用，**不做类型检查**。**[实测]**
讽刺点：`tsconfig.scripts.json` 存在的唯一理由，正是「`migrate-down.ts` 曾带着不存在的 import 发布、从未跑得起来」——那次只把根 `scripts/` 圈进覆盖，没圈 server 包自己的。
**修法**：把 `packages/server/scripts/**/*.ts` 加进 server tsconfig 的 include。

### 7.6 [中低] 幂等只防「重试」，不防「并发」

`routes/runs.ts:238` 读映射、`:265` 写映射，与 `createRun` 是三条独立 autocommit。表确有 `PRIMARY KEY (user_id, key)`（`sqlite-schema.ts:450-456`），但写入是 `ON CONFLICT DO NOTHING`（`driver-body.ts:420`）——**[读码]**
⇒ 两个同键并发请求都会 miss 读、都创建 run，第二个不报错，只是它的 run 悄悄脱离了映射；结果是重复执行 + 重复计费，而幂等特性存在的理由恰好是防这个（崩溃窗口只是其中一种触发）。
**修法**：先 `INSERT ... ON CONFLICT DO NOTHING` 占位，只有 `changes === 1` 的一方继续创建 run，否则直接返回既有 run——把「谁拿到这把键」变成一次原子裁决。

### 7.7 [低] 项目没有 lint 门禁

无 eslint / biome / oxlint 配置，也无 `lint` 脚本；CI 步骤只有 install、audit、build、typecheck、i18n guard、test、E2E、secret scan。**[实测]**
需要说清楚的是：本仓用「自写守护测」守住了几条最要紧的约定（i18n key 双向一致、driver 裸 SQL 白名单、`drainRun` 源码扫描），这比通用 linter 更贴项目语义。代价是**凡没被编码成测试的规则一律无人守**——React hooks 依赖数组、未使用变量、`as`/`any` 增长、无障碍属性。
**修法**：不必换 linter；要么把想长期守的规则继续写成守护测，要么加一条最小 eslint（`react-hooks` + `no-unused-vars`）进 CI，二选一即可，但要知道当前是「零」。

### 7.8 [中] systemd 的 `Environment=` 会把密钥发给任何本地用户（本轮补出）

`docs/runbooks/deploy-ubuntu-server.md` 与 `docs/runbooks/public-exposure-hardening.md` 都要求凭据文件 600，但把 drop-in 写成 `Environment=AGNES_API_KEY=…` 时，600 守的是「谁能 open 那个文件」，**管不到 manager 在 D-Bus 上发布的 unit 属性**：`systemctl show -p Environment agent-world` 普通用户即可读取，返回的是 unit＋全部 drop-in 合并后的键值对原文。**[实测]**（2026-10-04 Hasee 只读复测；正控制是同一条读数里 `DB_FILE`/`CODE_SANDBOX` 一并出现，证明该属性确实可读全，而不是只读到片段）

后果：这台机器上任何低权账户（以及任何能以该用户身份跑 `systemctl` 的进程，包括被注入的脚本）都能直接拿到 provider key 明文。这条与 §七 其余各条不同——它不是「报成功」类，是**已发生的凭据可读面**，且本轮取证过程中那条 key 的值确实进入了终端输出，因此是否轮换归用户决定（泄露面是同机本地用户，不是远端；该 key 是 free-tier 单把）。
**修法**：凭据改走 `EnvironmentFile=`（root 600）或 `LoadCredential=` / `LoadCredentialEncrypted=`（凭据落在服务私有的 tmpfs，进程按 `$CREDENTIALS_DIRECTORY` 读）。**这两条都没在这台机上实测过**（无 root、也没建测试 unit），所以别把「换成了哪个指令」当验收——用可伪的那一条：改完 `systemctl show -p Environment agent-world | grep -c AGNES` 必须为 **0**。
**取证纪律（写进 runbook）**：读 unit env 时先过滤再打印（`| tr ' ' '\n' | grep -E '^(NODE_ENV|SECURE_COOKIES)='`），不要整条 `systemctl show` 倒出来。

---

### 处置进度（2026-10-04 同日，用户授权「做你自己能做的」后开工）

八条里 **6 条已修**，全部带可伪验收；剩下两条不是偷懒：7.7 是与「自写守护测」哲学冲突的取向决定（留给用户拍板），7.8 要 root（Hasee 上改 drop-in 写法，外加是否轮换 key 的决定）。

| 条 | 处置 | commit | 可伪的验收（都是实跑读数，不是「改了哪个指令」） |
| --- | --- | --- | --- |
| 7.1 | ✅ 已修 | `2b00ed7` | 缺文件即抛且**不留下那个文件**；一个 surface 都没扫到即抛；CLI 打印扫了几面。2 条新测各断言两件事；两处守卫分别 disable 后各自变红（其余全绿）；四次真机 CLI 跑：打错 DB_FILE → exit 1 无文件、空库 → exit 1 点名五面、外来 keyring → exit 1（诚实的 residue 判定）、本机 keyring 的 dev 库 → exit 0 且 `residue 0/0 (scanned 5 surface(s))` |
| 7.2 | ✅ 已修 | `d71d51f` | 真 postgres:16 容器**先复现后修**：修前 `users` 只有 `users_email_key`+`users_pkey`、两个并发 `createUser` 都拿到 role=owner、count=2；修后索引存在、第二个被 `idx_users_owner` 拒、owners=1 |
| 7.3 | ✅ 已加 | `e1268b9` | CI 新增 postgres job（postgres:16 service + `pg_isready` 健康闸）。**后果写进 commit**：deploy.yml 认 CI 总结论，所以这条 SaaS 轨的红现在会挡住 Hasee 自动部署（刻意如此，逃生口是重跑或标 continue-on-error，不是删门）。本地按 CI 同一条命令链跑通：`pnpm -r build` exit 0 → smoke 3 passed |
| 7.4 | ✅ 已修 | `804651a` | 五个运维 CLI 接 `resolveSqliteOpsFile`（migrate-to-postgres 只免驱动拒、仍要真实源文件）。8 次真机读数＋2 次正控制；守卫两处各自 disable 即对应测变红 |
| 7.5 | ✅ 已加 | `d59ddaf` | 新增 `packages/server/tsconfig.scripts.json` 并进 package typecheck 链。**当场回本两次**：我在 7.4 里写坏的 `apply` 行（TS2345）与新测试的隐式 any（TS7006）都是它先抓住的，后者是 pre-commit 钩子拦下的 |
| 7.6 | ✅ 已修 | `b6d66d7` | claim 变成第一动作（单条 `INSERT ... ON CONFLICT DO NOTHING` 裁决），输家拿 replay 200 或 409；失败释放 claim 保同键可重试；崩溃留下的 pending 满 15 分钟由后续同键接管。2 条新测；把 claim 跳过 → 并发测与重放测**都**红（返回两个不同 runId） |
| 7.7 | ⏸ 未动 | — | 见 §7.7 的取舍说明：本仓的门禁是自写守护测，加 eslint 是换哲学，该用户拍板 |
| 7.8 | ⛔ 要 root | — | 修法候选（`EnvironmentFile=` / `LoadCredential=`）与验收读数已写进 [deploy-ubuntu-server.md](runbooks/deploy-ubuntu-server.md) 与 [public-exposure-hardening.md](runbooks/public-exposure-hardening.md)：改完 `systemctl show -p Environment agent-world` 里 AGNES 的命中数必须为 0；两条候选都没在这台机上实测过，所以判据写成读数不写成指令 |

同日门禁读数（修后全量，非引用旧值）：本地 server **1488 passed / 5 skipped**（+1 文件 pg-smoke、幂等测 +2、pg-smoke 无 `PG_SMOKE_URL` 时 3 skip），另 2 条 `engine.code` 是本机 `python3` 被 Xcode license 挡住的环境红，改前改后同样红；`pnpm -r typecheck` 四包绿。**已 push**（`origin/feature/20260824` = `03e6545`），同 SHA 的 **CI runner 自报读数**：server **1490 passed / 5 skipped（172 文件）**——本机那两条 `engine.code` 在 runner 上 **18 测全绿**，坐实它们是本地环境红而非代码红；**新 postgres job 首跑 3 passed**（真 `postgres:16` service 容器）；E2E 5 passed；gitleaks 与 CodeQL 绿。**这批随后经 PR #486/#487 合入 dev（`96b969b`）**，Hasee 一手 `/api/health` 实测 `commit:"96b969b"`、`ok:true`——即六条修复已在这台生产（staging）机上生效；**同一次实测另查出两条生产配置缺口**：`/metrics` 从局域网另一台机器打过去 **HTTP 200 无鉴权**（`curl http://192.168.31.14:8791/metrics`，读得到 `runs_cost_usd_total` 等），且 systemd 的合并 env 里**没有 `ERROR_REPORT_WEBHOOK_URL`**（错误 sink 至今没有消费端）——两者都因 `NODE_ENV` 非 production 而**连启动 warn 都不会打**，正上是本审计报告反复处理的「静默」类。

---

### 7.9 对本报告自身的两处订正

- **§五 的两处「巨型文件需架构关注」已不成立**（10-02 的 `dadcd58` / `32335aa` 拆分）：**[实测]** `index.ts` 1084 行、`sqlite-driver.ts` 114 行（拆出 `driver-body.ts` 2754 + `sqlite-schema.ts` 1379 + mappers/backup/cascade）。复核者最初也按旧数字判为单体，引用前需重新定位。
- **§五 的测试基线已被超过**：当前 CI run 37184065595 自报 **3894 测 / 304 文件全绿**（core 346/24 · server 1481 含 2 跳过/170 · web 1996/107 · mcp 71/3），报告正文写的是 196 文件。
- **§三「当前无已确认的高危漏洞」需要限定作用域**：那句讲的是请求路径上的注入/越权/SSRF/加密；本轮在**运维工具与数据层**补出 7.1、7.2 两条高危，其中 7.1 在真实误操作下造成不可逆数据锁死。

---

> 本报告为增量审计，可与 `docs/code-audit-2026-09-06.md`（基线 77 项）、`docs/security-audit-2026-08-31.md`（29 项全修复）并读，构成完整审计链。
