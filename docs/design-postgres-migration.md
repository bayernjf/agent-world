# PostgreSQL 迁移设计（主库 SQLite → PostgreSQL）

> 状态：**设计定稿（2026-09-08）；「抽接口 + 异步化」「PgDriver」「DB_DRIVER 开关」「搬迁脚本」均已落地 2026-09-08**——步骤 0（定义 `DatabaseDriver` 异步接口）✅，步骤 1（新建 `sqlite-driver.ts` 搬入实现 + 137 方法包 async + `openDb` 变工厂返回 `SqliteDriver`）✅，步骤 2/3（8 业务模块 + 传染到的 `config`/`triggers`/`providers`/`engine`/`memory`/`skills` + 30+ 测试文件逐点 `await`）✅，步骤 4（全量验证）✅；**阶段 2 占位符转换层 ✅ 2026-09-08**（`pg-sql.ts` 的 `?→$n` 转换 + `toPgDdl` 类型映射 + 方言参数化 strftime/LIKE/PRAGMA + `pg-driver.ts`）；**阶段 3（`DB_DRIVER` 开关）✅ 2026-09-08**（`openDatabase()` 分派 + `index.ts` 接线 + FTS 知识库诚实降级 + 5 例守护测试）；**搬迁脚本 ✅ 2026-09-08**（§6.1 方案 A：`migrate-to-postgres.ts`，dry-run/verify-only/快照+行数校验，并修复 DDL 缺 4 表的契约缺口）。**剩余：真实 PG 实例上的端到端搬迁演练 + §8 验收（触发条件：进入 SaaS 阶段，M3 之后）**。
> 本文是「agent-world 主库从 SQLite 迁到 PostgreSQL」的单一事实源。
> 注意区分：本文讲**主库存储后端**；「database connector 的 PG 驱动」（产线读外部 PG，2026-09-08 已落地）是另一回事，见 [design-connector-database.md](design-connector-database.md)。
> 关联：design-scaling.md §2.1（迁移触发条件 + 托管选型）、tech-stack-assessment.md（薄层抽象）、production-ops.md §4（演进路线）。

---

## 1. 背景与目标

### 1.1 为什么迁

| 形态 | 存储后端 | 理由 |
|---|---|---|
| 形态 A（客户自托管） | **SQLite 长期够用**，不迁 | 单用户、数据量有限、零运维 |
| 形态 B（官方 SaaS） | **必须迁 PG** | 多租户 + 并发写 + 连接池 + 水平扩展 |

触发条件：**进入 SaaS 阶段（自托管跑通后）**。此前不迁。

### 1.2 迁移原则

1. **双驱动保留**：迁 PG 后仍保留 SQLite 驱动，供自托管客户 + 本地 dev 使用。PG 只服务于 SaaS 形态。
2. **薄层替换，不重写业务逻辑**：`stmts` 对象的 prepared statements 已集中一处，迁 PG = 换 driver 实现 + SQL 方言适配，业务逻辑零改动。注意：「不重写」指业务逻辑，**异步化改造（§5.3 阶段 1）是量大的机械活**——137 方法 + 全部调用点加 `await`，是当初 tech-stack-assessment「替换实现」判断未计入的额外成本（**已于 2026-09-08 完成**）。
3. **事件流先治标**：`events` 表是数据量增长第一来源，策略是「热库 + 冷归档」（老的按 run 归档到对象存储），不靠迁 PG 解决单表膨胀。

---

## 2. 托管形态选型（收拢 design-scaling.md §2.1）

- **形态 A（客户自托管）**：用**自托管 PG**（docker / 系统包），与 SQLite 运维形态一脉相承，官方不碰数据。
- **形态 B（官方 SaaS）**：用**托管 PG**，但**不选 Supabase**，理由：
  1. Supabase 的核心价值是「PG + Auth + Realtime + 对象存储」全家桶，而 agent-world 这几样都有自研实现——Auth 是自建 JWT（users 表 + JWT/HttpOnly cookie）、对象存储是自建 artifact-store、实时推送用 SSE 流式；
  2. agent-world 是「少量长任务」型负载（瓶颈是 AI 成本而非 QPS），Realtime 实时订阅用不上；
  3. 需要的是裸 PG，Supabase 附加能力全部重叠、纯属浪费。
- 结论：形态 B 倾向**裸托管 PG**（Neon / RDS / Cloud SQL，只买数据库）。**暂不锁定具体厂商**——实施时再定。

---

## 3. 现状盘点（代码事实，2026-09-08 勘察）

| 维度 | 现状 |
|---|---|
| 文件 | ~~`packages/server/src/db.ts` 3894 行~~ → **已拆分（2026-09-08）：`db.ts` 204 行（类型 + 工厂 + re-export）+ `sqlite-driver.ts` 3753 行（SqliteDriver 实现）** |
| 表数量 | **30+ 张**（DDL 常量 + 迁移增量） |
| prepared statements | **136 个** `db.prepare(...)` |
| 占位符 | `?`（node:sqlite 风格），**530 行 SQL 含 `?`** |
| 驱动 | `node:sqlite` 的 `DatabaseSync`（**同步 API**） |
| 访问抽象 | `stmts` 对象集中所有 prepared statements（薄层，但无 driver 接口） |
| 迁移机制 | `MIGRATIONS` 数组（`version` + `description` + `detect` + `up` + `down?`），内联 TS，无独立 .sql 文件 |
| 时间存储 | 混用：`INTEGER`（unix epoch 毫秒，如 `started_at`/`created_at`）+ `TEXT`（ISO 8601，如 `users.created_at`） |
| 主键 | 全 `TEXT`（业务生成 id，非自增） |

### 3.1 SQLite 方言使用点（迁 PG 需适配）

| 方言 | 用途 | 位置 |
|---|---|---|
| `strftime('%Y-%m-%dT%H:%M:%SZ','now')` | 默认时间戳 | DDL + 迁移 14 |
| `strftime('%Y-W%W', ...,'unixepoch','localtime')` | 周聚合 | 成本统计 |
| `strftime('%Y-%m', ...,'unixepoch','localtime')` | 月聚合 | 成本统计 |
| `PRAGMA journal_mode = WAL` / `PRAGMA busy_timeout` | 并发/锁超时 | `openDb` |
| `VACUUM INTO '...'` | 迁移前备份 | `backupDatabase` |
| `ON CONFLICT(...) DO UPDATE/NOTHING` | UPSERT | 多处（PG 9.5+ 语法兼容） |

---

## 4. SQLite → PostgreSQL 差异清单（核心）

| # | 维度 | SQLite | PostgreSQL | 迁移动作 | 影响面 |
|---|---|---|---|---|---|
| 1 | 占位符 | `?` | `$1, $2, ...` | 改写（或驱动层自动转换） | **136 处**（最大工作量） |
| 2 | 驱动模型 | 同步 `DatabaseSync` | 异步 `pg` | 访问层异步化 | 全 `stmts` 调用点 |
| 3 | 时间函数 | `strftime` | `to_char` / `date_trunc` / `extract` | 改写 | 3 处 |
| 4 | 默认时间戳 | `DEFAULT(strftime(...))` | `DEFAULT now()` | 改写 DDL | 2 处 |
| 5 | PRAGMA | `journal_mode` / `busy_timeout` | 无（WAL 内置） | 删除 | 2 处 |
| 6 | 备份 | `VACUUM INTO` | `pg_dump` / `COPY` | 换备份实现 | 1 处 |
| 7 | UPSERT | `ON CONFLICT ... DO UPDATE` | 同（PG 9.5+） | 基本兼容 | 0（微调） |
| 8 | 类型映射 | `TEXT` / `INTEGER` / `REAL` | `text` / `bigint` / `double precision` | DDL 类型映射 | 30+ 表 |
| 9 | 布尔 | 无布尔列（状态用 TEXT 枚举、计数用 INTEGER，勘察确认） | 无需 | 无 | 0 |
| 10 | 主键自增 | 无（全 TEXT 主键） | 无需 | 无 | 0 |
| 11 | 事务 | `BEGIN/COMMIT`（同步） | 同（异步） | 包装异步事务 | 少量 |
| 12 | LIKE 大小写 | 默认不敏感（ASCII） | 默认敏感 | 改 `ILIKE` | 1 处（products 搜索 `name/brand/sku LIKE`） |

### 4.1 占位符转换策略（影响面最大）

136 处 `?` 占位符，**不手改**，用两条路线之一：

- **路线 A（推荐）**：驱动层统一转换——`PgDriver` 在 `prepare` 时把 `?` 按序替换成 `$1, $2, ...`，业务 SQL 保持 `?` 不变。零业务改动，成本最低。
- **路线 B**：逐条改写 136 处 SQL。工作量大、易错，不推荐。

> 选路线 A 的前提：所有 `?` 都是**按序、无命名参数**（勘察确认：是）。若有 `?` 用于 `LIMIT ?` 等，PG 同样支持 `LIMIT $n`。
>
> **转换器必须跳过字符串字面量**（`'...'` 引号内的 `?` 不转），不能裸 replace——当前 136 处 SQL 全参数化、模板里无 `?` 字面量，但转换器做成「跳过引号内字符」的 mini-tokenizer（约 20 行）才能对未来新增 SQL 也安全。

### 4.2 时间戳语义

- `INTEGER` 毫秒时间戳：PG 用 `bigint`，读写无转换（值不变）。
- `TEXT` ISO 8601：PG 用 `timestamp with time zone` 或保持 `text`。**推荐保持 `text`**（避免时区语义迁移，改动最小），只在需要范围查询时再加 `timestamptz` 生成列。

---

## 5. 访问层改造方案（双驱动）

### 5.1 现状问题

`db.ts` 直接 `new DatabaseSync(file)` + 同步 `stmts` 对象，**没有 driver 接口**，且**同步 API 阻塞事件循环**（SQLite 本地快，可接受；但 PG 是网络库，必须异步）。

### 5.2 目标架构

```
                     ┌─────────────────────────┐
业务层（index.ts/run.ts/...）│  只调 db.xxx() 方法       │
                     └────────────┬────────────┘
                                  ▼
                    ┌─────────────────────────┐
                    │   DatabaseDriver 接口    │  ← 新增，异步
                    │  (async 全部方法)         │
                    └────────────┬────────────┘
              ┌──────────────────┴──────────────────┐
              ▼                                      ▼
   ┌──────────────────────┐            ┌──────────────────────┐
   │   SqliteDriver        │            │   PgDriver            │
   │  node:sqlite（同步包装）│            │  pg（异步）           │
   │  自托管/本地 dev       │            │  SaaS 形态            │
   └──────────────────────┘            └──────────────────────┘
```

### 5.3 改造步骤（分三阶段）

| 阶段 | 内容 | 风险 |
|---|---|---|
| **阶段 1：抽接口（不换驱动）** ✅ 2026-09-08 | 把 `stmts` 对象的 137 个方法抽成 `DatabaseDriver` 接口，`SqliteDriver` 实现之（同步逻辑包成 async，行为不变）。**已落地**：`sqlite-driver.ts` + 137 方法 async + 业务/测试全量 `await`，912/912 绿 | 低（纯重构，SQLite 行为零变化） |
| **阶段 2：占位符转换层** ✅ 2026-09-08 | `PgDriver` 内实现 `? → $n` 转换 + 方言改写（strftime→to_char 等）。**已落地**：`pg-sql.ts`（`toPgPlaceholders` mini-tokenizer + `toPgDdl` 类型映射）、执行器抽象（`Executor` + `createDriver` 共享 137 方法）、方言参数化（strftime 周/月聚合→to_char、LIKE→ILIKE、PRAGMA integrity_check）、`pg-driver.ts`（`createPgDriver` + `createPgExecutor`）。server 919/919 绿 | 中（SQL 方言） |
| **阶段 3：接入 + 切换开关** ✅ 2026-09-08 | `DB_DRIVER=sqlite\|postgres` 环境变量选择驱动，启动时初始化对应 driver。**已落地**：`db.ts` 的 `openDatabase()` 分派工厂（默认/空值=sqlite；未知值 fail-closed；PG 连接配置 `DATABASE_URL` 或 `PG_HOST`+`PG_DATABASE`+可选 `PG_PORT/PG_USER/PG_PASSWORD/PG_SSL`）+ `index.ts` 启动接线 + driver 暴露 `kind` 标识。**边界（诚实降级）**：知识库 FTS5 为 SQLite 专属——PG 下 `SQLiteMemoryBackend` 换 `NoopMemoryBackend`（空结果 + 启动警告）；`backfillExistingData`（旧库补 owner）仅 sqlite 路径执行；`key-rotation.ts` 仍 SQLite-only。测试 `db-driver-switch.test.ts` 5 例守护（默认值/显式 sqlite/未知值拒绝/缺连接配置 fail-closed/kind 暴露） | 低 |
| **数据搬迁脚本** ✅ 2026-09-08 | §6.1 方案 A **已落地**：`src/migrate-to-postgres.ts` + `scripts/migrate-to-postgres.ts` CLI（`pnpm --filter @agent-world/server migrate:postgres`）。执行 `VACUUM INTO` 快照（回滚底本）→ `toPgDdl(DDL)` 建 PG schema → 逐表流式批量 INSERT（`$n` 参数化，200 行/批）→ 行数对齐校验（不一致非零退出）；`--dry-run` 无 PG 连接打计划；`--verify-only` 只比对。**落地时发现并修复 DDL 契约缺口**：`resource_access`/`subscriptions`/`usage_ledger`/`idempotency_keys` 4 张表只在迁移 32-35 里建、DDL 常量缺失——fresh PG 库会缺表；已补进 DDL（迁移保留，`detect` 基线自动跳过）。**与 §6.3 的偏差**：不生成中间 `.sql` 文件，改为直接流式导入（少一次大文件落盘/重放，review 需求由 `--dry-run` 计划输出满足）。`schema_migrations`（SQLite 迁移记账）与 FTS 表跳过并在报告中标注。真实 PG 实例上的端到端搬迁+§8 验收仍待 SaaS 阶段触发 | 中 |

> 关键难点是**阶段 1 的异步化**：`db.ts` 的 136 个方法目前是同步的，所有调用点（index.ts / run.ts / 各 node 等）都假设同步返回。异步化要逐调用点 `await`，是**纯机械但量大**的活（不是重写逻辑）。这与 tech-stack-assessment.md 的判断一致——「替换实现，不是重写」。

---

## 6. 数据迁移方案

### 6.1 搬迁工具

**不手写 30+ 张表的迁移 SQL**（易错）。脚本为主 + 工具为辅：

| 方案 | 工具 | 适用 |
|---|---|---|
| **A（主）** | 自写 `scripts/migrate-to-postgres.ts`：读 SQLite → 按 §4 差异清单生成 PG 兼容 dump → `pg` COPY 导入 | 精确控制类型映射 + 静态加密字段校验 + 时间戳语义 |
| B（辅） | `pgloader` | 原型快速验证（注意：其 SQLite 支持为 experimental） |

**以 A 为主**：项目有 pgloader 覆盖不了的定制（静态加密字段搬迁后须可解密、时间戳 INTEGER/TEXT 混存语义），自写脚本可控性更高；pgloader 仅用于快速原型验证全量搬迁的可行性，不作为生产路径。

### 6.2 搬迁流程（形态 B SaaS 上线时）

```
1. 停写（切维护态，暂停 run 创建）
2. 自写 `migrate-to-postgres.ts` 全量搬迁 SQLite → PG（含类型映射）
3. 搬迁后修正脚本（如有定制：静态加密字段校验、时间戳语义、布尔列转换）
4. 校验：表行数对齐 + 抽样字段比对 + 静态加密字段可解密
5. 切 DB_DRIVER=postgres，灰度 → 全量
6. 保留 SQLite 原库 N 天作为回滚底本
```

### 6.3 迁移 SQL 命名规则（方案 A 自写脚本的中间产物）

这些 `.sql` 是**方案 A 自写脚本生成/消费的中间产物**（可 review、可幂等重放），不是手写交付物：

```
scripts/migrate-to-postgres/
  01-schema.sql          # PG 方言建表 DDL（由 §4 差异清单生成，非手写）
  02-data.sql            # 数据 INSERT/COPY（由 SQLite dump 转换生成）
  03-post-fix.sql        # 搬迁后修正（加密字段/时间戳/布尔）
  04-verify.sql          # 行数对齐 + 抽样校验
```

> 命名：`NN-<动词>-<对象>.sql`，NN 两位序号按执行顺序递增；**全部由脚本生成**，不手写（手写 30+ 表易错）。执行幂等（`IF NOT EXISTS` / 可重入）。

---

## 7. 回滚方案

| 场景 | 回滚动作 |
|---|---|
| 搬迁失败 | SQLite 原库未动，`DB_DRIVER` 切回 `sqlite` 即可，零数据损失 |
| PG 运行中故障 | 若 SQLite 已停写，需从「最后一次 SQLite 快照」恢复；故**搬迁前必须 `VACUUM INTO` 快照**（现有 `backupDatabase` 已做） |
| 双写过渡（可选） | 过渡期 SQLite 只读 + PG 读写，回滚 = 切回 SQLite |

> 关键：搬迁是**单向**的（SQLite → PG），回滚靠「搬迁前的 SQLite 快照」+ `DB_DRIVER` 开关，不设计 PG → SQLite 反向回迁。

---

## 8. 验收标准（实施时执行）

1. **行数对齐**：30+ 表每张表 `COUNT(*)` SQLite vs PG 一致。
2. **抽样比对**：关键表（graphs/runs/events/artifacts/users/settings）抽样字段逐字节一致。
3. **静态加密**：`settings`/`graph doc` 等加密字段在 PG 中仍可 `decryptString`/`openDocString` 解密。
4. **全量测试**：`DB_DRIVER=postgres` 下 server 912+ 用例全绿（测试套件对 PG 可跑，或保留 SQLite 跑测试 + 单独 PG 冒烟）。
5. **性能**：关键查询（`/api/runs` 列表、`/api/graphs/:id`、成本聚合）延迟不劣于 SQLite。
6. **双驱动共存**：`DB_DRIVER=sqlite`（自托管）与 `postgres`（SaaS）切换后功能等价。

---

## 9. 风险与边界

| 风险 | 说明 | 缓解 |
|---|---|---|
| 异步化改造量大 | 136 方法 + 所有调用点 `await` | 阶段 1 纯重构，分步提交 + 全量测试守护 |
| 时间戳语义 | SQLite `TEXT` ISO vs PG `timestamptz` 时区差异 | 保持 `text` 存储，不引时区语义 |
| 静态加密字段 | 搬迁后密文必须可解 | 搬迁后校验 + 密钥轮换工具复用 |
| 方言遗漏 | `strftime` 等藏在冷路径 | 阶段 2 全量 grep 方言清单，逐条改写 |
| 事务语义 | SQLite 同步事务 vs PG 异步事务 | 包装异步事务 helper，行为对齐 |

**明确不做（边界）**：
- 不做 PG → SQLite 反向回迁。
- 不做分库分表（数据量到不了，先靠 events 冷归档）。
- 不做读写分离（SaaS 初期单 PG 实例够）。
- 不迁「database connector 读外部库」的能力（那已是独立功能，与主库无关）。

---

## 10. 落地施工方案（第一步：抽接口 + 异步化）

> 本节是「施工图」，对应 §5.3 阶段 1。目标：不换驱动，把「同步 SQLite 直连」重构成「异步 `DatabaseDriver` 接口 + `SqliteDriver` 实现」，为 PgDriver 铺路。**本步不碰 PostgreSQL、不改业务逻辑、SQLite 行为零变化。**

### 10.1 改造范围盘点（2026-09-08 勘察）

| 范围 | 现状 |
|---|---|
| 核心文件 | `db.ts` 3894 行，`export type Db = ReturnType<typeof openDb>`（结构推导） |
| 底层 | 136 个 `db.prepare(...)` 集中在一个 `stmts` 对象 |
| 业务模块 | 8 个：`index.ts`（全局单例 `const db = openDb(...)`）、`run.ts`、`reviews.ts`、`artifact-reader.ts`、`ab.ts`、`batch.ts`、`rbac.ts`、`memory.ts`（用自定义 `MinimalDb`，非 `Db`） |
| 测试文件 | 30+ 个直接 `openDb(...)` |

> **好消息**：`db` 对象通过 `import type { Db }` 作为参数注入（非全局 import 单例），说明访问层已是「注入式」，抽接口相对干净。唯一的生产创建点是 `index.ts:78`。

### 10.2 分步施工（每步可独立提交 + 独立回滚）

| 步 | 内容 | 改动面 | 验收 | 风险 |
|---|---|---|---|---|
| **0. 定接口** ✅ | 已定义 `DatabaseDriver`（映射类型从 `Db` 推导，137 方法返回值包 `Promise`，零手写成本） | 仅 `db.ts` 类型层 | typecheck 干净 | 零 |
| **1. SqliteDriver** ✅ | 新建 `sqlite-driver.ts` 并搬入实现（`DDL`/`MIGRATIONS`/`stmts`/`openDb`→`createSqliteDriver`/备份/回填/`mapXxx` 辅助）；`db.ts` 瘦身为「类型（`Db`/`DatabaseDriver`/`SqliteDriver`/行形状接口）+ 工厂 + re-export」；137 方法包 async | `db.ts` + `sqlite-driver.ts` | typecheck 干净 | 低 |
| **2. 业务模块 await** ✅ | 8 业务模块 + 传染到的 `config`/`triggers`/`providers`/`feature-flags`/`engine`/`memory`/`skills` 逐个 `await`；`loadConfig`/`saveConfig`/`loadSubgraph`/`TriggerGraphStore`/`SettingsStore`/`MemoryBackend` 等薄接口同步→异步 | 15+ 文件 | 每模块改完 typecheck 绿 | 中 |
| **3. 测试适配** ✅ | 30+ 测试文件 `openDb` 后调用改 `await`（含 `reviewsMod.*`/`idOf`/`reopened` 等非 `db` 变量名与自定义 async 辅助函数） | 30+ 测试文件 | 全量测试绿 | 中 |
| **4. 全量验证** ✅ | `pnpm -r typecheck` + server 全量测试 | — | 912/912 用例全绿 | — |

> **步骤 1 的过渡策略**（关键，避免「一改全崩」）：不要一步把 `Db` 方法全变 async 再改所有调用点。正确顺序是——先让 `DatabaseDriver` 接口方法全 async，`SqliteDriver` 内部同步实现包 async，然后**分模块**逐批把调用点 `await`。每改完一个模块跑一次测试，绿了再下一个。这样任何一步出问题都能立刻定位到「刚改的模块」。

### 10.3 工作量估算

| 步骤 | 量级 | 备注 |
|---|---|---|
| 0 定接口 | 小（纯类型，但 136 方法签名要写全） | 可先用「接口从 `ReturnType` 自动推导」偷懒，再逐步显式化 |
| 1 SqliteDriver | 中 | 机械搬迁 + 包 async |
| 2 业务模块 await | 中（8 文件，`run.ts` 调用点最密） | 逐模块，每模块独立提交 |
| 3 测试适配 | 大（30+ 文件，最机械） | 可用 IDE/脚本辅助定位同步调用点 |
| 4 全量验证 | 小 | 跑测试 |

> 总体：**纯机械、无逻辑重写**，但有「量大 + 容易漏 await」两个坑。预估是「半天到一天的体力活」，不是「难活」。（**2026-09-08 已实际完成**，1-4 步 + 全量绿，未新建独立提交的拆分——见 §10.2）

### 10.4 风险与回滚

| 风险 | 缓解 |
|---|---|
| 漏 `await`（同步调用未改） | 步骤 4 全量测试兜底；`tsc` 对「Promise 未 await」可用 lint 规则辅助 |
| 步骤 1 后调用点未改导致运行时报错 | 步骤 1 提交时**不合并**，步骤 2/3 同批完成后才整体合并（或用一个 feature 分支做完 1-4 再合） |
| 30+ 测试文件适配量大 | 优先跑核心回归（`core-path.test.ts`）+ 分文件推进 |
| 回滚 | 每步独立 commit，`git revert` 单步即可回退 |

### 10.5 与后续步骤的衔接

本步（抽接口 + 异步化）**已完成 2026-09-08**，验收标准「代码里有一个干净的异步 `DatabaseDriver` 接口，SqliteDriver 是唯一实现，全量测试绿」**已达成**（`sqlite-driver.ts` + 912/912 绿）。阶段 2（PgDriver + 占位符转换 + 方言）和阶段 3（`DB_DRIVER` 开关）现在有了接入点，进入 SaaS 阶段（M3 之后）即可启动。
