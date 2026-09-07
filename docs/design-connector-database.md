# Database Connector 设计（4.2 Connector 推进）

> 状态：**已落地（2026-09-01 P0 SQLite；2026-09-08 P1 PostgreSQL）** | 关联：roadmap-tasks 4.2 Connector、deferred-items 集成线
> 目标：补齐 Connector 的**数据库**数据源，让产线能自动从数据库拉数据——与已落地的 file/http/form 一起构成"自动拉数据"（从"玩具"到"工具"）的完整数据入口。

## 1. 背景与现状

- 用户推进项 **4.2 Connector**："让产线能自动拉数据（数据库/API/文件）"。
- **已落地**（roadmap-tasks 4.2 已勾选）：`ConnectorType = manual | file | http | form`，`resolveConnector` + Source 节点 UI（ConnectorEditor + `POST /api/connectors/test`）+ `connectors.test.ts` 全覆盖。engine 在 source 节点运行时调用 `resolveConnector`（带 `CONNECTOR_MAX_RETRIES` 重试，失败报 `CONNECTOR` 错误码）。
- **缺口**：无数据库数据源。file 读本地文件、http 拉 API、form 靠人工填表——**业务数据躺在数据库里时产线接不进来**，这是"自动拉数据"最常见的场景。

## 2. 设计

### 2.1 Schema（core `packages/core/src/graph.ts`）

`ConnectorType` 增加 `"database"`；`ConnectorConfig` 增加可选 `database` 字段：

```ts
export const ConnectorType = z.enum(["manual", "file", "http", "form", "database"]);

/** Pulls rows from a SQL database; query result serialized as source text. */
export const DatabaseConnector = z.object({
  /** "sqlite"（本地文件，Node 24 内置驱动，零依赖）| "postgres"（网络库，pg 驱动）。MySQL 为预留扩展点。 */
  driver: z.enum(["sqlite", "postgres"]).default("sqlite"),
  /** SQLite 数据库文件路径（相对 packages/server 工作目录或绝对路径）。 */
  path: z.string().optional(),
  /** PostgreSQL 主机。 */
  host: z.string().optional(),
  /** PostgreSQL 端口（默认 5432）。 */
  port: z.number().int().min(1).max(65535).optional(),
  /** PostgreSQL 库名。 */
  database: z.string().optional(),
  /** PostgreSQL 用户。 */
  user: z.string().optional(),
  /** PostgreSQL 密码（落盘前经静态加密 SECRET_KEYS 密封）。 */
  password: z.string().optional(),
  /** PostgreSQL SSL（默认 true，云托管 PG 通常要求）。 */
  ssl: z.boolean().optional(),
  /** 只读查询；必须为 SELECT，拒绝写语句（INSERT/UPDATE/DELETE/DDL）。 */
  query: z.string(),
  /** 可选绑定参数，防注入（postgres `$1` / sqlite `?`）。 */
  params: z.array(z.unknown()).optional(),
  /** 结果转文本格式：json（JSON.stringify）| csv（表格行）。默认 json。 */
  format: z.enum(["json", "csv"]).default("json"),
});
export type DatabaseConnector = z.infer<typeof DatabaseConnector>;
```

- **只做 SQLite**（P0）：Node ≥ 22 内置 `node:sqlite`，零新依赖、无网络出口、无连接串密钥风险。PostgreSQL / MySQL 需第三方驱动（pg / mysql2）+ 连接串密钥管理，登记 deferred（见 §5）。
- **只读强制**：解析前用白名单/语法检查只允许 `SELECT`（或 `WITH ... SELECT`），引擎层二次校验，杜绝 source 节点跑写库语句。

### 2.2 Resolver（server `packages/server/src/connectors.ts`）

新增 `case "database"`：

1. 打开 `node:sqlite` `DatabaseSync`（只读模式 `{ readOnly: true }`）。
2. 用 `db.prepare(query).all(...params)` 执行；只允许 SELECT（prepare 前正则校验，非 SELECT 直接 throw）。
3. 结果 → `format === "csv"` 时转简单 CSV（首行列名 + 值行）；否则 `JSON.stringify(rows, null, 2)`。
4. 返回 `{ text, images: [] }`，与现有 connector 契约一致。
5. 异常（文件不存在/权限/SQL 错误）throw → engine 走既有 CONNECTOR 重试 + `CONNECTOR` 错误码路径。

安全边界：
- `readOnly: true` 打开，写语句被驱动层拒绝（双保险）。
- 查询校验放行 SELECT/WITH，拒绝多语句（`;` 分隔）。
- 文件路径沿用 file connector 的读取授权范围（不放开任意系统文件读取——同 SSRF 思路，数据库文件应落在允许目录）。

### 2.3 UI（web `apps/web/src/components/ConnectorEditor.tsx`）

- connector 下拉加"数据库（SQLite）"。
- 配置区：`path`（文件路径）、`query`（多行 SELECT）、`format`（json/csv）、可折叠"绑定参数"。
- "测试连接"按钮复用 `POST /api/connectors/test`（该端点仅转调 `resolveConnector`，database 类型自动生效，无需改端点）。

### 2.4 测试

- `connectors.test.ts` 新增 `describe("resolveConnector - database")`：
  - 内存/临时 SQLite 建表插数 → SELECT 返回 json 文本
  - csv format
  - 非 SELECT 语句被拒（UPDATE / INSERT / DROP）
  - 文件不存在报错
- core `graph` 校验：`ConnectorType` 含 `database`、`DatabaseConnector` 反序列化。
- engine 冒烟：source 节点挂 database connector 跑通（回归基线或 engine.connector 用例）。

## 3. 与 4.6 触发方式的关系

- Connector（本次）解决"**数据能从哪自动来**"：file/http/database/form。
- 4.6 触发方式（后续，独立推进）解决"**产线什么时候自动跑**"：定时（cron） / 事件（webhook/文件变更）驱动产线运行。
- 两者配合才是"完全自动化"闭环：**触发 → 产线运行 → source 节点经 Connector 自动拉最新数据 → 下游加工**。本次不实现触发，但 Database Connector 的输出契约（每次运行实时查询）天然兼容定时/事件驱动——每次 run 都拉到当时的最新数据，无陈旧数据问题。

## 4. 影响面（本次已落地）

| 层 | 改动 |
|---|---|
| core | `graph.ts`：ConnectorType + DatabaseConnector schema（driver sqlite / path / query / params / format json\|csv） |
| server | `connectors.ts`：database case + SELECT/WITH 白名单 + 多语句拒绝 + 只读打开 + json/csv 序列化；`connectors.test.ts` 新增 6 用例 |
| web | `ConnectorEditor.tsx`：database 配置表单（路径 / 查询 textarea / 格式选择 + 只读提示） |
| 回归 | `core-path.test.ts` 新增 source(database connector)→sink 端到端用例（回归基线 11→12） |
| 文档 | 本文档状态置"已落地"；handoff 最近 5 条；roadmap-tasks 4.2 补 database 勾选 |

验证：core 153/153、server 全量（含 connectors）通过、web build 通过、回归基线 12/12。

## 5. 分期与 deferred

- **P0（2026-09-01）**：SQLite database connector（只读 + SELECT 白名单 + json/csv）。
- **P1（2026-09-08 已实施 PostgreSQL）**：PostgreSQL 驱动（`pg` 纯 JS，零本地依赖）——
  - schema 增 `driver:"postgres"` + `host/port/database/user/password/ssl`（见 §2.1）；
  - `connectors.ts` 分派 `queryPostgres`（异步连接 + 只读双保险：SELECT 白名单 + 会话级 `default_transaction_read_only=on`）；
  - 密码对齐静态加密：`at-rest.ts` 的 `SECRET_KEYS` 正则增 `password`，graph 文档落盘即密封，不吐明文；
  - 连接失败/查询失败走既有 `CONNECTOR` 错误码 + 重试路径。
- **MySQL（预留扩展点，未实施）**：driver enum 加 `"mysql"` + connectors 分派加一个分支即可。触发条件：出现"产线要直连 MySQL 存量库"的真实场景。

## 6. 后续推进与迁移规范（2026-09-08 探讨定稿）

### 6.1 数据接入三阶段

| 阶段 | 内容 | 是否要迁移 |
|---|---|---|
| A（已做） | SQLite + PostgreSQL driver，配置内联 graph 文档 | 零迁移 |
| B（可选） | 连接资源化：`db_connections` 表（连接配置抽成独立资源，一处配多处引用） | 迁移 35 |
| C（按需） | MySQL driver、连接池 + 超时、只读强化对齐 PG | 按需 |

> 阶段 B 是「能用 → 好用」的分水岭，但属体验优化，排在商业化 M0 验收之后。

### 6.2 迁移 SQL 规范（沿用 `db.ts` 现有 MIGRATIONS 体系）

- 迁移定义：`MIGRATIONS` 数组内联 `{ version, description, detect?, up }`，version 纯递增、永不复用不回改。
- 留痕四层：① 代码层 `description`（关联设计文档）；② 运行层 `schema_migrations` 表（version + applied_at）；③ 安全层迁移前自动 `VACUUM INTO` 成 `pre-migration-*.db`；④ 日志层 `migration applied`。
- 命名规则：
  - 表名 `snake_case` 复数（`db_connections`、`usage_ledger`）；
  - 索引名 `idx_<表>_<列>`（`idx_db_connections_user`）；
  - description 格式 `<内容> for <目的> (<关联设计文档>)`。
- 迁移清单文档（待建）：`docs/migrations.md` 一行一条（version | description | 关联文档 | 涉及表），统一索引，避免查表翻 `db.ts` 源码。
